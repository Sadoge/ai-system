'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RunDetail } from '@/lib/api';
import { StatusMark } from '@/lib/ui';
import { stageFailureDetail } from './execution-monitor-copy';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const DEFAULT_ACTIVITY: Record<string, string> = {
  intake: 'Capturing the ticket snapshot',
  echo_agent: 'Running the echo agent',
  classify: 'Classifying ticket complexity',
  research: 'Gathering repository and Project Brain context',
  plan: 'Drafting the implementation plan',
  decompose: 'Building the task dependency graph',
  code: 'Preparing coding worktrees and agents',
  integrate: 'Merging completed task branches',
  review: 'Reviewing the implementation for findings',
  test: 'Running repository validation and tests',
  document: 'Writing implementation documentation',
  package: 'Preparing the pull-request package',
};

const PIPELINE_STAGES: Record<string, string[]> = {
  trivial: ['intake', 'echo_agent'],
  mvp_linear: ['intake', 'classify', 'research', 'plan', 'code', 'review', 'test', 'package'],
  team: [
    'intake',
    'classify',
    'research',
    'plan',
    'decompose',
    'code',
    'integrate',
    'review',
    'test',
    'document',
    'package',
  ],
};

type RunEvent = RunDetail['events'][number];
type ActivityEvent = RunEvent & {
  payload: RunEvent['payload'] & {
    stage?: string;
    taskId?: string;
    agentRunId?: string;
    kind?: string;
    message?: string;
  };
};

function activityEvents(events: RunDetail['events']): ActivityEvent[] {
  return events.filter((event): event is ActivityEvent => event.name === 'run.activity');
}

function latestActivity(
  events: ActivityEvent[],
  match: (event: ActivityEvent) => boolean,
  includeHeartbeat = false,
): ActivityEvent | undefined {
  return [...events]
    .reverse()
    .find((event) => match(event) && (includeHeartbeat || event.payload.kind !== 'heartbeat'));
}

