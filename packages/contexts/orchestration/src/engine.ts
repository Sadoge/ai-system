import {
  MAX_CORRECTION_ITERATIONS,
  TERMINAL_RUN_STATUSES,
  policyForComplexity,
  type Complexity,
  type GateKind,
  type RunStatus,
  type StageKind,
  type TaskStatus,
} from '@ai-system/domain';
import { nextStage, pipelineFor, type PipelineDefinition } from './pipelines.js';
import type { AdvanceResult, Command, EngineEvent, RunSnapshot, TaskSnapshot } from './types.js';

type Stage = NonNullable<RunSnapshot['currentStage']>;
type TaskUpdate = { taskId: string; status: TaskStatus };

/**
 * The single transition function (docs/05 §1): state + event → next state +
 * commands. Pure — no IO, no clock, no randomness. Every input is persisted
 * by the runtime, so any historical transition can be replayed in tests.
 */
export function advance(run: RunSnapshot, event: EngineEvent): AdvanceResult {
  // Failed is normally terminal, but a human retry is an explicit transition
  // back into the frozen run rather than a new run with a copied ticket.
  if (event.name === 'run.retry.requested') return onRetryRequested(run);
  if (TERMINAL_RUN_STATUSES.includes(run.status)) {
    return ignored(`run is terminal (${run.status})`);
  }

  switch (event.name) {
    case 'run.created':
      return onRunCreated(run);
    case 'run.stage.completed':
      return onStageCompleted(run, event.payload.stage);
    case 'run.complexity.classified':
      return onComplexityClassified(run, event.payload.complexity);
    case 'task.completed':
      return onTaskCompleted(run, event.payload.taskId);
    case 'task.failed':
      return onTaskFailed(run, event.payload.taskId, event.payload.reason);
    case 'run.iteration.needed':
      return onIterationNeeded(run);
    case 'run.stage.failed':
      return onStageFailed(run, event.payload.stage, event.payload.reason);
    case 'run.gate.resolved':
      return onGateResolved(run, event.payload.gate, event.payload.decision);
    case 'run.cancelled':
      return transitioned('cancelled', null, []);
    case 'run.paused':
      if (isAwaiting(run.status)) return ignored('cannot pause a run parked at a gate');
      return transitioned('paused', run.currentStage, []);
    case 'run.resumed':
      return onResumed(run);
    case 'budget.exhausted':
      if (run.status === 'paused') return ignored('already paused');
      return transitioned('paused', run.currentStage, []);
    default:
      // Observability events (stage.started, task.created, artifact.created,
      // model.call.*) are record, not engine input.
      return ignored(`event ${event.name} does not drive transitions`);
  }
}

function onRunCreated(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'created') return ignored(`run.created in status ${run.status}`);
  const def = pipelineFor(run.policy);
  const first = nextStage(def, null);
  if (!first) return completeRun(run);
  return enterStage(run, def, first);
}

/**
 * Complexity is the one input that specializes a run's frozen policy, and the
 * engine applies it — never a stage handler (docs/03 §4). Epic is a control
 * decision: the work is too big to run, so it goes back to a human to split.
 */
function onComplexityClassified(run: RunSnapshot, complexity: Complexity): AdvanceResult {
  if (run.status !== 'classifying') return ignored(`classification in status ${run.status}`);
  if (complexity === 'epic') return transitioned('awaiting_split', run.currentStage, []);
  const patch = policyForComplexity(complexity);
  if (!patch) return ignored('no policy for complexity');
  return {
    outcome: 'transitioned',
    status: run.status,
    currentStage: run.currentStage,
    commands: [],
    policyPatch: patch,
  };
}

function onStageCompleted(run: RunSnapshot, stage: StageKind): AdvanceResult {
  if (stage !== run.currentStage) {
    return ignored(`stage.completed for ${stage} but current stage is ${run.currentStage}`);
  }
  if (isAwaiting(run.status)) {
    return ignored(`stage.completed while parked in ${run.status} (duplicate delivery)`);
  }
  const def = pipelineFor(run.policy);
  if (def.taskStage === stage) {
    return ignored(`stage.completed for the task stage ${stage} — tasks drive this stage`);
  }
  return afterStage(run, def, stage);
}

