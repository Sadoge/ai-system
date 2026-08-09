import { describe, expect, it } from 'vitest';
import { defaultTeamPolicy, type DomainEvent, type PolicySnapshot } from '@ai-system/domain';
import { advance } from '../src/engine.js';
import { assertDag, InvalidTaskGraphError } from '../src/tasks.js';
import type { RunSnapshot, TaskSnapshot } from '../src/types.js';

const RUN_ID = '01936b00-0000-7000-8000-000000000001';
const T = {
  a: '01936b00-0000-7000-8000-0000000000a1',
  b: '01936b00-0000-7000-8000-0000000000b2',
  c: '01936b00-0000-7000-8000-0000000000c3',
};

function task(id: string, over: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return { id, status: 'created', dependsOn: [], attemptCount: 0, maxAttempts: 2, ...over };
}

/** A team run sitting in the task stage with the given DAG. */
function runWithTasks(tasks: TaskSnapshot[], maxParallelTasks = 3): RunSnapshot {
  const policy: PolicySnapshot = { ...defaultTeamPolicy('autonomous'), maxParallelTasks };
  return {
    runId: RUN_ID,
    status: 'executing',
    currentStage: 'code',
    version: 1,
    policy,
    iterationCount: 0,
    tasks,
  };
}

function completed(taskId: string): DomainEvent {
  return { name: 'task.completed', payload: { runId: RUN_ID, taskId } };
}
function failed(taskId: string, reason = 'boom'): DomainEvent {
  return { name: 'task.failed', payload: { runId: RUN_ID, taskId, reason } };
}
function dispatchedIds(result: ReturnType<typeof advance>): string[] {
  if (result.outcome !== 'transitioned') return [];
  return result.commands
    .filter((c): c is Extract<typeof c, { kind: 'execute_task' }> => c.kind === 'execute_task')
    .map((c) => c.taskId);
}

describe('task DAG fan-out', () => {
  it('dispatches independent tasks in parallel up to the policy limit', () => {
    const run = runWithTasks([task(T.a), task(T.b), task(T.c)], 2);
    // Entering the task stage happens when `decompose` completes.
    const result = advance(run, {
      name: 'run.stage.completed',
      payload: {
        runId: RUN_ID,
        stageExecutionId: RUN_ID,
        stage: 'decompose',
        artifactIds: [],
      },
    });
    // currentStage must be `decompose` for that event to apply.
    const atDecompose: RunSnapshot = { ...run, status: 'decomposing', currentStage: 'decompose' };
    const entered = advance(atDecompose, {
      name: 'run.stage.completed',
      payload: { runId: RUN_ID, stageExecutionId: RUN_ID, stage: 'decompose', artifactIds: [] },
    });
    expect(result.outcome).toBe('ignored'); // guard: stale stage
    expect(entered).toMatchObject({ outcome: 'transitioned', status: 'executing', currentStage: 'code' });
    expect(dispatchedIds(entered)).toEqual([T.a, T.b]); // third waits for a free slot
    expect(entered.outcome === 'transitioned' && entered.taskUpdates).toEqual([
      { taskId: T.a, status: 'running' },
      { taskId: T.b, status: 'running' },
    ]);
  });

  it('respects dependencies: a dependent task waits for its dependency', () => {
    const run = runWithTasks([task(T.a), task(T.b, { dependsOn: [T.a] })], 3);
    const atDecompose: RunSnapshot = { ...run, status: 'decomposing', currentStage: 'decompose' };
    const entered = advance(atDecompose, {
      name: 'run.stage.completed',
      payload: { runId: RUN_ID, stageExecutionId: RUN_ID, stage: 'decompose', artifactIds: [] },
    });
    expect(dispatchedIds(entered)).toEqual([T.a]);

    const afterA = runWithTasks([task(T.a, { status: 'running' }), task(T.b, { dependsOn: [T.a] })], 3);
    const result = advance(afterA, completed(T.a));
    expect(dispatchedIds(result)).toEqual([T.b]);
    expect(result.outcome === 'transitioned' && result.taskUpdates).toEqual([
      { taskId: T.a, status: 'completed' },
      { taskId: T.b, status: 'running' },
    ]);
  });

  it('holds position while other tasks are still running', () => {
    const run = runWithTasks(
      [task(T.a, { status: 'running' }), task(T.b, { status: 'running' })],
      2,
    );
    const result = advance(run, completed(T.a));
    expect(result).toMatchObject({ outcome: 'transitioned', status: 'executing', currentStage: 'code' });
    expect(dispatchedIds(result)).toEqual([]);
    expect(result.outcome === 'transitioned' && result.taskUpdates).toEqual([
      { taskId: T.a, status: 'completed' },
    ]);
  });

  it('fans in to the next stage only when the whole DAG is complete', () => {
    const run = runWithTasks([task(T.a, { status: 'completed' }), task(T.b, { status: 'running' })], 2);
    const result = advance(run, completed(T.b));
    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'integrating',
      currentStage: 'integrate',
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'integrate' }],
    });
  });

  it('ignores a duplicate task completion', () => {
    const run = runWithTasks([task(T.a, { status: 'completed' }), task(T.b, { status: 'running' })], 2);
    expect(advance(run, completed(T.a))).toMatchObject({ outcome: 'ignored' });
  });
});

