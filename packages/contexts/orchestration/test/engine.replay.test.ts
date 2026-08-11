import { describe, expect, it } from 'vitest';
import type { DomainEvent, PolicySnapshot } from '@ai-system/domain';
import { defaultTrivialPolicy, gatesForAutomationLevel } from '@ai-system/domain';
import { advance } from '../src/engine.js';
import type { RunSnapshot } from '../src/types.js';

const RUN_ID = '01936b00-0000-7000-8000-000000000001';
const PROJECT_ID = '01936b00-0000-7000-8000-000000000002';
const STAGE_EXEC_ID = '01936b00-0000-7000-8000-000000000003';
const GATE_REQ_ID = '01936b00-0000-7000-8000-000000000004';

function initialRun(policy: PolicySnapshot): RunSnapshot {
  return {
    runId: RUN_ID,
    status: 'created',
    currentStage: null,
    version: 1,
    policy,
    iterationCount: 0,
    tasks: [],
  };
}

/** Fold a recorded event sequence through advance(), asserting every step transitions. */
function replay(start: RunSnapshot, events: DomainEvent[]) {
  let run = start;
  const trace: { status: string; commands: unknown[] }[] = [];
  for (const event of events) {
    const result = advance(run, event);
    if (result.outcome === 'ignored') {
      throw new Error(`unexpected ignore at ${event.name}: ${result.reason}`);
    }
    run = { ...run, status: result.status, currentStage: result.currentStage, version: run.version + 1 };
    trace.push({ status: result.status, commands: result.commands });
  }
  return { run, trace };
}

const created: DomainEvent = {
  name: 'run.created',
  payload: { runId: RUN_ID, projectId: PROJECT_ID, ticket: { source: 'manual', title: 'T', description: '', acceptanceCriteria: [], labels: [] } },
};

function stageCompleted(stage: string): DomainEvent {
  return {
    name: 'run.stage.completed',
    payload: { runId: RUN_ID, stageExecutionId: STAGE_EXEC_ID, stage, artifactIds: [] },
  } as DomainEvent;
}

function gateResolved(gate: string, decision: 'approved' | 'rejected'): DomainEvent {
  return {
    name: 'run.gate.resolved',
    payload: { runId: RUN_ID, gateRequestId: GATE_REQ_ID, gate, decision },
  } as DomainEvent;
}

function mvpPolicy(automationLevel: 'plan_gated' | 'autonomous'): PolicySnapshot {
  return {
    pipeline: 'mvp_linear',
    automationLevel,
    enabledGates: gatesForAutomationLevel(automationLevel),
    maxParallelTasks: 1,
    iterationBudget: 1,
    maxTaskAttempts: 2,
    budgetUsd: null,
  };
}

describe('trivial pipeline (Phase 0)', () => {
  it('runs intake → echo_agent → completed, enqueuing each stage exactly once', () => {
    const { run, trace } = replay(initialRun(defaultTrivialPolicy()), [
      created,
      stageCompleted('intake'),
      stageCompleted('echo_agent'),
    ]);
    expect(run.status).toBe('completed');
    expect(trace).toEqual([
      { status: 'executing', commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'intake' }] },
      { status: 'executing', commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'echo_agent' }] },
      { status: 'completed', commands: [] },
    ]);
  });

  it('ignores a duplicate stage completion (redelivery safety)', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [created, stageCompleted('intake')]);
    const dup = advance(run, stageCompleted('intake'));
    expect(dup).toEqual({ outcome: 'ignored', reason: expect.stringContaining('current stage is echo_agent') });
  });

  it('fails the run when the active stage fails, capturing the reason', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [created]);
    const result = advance(run, {
      name: 'run.stage.failed',
      payload: { runId: RUN_ID, stageExecutionId: STAGE_EXEC_ID, stage: 'intake', reason: 'boom' },
    });
    expect(result).toMatchObject({ outcome: 'transitioned', status: 'failed', error: 'boom', commands: [] });
  });

  it('retries a failed run from its failed stage without replaying completed stages', () => {
    const failed: RunSnapshot = {
      ...initialRun(mvpPolicy('autonomous')),
      status: 'failed',
      currentStage: 'code',
    };
    const result = advance(failed, {
      name: 'run.retry.requested',
      payload: { runId: RUN_ID },
    });

    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'executing',
      currentStage: 'code',
      clearError: true,
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'code' }],
    });
  });

  it('rejects retry for a run that is not failed', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [created]);
    expect(
      advance(run, { name: 'run.retry.requested', payload: { runId: RUN_ID } }),
    ).toMatchObject({ outcome: 'ignored', reason: expect.stringContaining('requires failed') });
  });

  it('absorbs events after a terminal state', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [
      created,
      stageCompleted('intake'),
      stageCompleted('echo_agent'),
    ]);
    expect(advance(run, stageCompleted('echo_agent'))).toMatchObject({ outcome: 'ignored' });
    expect(advance(run, { name: 'run.cancelled', payload: { runId: RUN_ID } })).toMatchObject({
      outcome: 'ignored',
    });
  });

  it('can be cancelled from any active state', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [created]);
    const result = advance(run, { name: 'run.cancelled', payload: { runId: RUN_ID } });
    expect(result).toMatchObject({ outcome: 'transitioned', status: 'cancelled' });
  });

  it('pauses and resumes, re-enqueuing the interrupted stage', () => {
    const { run } = replay(initialRun(defaultTrivialPolicy()), [created]);
    const paused = advance(run, { name: 'run.paused', payload: { runId: RUN_ID, reason: 'manual' } });
    expect(paused).toMatchObject({ outcome: 'transitioned', status: 'paused', currentStage: 'intake' });
    const pausedRun: RunSnapshot = { ...run, status: 'paused' };
    const resumed = advance(pausedRun, { name: 'run.resumed', payload: { runId: RUN_ID } });
    expect(resumed).toMatchObject({
      outcome: 'transitioned',
      status: 'executing',
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'intake' }],
    });
  });
});