function onStageFailed(run: RunSnapshot, stage: StageKind, reason: string): AdvanceResult {
  if (stage !== run.currentStage) {
    return ignored(`stage.failed for ${stage} but current stage is ${run.currentStage}`);
  }
  return {
    outcome: 'transitioned',
    status: 'failed',
    currentStage: stage,
    commands: [],
    error: reason,
  };
}

function onRetryRequested(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'failed')
    return ignored(`run retry requires failed status (got ${run.status})`);
  if (!run.currentStage) return ignored('failed run has no stage to retry');

  const def = pipelineFor(run.policy);
  const stage = run.currentStage;
  if (!def.stages.includes(stage)) {
    return ignored(`stage ${stage} not in pipeline ${def.name}`);
  }

  if (def.taskStage === stage) {
    // A task can finish after a sibling has already failed the run. Its event
    // is then ignored because the run is terminal, leaving it `running` in
    // storage. Reset every incomplete in-flight/failed task into the ready
    // pool; completed tasks and their branches remain intact.
    const retryable = run.tasks.filter(
      (task) => task.status === 'failed' || task.status === 'running',
    );
    const tasks = run.tasks.map((task) =>
      retryable.some((candidate) => candidate.id === task.id)
        ? { ...task, status: 'created' as TaskStatus }
        : task,
    );
    const dispatched = dispatchOrAdvance(run, def, stage, tasks);
    if (dispatched.outcome === 'ignored') return dispatched;
    return {
      ...dispatched,
      clearError: true,
      taskUpdates: [
        ...retryable.map((task) => ({ taskId: task.id, status: 'created' as TaskStatus })),
        ...(dispatched.taskUpdates ?? []),
      ],
    };
  }

  return { ...enterStage(run, def, stage), clearError: true } as AdvanceResult;
}

// ── task DAG (Phase 2) ────────────────────────────────────────────────

function onTaskCompleted(run: RunSnapshot, taskId: string): AdvanceResult {
  const def = pipelineFor(run.policy);
  const stage = def.taskStage;
  if (!stage || run.currentStage !== stage) {
    return ignored(`task.completed outside the task stage (status ${run.status})`);
  }
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task) return ignored(`unknown task ${taskId}`);
  if (task.status === 'completed') return ignored(`duplicate completion of task ${taskId}`);

  const tasks = replaceTask(run.tasks, taskId, { status: 'completed' });
  return withTaskUpdates(
    [{ taskId, status: 'completed' }],
    dispatchOrAdvance(run, def, stage, tasks),
  );
}

function onTaskFailed(run: RunSnapshot, taskId: string, reason: string): AdvanceResult {
  const def = pipelineFor(run.policy);
  const stage = def.taskStage;
  if (!stage || run.currentStage !== stage) {
    return ignored(`task.failed outside the task stage (status ${run.status})`);
  }
  const task = run.tasks.find((t) => t.id === taskId);
  if (!task) return ignored(`unknown task ${taskId}`);
  if (task.status !== 'running') return ignored(`task ${taskId} is not running`);

  if (task.attemptCount < task.maxAttempts) {
    // Retry: back to the ready pool, re-dispatched below if a slot is free.
    const tasks = replaceTask(run.tasks, taskId, { status: 'created' });
    return withTaskUpdates(
      [{ taskId, status: 'created' }],
      dispatchOrAdvance(run, def, stage, tasks),
    );
  }
  return {
    outcome: 'transitioned',
    status: 'failed',
    currentStage: stage,
    commands: [],
    taskUpdates: [{ taskId, status: 'failed' }],
    error: `task ${taskId} failed after ${task.attemptCount} attempts: ${reason}`,
  };
}

/**
 * Fan-out/fan-in, deterministically: dispatch every ready task up to
 * policy.maxParallelTasks, and leave the task stage only when the whole DAG
 * has completed. A task is ready when it is unstarted and all of its
 * dependencies are completed.
 */