function duration(
  start: string | null | undefined,
  finish: string | null | undefined,
  now: number,
) {
  if (!start || now === 0) return 'not started';
  const milliseconds = Math.max(0, new Date(finish ?? now).getTime() - new Date(start).getTime());
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function clock(value: string, mounted: boolean) {
  if (!mounted) return '—';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function eventLabel(event: RunEvent, run: RunDetail): string | null {
  const payload = event.payload;
  const stage = typeof payload.stage === 'string' ? payload.stage : null;
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
  const task = taskId ? run.tasks.find((item) => item.id === taskId) : null;
  switch (event.name) {
    case 'run.activity':
      return typeof payload.message === 'string' ? payload.message : null;
    case 'run.stage.started':
      return stage ? `${stage} stage started` : 'Stage started';
    case 'run.stage.completed':
      return stage ? `${stage} stage completed` : 'Stage completed';
    case 'run.stage.failed':
      return stage
        ? `${stage} stage failed${typeof payload.reason === 'string' ? ` — ${stageFailureDetail(payload.reason)}` : ''}`
        : 'Stage failed';
    case 'task.created':
      return task ? `Queued task: ${task.title}` : 'Task queued';
    case 'task.started':
      return task ? `Started task: ${task.title}` : 'Task started';
    case 'task.completed':
      return task ? `Completed task: ${task.title}` : 'Task completed';
    case 'task.failed':
      return task ? `Failed task: ${task.title}` : 'Task failed';
    case 'run.gate.requested':
      return `Waiting for ${String(payload.gate ?? 'human approval')}`;
    case 'run.gate.resolved':
      return `${String(payload.gate ?? 'Gate')} ${String(payload.decision ?? 'resolved')}`;
    default:
      return null;
  }
}

export function ExecutionMonitor({ run }: { run: RunDetail }) {
  // Old API processes can briefly serve the previous response shape while a
  // new web build is already live. Keep the ledger useful during that rollout.
  const events = run.events ?? [];
  const agentsForRun = run.agents ?? [];
  const active =
    !TERMINAL.has(run.status) ||
    run.stages.some((stage) => stage.status === 'running') ||
    run.tasks.some((task) => task.status === 'running') ||
    agentsForRun.some((agent) => agent.status === 'running');
  const stageOrder =
    run.stageOrder ??
    PIPELINE_STAGES[run.policySnapshot.pipeline] ??
    run.stages.map((stage) => stage.stage);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  const activities = useMemo(() => activityEvents(events), [events]);
  const attempts = useMemo(() => {
    const result = new Map<string, RunDetail['stages'][number]>();
    for (const attempt of run.stages) result.set(attempt.stage, attempt);
    return result;
  }, [run.stages]);
  const currentActivity = latestActivity(
    activities,
    (event) => event.payload.stage === run.currentStage,
  );
  const currentSeen = latestActivity(
    activities,
    (event) => event.payload.stage === run.currentStage,
    true,
  );
  const recent = events
    .filter((event) => event.name !== 'run.activity' || event.payload.kind !== 'heartbeat')
    .map((event) => ({ event, label: eventLabel(event, run) }))
    .filter((item): item is { event: RunEvent; label: string } => Boolean(item.label))
    .slice(-12)
    .reverse();

  return (
    <div>
      {active && run.currentStage && (
        <div
          className="live-callout mb-5 border-y border-cue px-3 py-3"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className="pulse-live h-2.5 w-2.5 shrink-0 -rotate-[20deg] bg-cue-bright"
              aria-hidden
            />
            <span className="font-mono text-sm text-cue-bright">{run.currentStage}</span>
            <span className="annot text-xs text-ink-label">sounding now</span>
            {currentSeen && (
              <span className="ml-auto font-mono text-micro text-ink-faint tnum">
                signal {clock(currentSeen.createdAt, now > 0)}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
            {currentActivity?.payload.message ?? DEFAULT_ACTIVITY[run.currentStage] ?? 'Working'}
          </p>
        </div>
      )}

      <ol className="border-t border-rule" aria-label="Pipeline stage progress">
        {stageOrder.map((stage, index) => {
          const attempt = attempts.get(stage);
          const isCurrent = stage === run.currentStage && active;
          const status = attempt?.status ?? (isCurrent ? 'running' : 'queued');
          const stageActivity = latestActivity(
            activities,
            (event) => event.payload.stage === stage,
          );
          const stageSeen = latestActivity(
            activities,
            (event) => event.payload.stage === stage,
            true,
          );
          const tasks = stage === 'code' ? run.tasks : [];
          const agents = agentsForRun.filter((agent) => {
            if (agent.taskId) return false;
            if (agent.stageExecutionId && attempt) return agent.stageExecutionId === attempt.id;
            if (agent.agentKind === 'coding') return stage === 'code';
            if (agent.agentKind === 'conflict_resolution') return stage === 'integrate';
            if (agent.agentKind === 'echo') return stage === 'echo_agent';
            return false;
          });
          const succeededAgent = agents.some((agent) => agent.status === 'succeeded');
          const failedMessage =
            attempt?.status === 'failed'
              ? `${succeededAgent ? 'Agent succeeded, but stage finalization failed' : 'Stage failed'}${
                  attempt.error ? `: ${stageFailureDetail(attempt.error)}` : ''
                }`
              : null;
          return (
            <li
              key={stage}
              className={`stage-progress-row border-b border-rule px-3 py-3 ${
                isCurrent ? 'stage-progress-current' : ''
              }`}
            >
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[2rem_8rem_1fr_auto] sm:items-baseline">
                <span className="font-mono text-micro text-ink-faint tnum">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-sm text-ink">{stage}</span>
                <div className="min-w-0">
                  <p
                    className={
                      failedMessage
                        ? 'text-sm text-mark-bright'
                        : isCurrent
                          ? 'text-sm text-cue-bright'
                          : 'text-sm text-ink-muted'
                    }
                  >
                    {failedMessage ??
                      stageActivity?.payload.message ??
                      DEFAULT_ACTIVITY[stage] ??
                      'Waiting to start'}
                  </p>
                  {stageSeen && stageSeen !== stageActivity && (
                    <p className="mt-0.5 font-mono text-micro text-ink-faint">
                      liveness signal {clock(stageSeen.createdAt, now > 0)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className="font-mono text-micro text-ink-faint tnum">
                    {duration(attempt?.startedAt, attempt?.finishedAt, now)}
                  </span>
                  <StatusMark status={status} />
                </div>
              </div>

              {(tasks.length > 0 || agents.length > 0) && (
                <ul className="ml-6 mt-3 border-t border-rule sm:ml-12">
                  {tasks.map((task) => {
                    const taskActivity = latestActivity(
                      activities,
                      (event) => event.payload.taskId === task.id,
                    );
                    const agent = agentsForRun.find((item) => item.taskId === task.id);
                    const taskSeen = latestActivity(
                      activities,
                      (event) => event.payload.taskId === task.id,
                      true,
                    );
                    return (
                      <li
                        key={task.id}
                        className="agent-progress-row border-b border-rule px-2 py-2 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <StatusMark status={task.status} />
                          <span className="min-w-0 flex-1 text-sm text-ink-secondary">
                            {task.title}
                          </span>
                          {agent && (
                            <span className="font-mono text-micro text-ink-faint">
                              {agent.executorKind} ·{' '}
                              {duration(agent.startedAt, agent.finishedAt, now)}
                            </span>
                          )}
                        </div>
                        <p className="ml-5 mt-1 text-xs leading-relaxed text-ink-muted">
                          {taskActivity?.payload.message ??
                            (task.status === 'created'
                              ? 'Waiting for dependencies or capacity'
                              : 'Working')}
                          {taskSeen && taskSeen !== taskActivity
                            ? ` · signal ${clock(taskSeen.createdAt, now > 0)}`
                            : ''}
                        </p>
                      </li>
                    );
                  })}
                  {agents.map((agent) => {
                    const activity = latestActivity(
                      activities,
                      (event) => event.payload.agentRunId === agent.id,
                    );
                    return (
                      <li
                        key={agent.id}
                        className="agent-progress-row border-b border-rule px-2 py-2 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <StatusMark status={agent.status} />
                          <span className="text-sm text-ink-secondary">
                            {agent.agentKind} agent
                          </span>
                          <span className="ml-auto font-mono text-micro text-ink-faint">
                            {agent.executorKind} ·{' '}
                            {duration(agent.startedAt, agent.finishedAt, now)}
                          </span>
                        </div>
                        <p className="ml-5 mt-1 text-xs text-ink-muted">
                          {activity?.payload.message ?? 'Agent process recorded'}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline gap-3">
          <p className="annot text-sm text-ink">Recent activity</p>
          <span className="font-mono text-micro text-ink-faint">newest first</span>
        </div>
        {recent.length === 0 ? (
          <p className="border-t border-rule py-3 text-sm text-ink-label">
            Waiting for the worker’s first activity signal.
          </p>
        ) : (
          <ol className="border-t border-rule" aria-label="Recent run activity">
            {recent.map(({ event, label }) => (
              <li
                key={event.id}
                className="grid gap-1 border-b border-rule py-2 sm:grid-cols-[6rem_1fr]"
              >
                <time
                  className="font-mono text-micro text-ink-faint tnum"
                  dateTime={event.createdAt}
                >
                  {clock(event.createdAt, now > 0)}
                </time>
                <span className="text-sm text-ink-secondary">{label}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