describe('mvp_linear pipeline gates', () => {
  it('parks at plan approval when plan_gated, then continues to code on approval', () => {
    const { run, trace } = replay(initialRun(mvpPolicy('plan_gated')), [
      created,
      stageCompleted('intake'),
      stageCompleted('classify'),
      stageCompleted('research'),
      stageCompleted('plan'),
    ]);
    expect(run.status).toBe('awaiting_plan_approval');
    expect(trace.at(-1)!.commands).toEqual([{ kind: 'request_gate', runId: RUN_ID, gate: 'plan_approval' }]);

    const approved = advance(run, gateResolved('plan_approval', 'approved'));
    expect(approved).toMatchObject({
      outcome: 'transitioned',
      status: 'executing',
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'code' }],
    });
  });

  it('returns to planning when the plan is rejected', () => {
    const { run } = replay(initialRun(mvpPolicy('plan_gated')), [
      created,
      stageCompleted('intake'),
      stageCompleted('classify'),
      stageCompleted('research'),
      stageCompleted('plan'),
    ]);
    const rejected = advance(run, gateResolved('plan_approval', 'rejected'));
    expect(rejected).toMatchObject({
      outcome: 'transitioned',
      status: 'planning',
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'plan' }],
    });
  });

  it('always requests the final PR gate, even at automation level autonomous', () => {
    const { run, trace } = replay(initialRun(mvpPolicy('autonomous')), [
      created,
      stageCompleted('intake'),
      stageCompleted('classify'),
      stageCompleted('research'),
      stageCompleted('plan'), // no plan gate at this level
      stageCompleted('code'),
      stageCompleted('review'),
      stageCompleted('test'),
      stageCompleted('package'),
    ]);
    expect(run.status).toBe('awaiting_final_approval');
    expect(trace.at(-1)!.commands).toEqual([{ kind: 'request_gate', runId: RUN_ID, gate: 'final_pr' }]);
  });

  it('final approval completes the run; rejection consumes the only correction', () => {
    const base = replay(initialRun(mvpPolicy('autonomous')), [
      created,
      stageCompleted('intake'),
      stageCompleted('classify'),
      stageCompleted('research'),
      stageCompleted('plan'),
      stageCompleted('code'),
      stageCompleted('review'),
      stageCompleted('test'),
      stageCompleted('package'),
    ]).run;

    expect(advance(base, gateResolved('final_pr', 'approved'))).toMatchObject({
      outcome: 'transitioned',
      status: 'completed',
    });
    expect(advance(base, gateResolved('final_pr', 'rejected'))).toMatchObject({
      outcome: 'transitioned',
      status: 'executing',
      iterationCount: 1,
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'code' }],
    });

    const alreadyCorrected: RunSnapshot = { ...base, iterationCount: 1 };
    expect(advance(alreadyCorrected, gateResolved('final_pr', 'rejected'))).toMatchObject({
      outcome: 'transitioned',
      status: 'failed',
      commands: [],
      error: expect.stringContaining('Correction limit reached'),
    });
  });

  it('parks at awaiting_split when classification says epic', () => {
    const { run } = replay(initialRun(mvpPolicy('autonomous')), [created, stageCompleted('intake')]);
    const result = advance(run, {
      name: 'run.complexity.classified',
      payload: { runId: RUN_ID, complexity: 'epic' },
    });
    expect(result).toMatchObject({ outcome: 'transitioned', status: 'awaiting_split', commands: [] });
    // The classify stage's own completion event must not advance a parked run.
    const parked: RunSnapshot = { ...run, status: 'awaiting_split' };
    expect(advance(parked, stageCompleted('classify'))).toMatchObject({ outcome: 'ignored' });
  });

  it('specializes the frozen policy from complexity, exactly once', () => {
    const { run } = replay(initialRun(mvpPolicy('autonomous')), [created, stageCompleted('intake')]);
    const result = advance(run, {
      name: 'run.complexity.classified',
      payload: { runId: RUN_ID, complexity: 'large' },
    });
    // Stays in `classifying` — this transition exists to write policy, not to move the run.
    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'classifying',
      policyPatch: { maxParallelTasks: 5, iterationBudget: 1 },
    });

    // Once the run has left `classifying`, a late duplicate cannot rewrite policy.
    const later: RunSnapshot = { ...run, status: 'planning', currentStage: 'plan' };
    expect(
      advance(later, {
        name: 'run.complexity.classified',
        payload: { runId: RUN_ID, complexity: 'tiny' },
      }),
    ).toMatchObject({ outcome: 'ignored' });
  });

  it('allows one correction, then fails closed without an extension gate', () => {
    const testing: RunSnapshot = {
      ...initialRun(mvpPolicy('autonomous')),
      status: 'testing',
      currentStage: 'test',
      iterationCount: 0,
    };

    const first = advance(testing, {
      name: 'run.iteration.needed',
      payload: { runId: RUN_ID, blockingFindingIds: [], testsPassed: false },
    });
    expect(first).toMatchObject({
      outcome: 'transitioned',
      status: 'executing',
      currentStage: 'code',
      iterationCount: 1,
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'code' }],
    });

    const exhausted: RunSnapshot = { ...testing, iterationCount: 1 };
    const stopped = advance(exhausted, {
      name: 'run.iteration.needed',
      payload: { runId: RUN_ID, blockingFindingIds: [], testsPassed: false },
    });
    expect(stopped).toMatchObject({
      outcome: 'transitioned',
      status: 'failed',
      currentStage: 'test',
      commands: [],
      error: expect.stringContaining('Correction limit reached'),
    });
  });

  it('skips a second review after the corrective coding pass', () => {
    const corrected: RunSnapshot = {
      ...initialRun(mvpPolicy('autonomous')),
      status: 'executing',
      currentStage: 'code',
      iterationCount: 1,
    };
    expect(advance(corrected, stageCompleted('code'))).toMatchObject({
      outcome: 'transitioned',
      status: 'testing',
      currentStage: 'test',
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'test' }],
    });
  });

  it('repairs a legacy failed second-review state by retrying at test', () => {
    const staleSecondReview: RunSnapshot = {
      ...initialRun(mvpPolicy('autonomous')),
      status: 'failed',
      currentStage: 'review',
      iterationCount: 1,
    };

    expect(
      advance(staleSecondReview, {
        name: 'run.retry.requested',
        payload: { runId: RUN_ID },
      }),
    ).toMatchObject({
      outcome: 'transitioned',
      status: 'testing',
      currentStage: 'test',
      clearError: true,
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'test' }],
    });
  });

  it('does not let a historical iteration-extension gate reopen coding', () => {
    const parked: RunSnapshot = {
      ...initialRun({ ...mvpPolicy('autonomous'), iterationBudget: 4 }),
      status: 'awaiting_iteration_gate',
      currentStage: 'test',
      iterationCount: 1,
    };
    expect(advance(parked, gateResolved('iteration_extension', 'approved'))).toMatchObject({
      outcome: 'transitioned',
      status: 'failed',
      commands: [],
    });
  });

  it('ignores a gate resolution that does not match the parked gate', () => {
    const { run } = replay(initialRun(mvpPolicy('plan_gated')), [
      created,
      stageCompleted('intake'),
      stageCompleted('classify'),
      stageCompleted('research'),
      stageCompleted('plan'),
    ]);
    expect(advance(run, gateResolved('final_pr', 'approved'))).toMatchObject({ outcome: 'ignored' });
  });
});