describe('task failure handling', () => {
  it('retries a failed task while attempts remain', () => {
    const run = runWithTasks([task(T.a, { status: 'running', attemptCount: 1, maxAttempts: 2 })], 2);
    const result = advance(run, failed(T.a));
    expect(dispatchedIds(result)).toEqual([T.a]);
    expect(result.outcome === 'transitioned' && result.taskUpdates).toEqual([
      { taskId: T.a, status: 'created' },
      { taskId: T.a, status: 'running' },
    ]);
  });

  it('fails the run when a task exhausts its attempts — never a partial merge', () => {
    const run = runWithTasks(
      [task(T.a, { status: 'running', attemptCount: 2, maxAttempts: 2 }), task(T.b)],
      2,
    );
    const result = advance(run, failed(T.a, 'agent crashed'));
    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'failed',
      commands: [],
      taskUpdates: [{ taskId: T.a, status: 'failed' }],
    });
    expect(result.outcome === 'transitioned' && result.error).toContain('agent crashed');
  });

  it('ignores a failure for an unknown task', () => {
    const run = runWithTasks([task(T.a, { status: 'running' })], 2);
    expect(advance(run, failed(T.c))).toMatchObject({ outcome: 'ignored' });
  });

  it('fails a DAG that cannot progress rather than hanging', () => {
    // B still has retries left, but its dependency A is failed and will never
    // complete — retrying B forever would hang the run, so the engine stops.
    const stuck = runWithTasks(
      [task(T.a, { status: 'failed' }), task(T.b, { dependsOn: [T.a], status: 'running' })],
      2,
    );
    const result = advance(stuck, failed(T.b, 'gave up'));
    expect(result).toMatchObject({ outcome: 'transitioned', status: 'failed' });
    expect(result.outcome === 'transitioned' && result.error).toContain('cannot progress');
  });
});

describe('team pipeline iteration', () => {
  it('re-enters decompose (not code) so fix tasks exist before fanning out', () => {
    const atTest: RunSnapshot = {
      ...runWithTasks([task(T.a, { status: 'completed' })]),
      status: 'testing',
      currentStage: 'test',
    };
    const result = advance(atTest, {
      name: 'run.iteration.needed',
      payload: { runId: RUN_ID, blockingFindingIds: [], testsPassed: false },
    });
    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'decomposing',
      currentStage: 'decompose',
      iterationCount: 1,
      commands: [{ kind: 'execute_stage', runId: RUN_ID, stage: 'decompose' }],
    });
  });

  it('parks at the pre-merge gate after integration when the level enables it', () => {
    const policy: PolicySnapshot = {
      ...defaultTeamPolicy('code_gated'),
      maxParallelTasks: 2,
    };
    const atIntegrate: RunSnapshot = {
      ...runWithTasks([task(T.a, { status: 'completed' })]),
      policy,
      status: 'integrating',
      currentStage: 'integrate',
    };
    const result = advance(atIntegrate, {
      name: 'run.stage.completed',
      payload: { runId: RUN_ID, stageExecutionId: RUN_ID, stage: 'integrate', artifactIds: [] },
    });
    expect(result).toMatchObject({
      outcome: 'transitioned',
      status: 'awaiting_pre_merge',
      commands: [{ kind: 'request_gate', runId: RUN_ID, gate: 'pre_merge' }],
    });

    const parked: RunSnapshot = { ...atIntegrate, status: 'awaiting_pre_merge' };
    expect(
      advance(parked, {
        name: 'run.gate.resolved',
        payload: {
          runId: RUN_ID,
          gateRequestId: RUN_ID,
          gate: 'pre_merge',
          decision: 'approved',
        },
      }),
    ).toMatchObject({ outcome: 'transitioned', status: 'reviewing', currentStage: 'review' });
  });
});

describe('assertDag', () => {
  it('accepts a valid DAG', () => {
    expect(() =>
      assertDag([
        { key: 'a', title: 'a', spec: {}, dependsOn: [] },
        { key: 'b', title: 'b', spec: {}, dependsOn: ['a'] },
        { key: 'c', title: 'c', spec: {}, dependsOn: ['a', 'b'] },
      ]),
    ).not.toThrow();
  });

  it('rejects cycles, self-references, and unknown dependencies', () => {
    expect(() =>
      assertDag([
        { key: 'a', title: 'a', spec: {}, dependsOn: ['b'] },
        { key: 'b', title: 'b', spec: {}, dependsOn: ['a'] },
      ]),
    ).toThrow(InvalidTaskGraphError);
    expect(() => assertDag([{ key: 'a', title: 'a', spec: {}, dependsOn: ['a'] }])).toThrow(
      InvalidTaskGraphError,
    );
    expect(() => assertDag([{ key: 'a', title: 'a', spec: {}, dependsOn: ['ghost'] }])).toThrow(
      /unknown task/,
    );
  });
});