function dispatchOrAdvance(
  run: RunSnapshot,
  def: PipelineDefinition,
  stage: Stage,
  tasks: TaskSnapshot[],
): AdvanceResult {
  const outstanding = tasks.filter((t) => t.status !== 'completed');
  if (outstanding.length === 0) return afterStage(run, def, stage);

  const running = tasks.filter((t) => t.status === 'running');
  const slots = Math.max(0, run.policy.maxParallelTasks - running.length);
  const ready = tasks
    .filter((t) => t.status === 'created' && t.dependsOn.every((id) => isCompleted(tasks, id)))
    .slice(0, slots);

  if (ready.length === 0) {
    if (running.length > 0) {
      // Still waiting on in-flight tasks — hold position (the caller's task
      // updates are what actually get persisted).
      return transitioned(def.statusDuring(stage), stage, []);
    }
    return {
      outcome: 'transitioned',
      status: 'failed',
      currentStage: stage,
      commands: [],
      error: 'task DAG cannot progress: no runnable tasks and unmet dependencies remain',
    };
  }

  return {
    outcome: 'transitioned',
    status: def.statusDuring(stage),
    currentStage: stage,
    commands: ready.map(
      (t) => ({ kind: 'execute_task', runId: run.runId, taskId: t.id }) as Command,
    ),
    taskUpdates: ready.map((t) => ({ taskId: t.id, status: 'running' as TaskStatus })),
  };
}

function isCompleted(tasks: TaskSnapshot[], id: string): boolean {
  return tasks.find((t) => t.id === id)?.status === 'completed';
}

function replaceTask(
  tasks: TaskSnapshot[],
  taskId: string,
  patch: Partial<TaskSnapshot>,
): TaskSnapshot[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
}

function withTaskUpdates(updates: TaskUpdate[], result: AdvanceResult): AdvanceResult {
  if (result.outcome === 'ignored') return result;
  return { ...result, taskUpdates: [...updates, ...(result.taskUpdates ?? [])] };
}

// ── stage sequencing ──────────────────────────────────────────────────

/** What happens once `stage` is done: a gate, the next stage, or completion. */
function afterStage(run: RunSnapshot, def: PipelineDefinition, stage: Stage): AdvanceResult {
  const gate = def.gateAfter(stage, run.policy);
  if (gate) {
    return transitioned(awaitingStatusFor(gate), stage, [
      { kind: 'request_gate', runId: run.runId, gate },
    ]);
  }
  const next = nextStageAfter(run, def, stage);
  if (!next) return completeRun(run);
  return enterStage(run, def, next);
}

/** Entering the task stage fans out over the DAG; every other stage runs once. */
function enterStage(run: RunSnapshot, def: PipelineDefinition, stage: Stage): AdvanceResult {
  if (def.taskStage === stage) return dispatchOrAdvance(run, def, stage, run.tasks);
  return transitioned(def.statusDuring(stage), stage, [executeStage(run.runId, stage)]);
}

/**
 * The iteration decision (docs/05 §5), deterministically: one correction is
 * allowed; a second request fails closed instead of reopening coding.
 */
function onIterationNeeded(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'testing' || run.currentStage !== 'test') {
    return ignored(`iteration.needed in status ${run.status}`);
  }
  const def = pipelineFor(run.policy);
  if (canCorrect(run)) {
    return {
      ...reenter(run, def, def.iterationReentryStage),
      iterationCount: run.iterationCount + 1,
    } as AdvanceResult;
  }
  return correctionLimitReached(run.currentStage);
}

function onGateResolved(
  run: RunSnapshot,
  gate: GateKind,
  decision: 'approved' | 'rejected',
): AdvanceResult {
  if (run.status !== awaitingStatusFor(gate)) {
    return ignored(`gate.resolved(${gate}) in status ${run.status}`);
  }
  const def = pipelineFor(run.policy);

  switch (gate) {
    case 'final_pr':
      if (decision === 'approved') return completeRun(run);
      return startCorrection(run, def);

    case 'iteration_extension':
      if (decision === 'approved') return correctionLimitReached(run.currentStage);
      // Accept as-is: remaining findings are explicitly waived; carry on from `test`.
      return afterStageIgnoringGate(run, def, 'test');

    case 'plan_approval':
      if (decision === 'approved') return afterStageIgnoringGate(run, def, 'plan');
      // Rejected with feedback → back to planning.
      return reenter(run, def, 'plan');

    case 'pre_merge':
      if (decision === 'approved') return afterStageIgnoringGate(run, def, 'integrate');
      return startCorrection(run, def);

    default:
      return ignored(`gate ${gate} is not part of the ${def.name} pipeline`);
  }
}

