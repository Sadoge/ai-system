import { TERMINAL_RUN_STATUSES, type GateKind, type RunStatus } from '@ai-system/domain';
import { nextStage, pipelineFor } from './pipelines.js';
import type { AdvanceResult, Command, EngineEvent, RunSnapshot } from './types.js';

/**
 * The single transition function (docs/05 §1): state + event → next state +
 * commands. Pure — no IO, no clock, no randomness. Every input is persisted
 * by the runtime, so any historical transition can be replayed in tests.
 */
export function advance(run: RunSnapshot, event: EngineEvent): AdvanceResult {
  if (TERMINAL_RUN_STATUSES.includes(run.status)) {
    return ignored(`run is terminal (${run.status})`);
  }

  switch (event.name) {
    case 'run.created':
      return onRunCreated(run);
    case 'run.stage.completed':
      return onStageCompleted(run, event.payload.stage);
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
      // Observability events (stage.started, artifact.created, model.call.*)
      // are record, not engine input.
      return ignored(`event ${event.name} does not drive transitions`);
  }
}

function onRunCreated(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'created') return ignored(`run.created in status ${run.status}`);
  const def = pipelineFor(run.policy);
  const first = nextStage(def, null);
  if (!first) return transitioned('completed', null, []);
  return transitioned(def.statusDuring(first), first, [executeStage(run.runId, first)]);
}

function onStageCompleted(run: RunSnapshot, stage: RunSnapshot['currentStage']): AdvanceResult {
  if (stage !== run.currentStage) {
    return ignored(`stage.completed for ${stage} but current stage is ${run.currentStage}`);
  }
  const def = pipelineFor(run.policy);
  if (stage === null) return ignored('no active stage');

  const gate = def.gateAfter(stage, run.policy);
  if (gate) {
    return transitioned(awaitingStatusFor(gate), stage, [
      { kind: 'request_gate', runId: run.runId, gate },
    ]);
  }
  const next = nextStage(def, stage);
  if (!next) return transitioned('completed', null, []);
  return transitioned(def.statusDuring(next), next, [executeStage(run.runId, next)]);
}

function onStageFailed(
  run: RunSnapshot,
  stage: RunSnapshot['currentStage'],
  reason: string,
): AdvanceResult {
  if (stage !== run.currentStage) {
    return ignored(`stage.failed for ${stage} but current stage is ${run.currentStage}`);
  }
  return { outcome: 'transitioned', status: 'failed', currentStage: stage, commands: [], error: reason };
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

  if (gate === 'final_pr') {
    if (decision === 'approved') return transitioned('completed', null, []);
    // Changes requested → re-enter the coding stage (docs/05 §6).
    return reenter(run, 'code');
  }
  if (gate === 'plan_approval') {
    if (decision === 'approved') {
      const next = nextStage(def, 'plan');
      if (!next) return transitioned('completed', null, []);
      return transitioned(def.statusDuring(next), next, [executeStage(run.runId, next)]);
    }
    // Rejected with feedback → back to planning.
    return reenter(run, 'plan');
  }
  return ignored(`gate ${gate} is not part of the ${def.name} pipeline`);
}

function onResumed(run: RunSnapshot): AdvanceResult {
  if (run.status !== 'paused') return ignored(`run.resumed in status ${run.status}`);
  const def = pipelineFor(run.policy);
  if (!run.currentStage) return ignored('paused run has no stage to resume');
  return transitioned(def.statusDuring(run.currentStage), run.currentStage, [
    executeStage(run.runId, run.currentStage),
  ]);
}

function reenter(run: RunSnapshot, stage: NonNullable<RunSnapshot['currentStage']>): AdvanceResult {
  const def = pipelineFor(run.policy);
  if (!def.stages.includes(stage)) return ignored(`stage ${stage} not in pipeline ${def.name}`);
  return transitioned(def.statusDuring(stage), stage, [executeStage(run.runId, stage)]);
}

function awaitingStatusFor(gate: GateKind): RunStatus {
  switch (gate) {
    case 'plan_approval':
      return 'awaiting_plan_approval';
    case 'final_pr':
      return 'awaiting_final_approval';
    case 'iteration_extension':
      return 'awaiting_iteration_gate';
    default:
      return 'paused';
  }
}

function isAwaiting(status: RunStatus): boolean {
  return status.startsWith('awaiting_');
}

function executeStage(runId: string, stage: NonNullable<RunSnapshot['currentStage']>): Command {
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
