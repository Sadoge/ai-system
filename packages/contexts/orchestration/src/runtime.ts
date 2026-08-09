import { and, eq } from 'drizzle-orm';
import { domainEvents, outbox, pipelineRuns, type Db, type DbTx } from '@ai-system/db';
import {
  PolicySnapshot,
  RunStatus,
  StageKind,
  uuidv7,
  type DomainEvent,
  type TicketSnapshot,
} from '@ai-system/domain';
import { advance } from './engine.js';
import type { Command, RunSnapshot } from './types.js';

type Executor = Db | DbTx;

export class ConcurrencyConflictError extends Error {
  constructor(runId: string) {
    super(`Concurrent modification of run ${runId}`);
  }
}

export type ApplyOutcome =
  | { outcome: 'transitioned'; status: RunSnapshot['status']; commands: Command[] }
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'recorded' };

const COMMAND_JOB_NAMES: Record<Command['kind'], string> = {
  execute_stage: 'stage.execute',
  request_gate: 'gate.request',
};

/**
 * Apply one domain event: record it, run advance(), persist the transition
 * with a version CAS, and append resulting commands to the outbox — all in
 * one transaction (docs/04 §3: no dual writes).
 */
export async function applyEvent(db: Db, event: DomainEvent): Promise<ApplyOutcome> {
  return db.transaction((tx) => applyEventTx(tx, event));
}

export async function applyEventTx(tx: Executor, event: DomainEvent): Promise<ApplyOutcome> {
  const runId =
    'runId' in event.payload && typeof event.payload.runId === 'string'
      ? event.payload.runId
      : undefined;

  await tx.insert(domainEvents).values({
    id: uuidv7(),
    runId: runId ?? null,
    name: event.name,
    payload: event.payload,
  });

  if (!runId) return { outcome: 'recorded' };

  const rows = await tx
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .for('update');
  const row = rows[0];
  if (!row) return { outcome: 'ignored', reason: `unknown run ${runId}` };

  const snapshot: RunSnapshot = {
    runId: row.id,
    status: RunStatus.parse(row.status),
    currentStage: row.currentStage ? StageKind.parse(row.currentStage) : null,
    version: row.version,
    policy: PolicySnapshot.parse(row.policySnapshot),
    iterationCount: row.iterationCount,
  };

  const result = advance(snapshot, event);
  if (result.outcome === 'ignored') return result;

  const updated = await tx
    .update(pipelineRuns)
    .set({
      status: result.status,
      currentStage: result.currentStage,
      error: result.error ?? row.error,
      version: row.version + 1,
      updatedAt: new Date(),
      ...(result.iterationCount !== undefined ? { iterationCount: result.iterationCount } : {}),
    })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.version, row.version)))
    .returning({ id: pipelineRuns.id });
  if (updated.length === 0) throw new ConcurrencyConflictError(runId);

  if (result.commands.length > 0) {
    await tx.insert(outbox).values(
      result.commands.map((command) => ({
        id: uuidv7(),
        jobName: COMMAND_JOB_NAMES[command.kind],
        payload: command,
      })),
    );
  }

  return { outcome: 'transitioned', status: result.status, commands: result.commands };
}

export interface StartRunInput {
  organizationId: string;
  projectId: string;
  repositoryId?: string;
  ticket: TicketSnapshot;
  policy: PolicySnapshot;
}

/** Create the run row and apply run.created in a single transaction. */
export async function startRun(db: Db, input: StartRunInput): Promise<{ runId: string }> {
  const runId = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(pipelineRuns).values({
      id: runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      repositoryId: input.repositoryId ?? null,
      status: 'created',
      policySnapshot: input.policy,
      ticket: input.ticket,
    });
    await applyEventTx(tx, {
      name: 'run.created',
      payload: { runId, projectId: input.projectId, ticket: input.ticket },
    });
  });
  return { runId };
}

export async function getRun(db: Db, runId: string) {
  const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  return rows[0] ?? null;
}
