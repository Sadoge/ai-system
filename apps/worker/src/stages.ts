import { eq } from 'drizzle-orm';
import { agentRuns, pipelineRuns, stageExecutions, type Db } from '@ai-system/db';
import { StageKind, TicketSnapshot, uuidv7 } from '@ai-system/domain';
import { applyEvent } from '@ai-system/orchestration';
import { createArtifact } from './artifacts.js';

/**
 * Phase 0 stage handlers for the trivial pipeline (docs/10 Phase 0):
 * intake validates and snapshots the ticket; echo_agent is a deterministic
 * stand-in for a real agent — it exercises the whole execution path
 * (agent_runs row, artifact, completion event) without needing an API key.
 */
export async function executeStage(db: Db, input: { runId: string; stage: string }): Promise<void> {
  const stage = StageKind.parse(input.stage);
  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.runId));
  const run = runRows[0];
  if (!run) throw new Error(`unknown run ${input.runId}`);

  // Idempotency guard: a redelivered job for a stage the run has moved past is a no-op.
  if (run.currentStage !== stage) return;

  const stageExecutionId = uuidv7();
  await db.insert(stageExecutions).values({
    id: stageExecutionId,
    runId: run.id,
    stage,
    status: 'running',
    startedAt: new Date(),
  });
  await applyEvent(db, {
    name: 'run.stage.started',
    payload: { runId: run.id, stageExecutionId, stage },
  });

  try {
    const artifactIds = await runStage(db, stage, run);
    await db
      .update(stageExecutions)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(stageExecutions.id, stageExecutionId));
    await applyEvent(db, {
      name: 'run.stage.completed',
      payload: { runId: run.id, stageExecutionId, stage, artifactIds },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(stageExecutions)
      .set({ status: 'failed', error: reason, finishedAt: new Date() })
      .where(eq(stageExecutions.id, stageExecutionId));
    await applyEvent(db, {
      name: 'run.stage.failed',
      payload: { runId: run.id, stageExecutionId, stage, reason },
    });
  }
}

type RunRow = typeof pipelineRuns.$inferSelect;

async function runStage(db: Db, stage: StageKind, run: RunRow): Promise<string[]> {
  switch (stage) {
    case 'intake':
      return intakeStage(db, run);
    case 'echo_agent':
      return echoAgentStage(db, run);
    default:
      throw new Error(`stage ${stage} has no Phase 0 handler`);
  }
}

async function intakeStage(db: Db, run: RunRow): Promise<string[]> {
  const ticket = TicketSnapshot.parse(run.ticket);
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'ticket_snapshot',
    content: ticket,
  });
  return [artifactId];
}

async function echoAgentStage(db: Db, run: RunRow): Promise<string[]> {
  const ticket = TicketSnapshot.parse(run.ticket);
  const agentRunId = uuidv7();
  await db.insert(agentRuns).values({
    id: agentRunId,
    runId: run.id,
    agentKind: 'echo',
    executorKind: 'builtin',
    status: 'running',
    startedAt: new Date(),
  });

  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'echo_output',
    content: {
      message: `ECHO: ${ticket.title}`,
      descriptionLength: ticket.description.length,
    },
    createdByAgentRunId: agentRunId,
  });

  await db
    .update(agentRuns)
    .set({ status: 'succeeded', finishedAt: new Date() })
    .where(eq(agentRuns.id, agentRunId));
  return [artifactId];
}
