import { eq } from 'drizzle-orm';
import { gateDecisions, gateRequests, type Db } from '@ai-system/db';
import { GateDecisionKind, GateKind, uuidv7 } from '@ai-system/domain';
import { applyEvent } from './runtime.js';

/** Handler for the `gate.request` job: materialize the pending approval item. */
export async function createGateRequest(
  db: Db,
  input: { runId: string; gate: GateKind; payload?: Record<string, unknown> },
): Promise<{ gateRequestId: string }> {
  const gateRequestId = uuidv7();
  await db.insert(gateRequests).values({
    id: gateRequestId,
    runId: input.runId,
    gate: input.gate,
    payload: input.payload ?? {},
  });
  await applyEvent(db, {
    name: 'run.gate.requested',
    payload: { runId: input.runId, gateRequestId, gate: input.gate },
  });
  return { gateRequestId };
}

/** Human decision entry point (API/CLI): record the decision, then let the engine resume the run. */
export async function resolveGate(
  db: Db,
  input: {
    gateRequestId: string;
    decision: GateDecisionKind;
    comment?: string;
    decidedByUserId?: string;
  },
): Promise<void> {
  const rows = await db.select().from(gateRequests).where(eq(gateRequests.id, input.gateRequestId));
  const request = rows[0];
  if (!request) throw new Error(`Unknown gate request ${input.gateRequestId}`);
  if (request.status !== 'pending') throw new Error(`Gate request ${input.gateRequestId} already resolved`);

  await db.transaction(async (tx) => {
    await tx.insert(gateDecisions).values({
      id: uuidv7(),
      gateRequestId: request.id,
      decision: input.decision,
      comment: input.comment ?? null,
      decidedByUserId: input.decidedByUserId ?? null,
    });
    await tx
      .update(gateRequests)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(gateRequests.id, request.id));
  });

  await applyEvent(db, {
    name: 'run.gate.resolved',
    payload: {
      runId: request.runId,
      gateRequestId: request.id,
      gate: GateKind.parse(request.gate),
      decision: input.decision,
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    },
  });
}