/** Continue past a stage whose gate has just been resolved (don't re-request it). */
function afterStageIgnoringGate(
  run: RunSnapshot,
  def: PipelineDefinition,
  stage: Stage,
): AdvanceResult {
  const next = nextStageAfter(run, def, stage);
  if (!next) return completeRun(run);
  return enterStage(run, def, next);
}

function nextStageAfter(
  run: RunSnapshot,
  def: PipelineDefinition,
  stage: Stage,
): StageKind | null {
  if (
    run.iterationCount > 0 &&
    stage === def.correctionCompletionStage &&
    def.correctionExitStage
  ) {
    return def.correctionExitStage;
  }
  return nextStage(def, stage);
}

function correctionBudget(run: RunSnapshot): number {
  return Math.min(run.policy.iterationBudget, MAX_CORRECTION_ITERATIONS);
}

function canCorrect(run: RunSnapshot): boolean {
  return run.iterationCount < correctionBudget(run);
}

function startCorrection(run: RunSnapshot, def: PipelineDefinition): AdvanceResult {
  if (!canCorrect(run)) return correctionLimitReached(run.currentStage);
  return {
    ...reenter(run, def, def.iterationReentryStage),
    iterationCount: run.iterationCount + 1,
  } as AdvanceResult;
}

function correctionLimitReached(stage: RunSnapshot['currentStage']): AdvanceResult {
  return {
    outcome: 'transitioned',
    status: 'failed',
    currentStage: stage,
    commands: [],
    error: 'Correction limit reached after the single corrective coding pass; manual changes are required.',
  };
}

function onResumed(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'paused') return ignored(`run.resumed in status ${run.status}`);
  const def = pipelineFor(run.policy);
  if (!run.currentStage) return ignored('paused run has no stage to resume');
  return enterStage(run, def, run.currentStage);
}

function reenter(run: RunSnapshot, def: PipelineDefinition, stage: Stage): AdvanceResult {
  if (!def.stages.includes(stage)) return ignored(`stage ${stage} not in pipeline ${def.name}`);
  // Re-entry always runs the stage itself (even the task stage's producer),
  // so fix tasks exist before the DAG fans out again.
  return transitioned(def.statusDuring(stage), stage, [executeStage(run.runId, stage)]);
}

/**
 * Completion is also the learning trigger (docs/08 §3): a finished run is the
 * raw material the distiller turns into knowledge proposals. Trivial runs
 * carry nothing worth learning from.
 */
function completeRun(run: RunSnapshot): AdvanceResult {
  const def = pipelineFor(run.policy);
  const commands: Command[] =
    def.name === 'trivial' ? [] : [{ kind: 'distill_knowledge', runId: run.runId }];
  return { outcome: 'transitioned', status: 'completed', currentStage: null, commands };
}

function awaitingStatusFor(gate: GateKind): RunStatus {
  switch (gate) {
    case 'plan_approval':
      return 'awaiting_plan_approval';
    case 'final_pr':
      return 'awaiting_final_approval';
    case 'iteration_extension':
      return 'awaiting_iteration_gate';
    case 'pre_merge':
      return 'awaiting_pre_merge';
    default:
      return 'paused';
  }
}

function isAwaiting(status: RunStatus): boolean {
  return status.startsWith('awaiting_');
}

function executeStage(runId: string, stage: Stage): Command {
  return { kind: 'execute_stage', runId, stage };
}

function transitioned(
  status: RunStatus,
  currentStage: RunSnapshot['currentStage'],
  commands: Command[],
): AdvanceResult {
  return { outcome: 'transitioned', status, currentStage, commands };
}

function ignored(reason: string): AdvanceResult {
  return { outcome: 'ignored', reason };
}
