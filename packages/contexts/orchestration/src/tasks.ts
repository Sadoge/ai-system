import { and, eq, inArray } from 'drizzle-orm';
import { agentRuns, taskDependencies, tasks as tasksTable, type Db } from '@ai-system/db';
import { uuidv7, type TaskOrigin } from '@ai-system/domain';
import { applyEvent } from './runtime.js';

export interface TaskDraft {
  /** Stable key used only to express dependencies within this batch. */
  key: string;
  title: string;
  spec: Record<string, unknown>;
  dependsOn: string[];
}

export class InvalidTaskGraphError extends Error {}

/**
 * Materialize a decomposition into task rows + dependency edges. Rejects
 * unknown references and cycles here, so the engine only ever sees a DAG it
 * can actually drain.
 */
export async function createTasks(
  db: Db,
  input: { runId: string; drafts: TaskDraft[]; origin: TaskOrigin; maxAttempts: number },
): Promise<{ taskIds: string[] }> {
  assertDag(input.drafts);

  const idByKey = new Map(input.drafts.map((d) => [d.key, uuidv7()]));
  await db.transaction(async (tx) => {
    for (const draft of input.drafts) {
      await tx.insert(tasksTable).values({
        id: idByKey.get(draft.key)!,
        runId: input.runId,
        title: draft.title,
        spec: draft.spec,
        status: 'created',
        origin: input.origin,
        maxAttempts: input.maxAttempts,
      });
    }
    for (const draft of input.drafts) {
      for (const dep of draft.dependsOn) {
        await tx.insert(taskDependencies).values({
          taskId: idByKey.get(draft.key)!,
          dependsOnTaskId: idByKey.get(dep)!,
        });
      }
    }
  });

  for (const draft of input.drafts) {
    await applyEvent(db, {
      name: 'task.created',
      payload: {
        runId: input.runId,
        taskId: idByKey.get(draft.key)!,
        title: draft.title,
        dependsOn: draft.dependsOn.map((k) => idByKey.get(k)!),
      },
    });
  }
  return { taskIds: [...idByKey.values()] };
}

/** Depth-first cycle detection over the draft graph. */
export function assertDag(drafts: TaskDraft[]): void {
  const byKey = new Map(drafts.map((d) => [d.key, d]));
  if (byKey.size !== drafts.length) throw new InvalidTaskGraphError('duplicate task keys');
  for (const draft of drafts) {
    for (const dep of draft.dependsOn) {
      if (!byKey.has(dep)) {
        throw new InvalidTaskGraphError(`task "${draft.key}" depends on unknown task "${dep}"`);
      }
      if (dep === draft.key) throw new InvalidTaskGraphError(`task "${draft.key}" depends on itself`);
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string, path: string[]): void => {
    const seen = state.get(key);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      throw new InvalidTaskGraphError(`dependency cycle: ${[...path, key].join(' -> ')}`);
    }
    state.set(key, 'visiting');
    for (const dep of byKey.get(key)!.dependsOn) visit(dep, [...path, key]);
    state.set(key, 'done');
  };
  for (const draft of drafts) visit(draft.key, []);
}

export async function getTask(db: Db, runId: string, taskId: string) {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.runId, runId)));
  return rows[0] ?? null;
}

export async function listTasks(db: Db, runId: string) {
  const rows = await db.select().from(tasksTable).where(eq(tasksTable.runId, runId));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const deps = await db.select().from(taskDependencies).where(inArray(taskDependencies.taskId, ids));
  // Which agent actually executed each task — useful when repositories run
  // different coding CLIs.
  const runsForTasks = await db
    .select({
      taskId: agentRuns.taskId,
      executorKind: agentRuns.executorKind,
      costUsd: agentRuns.costUsd,
    })
    .from(agentRuns)
    .where(inArray(agentRuns.taskId, ids));

  return rows.map((row) => {
    const agentRun = runsForTasks.find((a) => a.taskId === row.id);
    return {
      ...row,
      dependsOn: deps.filter((d) => d.taskId === row.id).map((d) => d.dependsOnTaskId),
      executorKind: agentRun?.executorKind ?? null,
      agentCostUsd: agentRun ? Number(agentRun.costUsd) : 0,
    };
  });
}
