import Link from 'next/link';
import { apiGet, type RunDetail } from '@/lib/api';
import { resolveGateAction, retryRunAction } from '@/lib/actions';
import {
  Caesura,
  Fermata,
  SeverityMark,
  StatusMark,
  System,
  buttonCls,
  buttonDangerCls,
  inputCls,
  linkCls,
} from '@/lib/ui';
import { LiveRefresh } from './live-refresh';
import { RunSystem } from './system';
import { ExecutionMonitor } from './execution-monitor';

const TERMINAL = ['completed', 'failed', 'cancelled'];

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await apiGet<RunDetail>(`/runs/${id}`);
  const pendingGates = run.gates.filter((g) => g.status === 'pending');
  const doneTasks = run.tasks.filter((t) => t.status === 'completed').length;
  const terminal = TERMINAL.includes(run.status);
  const activeProcessCount = terminal
    ? 0
    : run.stages.filter((stage) => stage.status === 'running').length +
      run.tasks.filter((task) => task.status === 'running').length +
      (run.agents ?? []).filter((agent) => agent.status === 'running').length;

  return (
    <main>
      <LiveRefresh runId={id} active={!terminal} />

      {/* Programme head */}
      <div className="mb-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-3">
          <h1 className="basis-full text-xl leading-snug text-ink sm:min-w-0 sm:flex-1 sm:basis-auto">
            {run.ticket.title}
          </h1>
          <StatusMark status={run.status} />
        </div>
        <p className="mt-2 font-mono text-xs text-ink-faint tnum">
          {run.policySnapshot.pipeline} · {run.policySnapshot.automationLevel}
          {run.complexity ? ` · ${run.complexity}` : ''} · iteration {run.iterationCount} · $
          {run.costUsd.toFixed(4)}
        </p>
      </div>

      {run.error && (
        <p className="mb-8 border-l-2 border-mark py-1 pl-4 font-mono text-sm text-mark-bright">
          {run.error}
        </p>
      )}

      {run.status === 'failed' && (
        <div className="mb-8">
          <Caesura>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="annot text-base text-ink">Retry from the failure</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-label">
                  Completed stages, artifacts, and completed task branches stay in place. Only the
                  failed stage or incomplete team tasks are queued again.
                </p>
              </div>
              <form action={retryRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className={buttonCls}>
                  Retry{run.currentStage ? ` ${run.currentStage}` : ''}
                </button>
              </form>
            </div>
          </Caesura>
        </div>
      )}

      {/* The hold. Every voice waits here until a human marks it. */}
      {pendingGates.map((gate) => (
        <div key={gate.id} className="mb-8">
          <Caesura>
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Fermata className="shrink-0 text-mark-bright" />
              <span className="annot text-base text-ink">Held for you</span>
              <span className="font-mono text-sm text-mark-bright">{gate.gate}</span>
              {typeof gate.payload.artifactId === 'string' && (
                <Link
                  href={`/runs/${run.id}/artifacts/${gate.payload.artifactId}`}
                  className={`${linkCls} text-sm`}
                >
                  read the {String(gate.payload.artifactKind ?? 'artifact')}
                </Link>
              )}
            </div>
            <form action={resolveGateAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="gateId" value={gate.id} />
              <label className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="annot text-xs text-ink-label">Comment — required to reject</span>
                <input name="comment" className={inputCls} placeholder="Why" />
              </label>
              <button type="submit" name="decision" value="approved" className={buttonCls}>
                Approve
              </button>
              <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
                Reject
              </button>
            </form>
          </Caesura>
        </div>
      ))}

      {/* One system: the run's own voice over the task voices, all crossing
          the same stage barlines. */}
      <System
        mark="A"
        title="The system"
        aside={
          run.tasks.length > 0
            ? `${doneTasks}/${run.tasks.length} voices played`
            : terminal
              ? 'closed'
              : 'sounding'
        }
      >
        <RunSystem run={run} />
      </System>

      <System
        mark="B"
        title="Execution ledger"
        aside={
          terminal && activeProcessCount === 0
            ? 'settled'
            : `${activeProcessCount} active processes`
        }
      >
        <ExecutionMonitor run={run} />
      </System>

      {/* Editorial marks: what the reviewer wrote in the margin. */}
      {run.findings.length > 0 && (
        <System mark="C" title="Editorial marks" aside={`${run.findings.length}`}>
          <ul className="space-y-5">
            {run.findings.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-1 border-l border-rule pl-4 sm:flex-row sm:gap-4"
              >
                <div className="shrink-0 pt-0.5 sm:w-28">
                  <SeverityMark severity={f.severity} />
                  <p className="mt-1 font-mono text-micro text-ink-faint">{f.status}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{f.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </System>
      )}

      <System mark="D" title="Parts" aside={`${run.artifacts.length}`}>
        {run.artifacts.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            No parts written yet. They appear as the run produces them.
          </p>
        ) : (
          <ul className="border-t border-rule">
            {run.artifacts.map((a) => (
              <li key={a.id} className="border-b border-rule">
                <Link
                  href={`/runs/${run.id}/artifacts/${a.id}`}
                  className="flex items-center gap-4 px-3 py-2.5 text-sm hover:bg-ground-raised"
                >
                  <span className="font-mono text-cue-bright">{a.kind}</span>
                  <span className="ml-auto font-mono text-xs text-ink-faint tnum">
                    {new Date(a.createdAt).toLocaleTimeString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </System>
    </main>
  );
}
