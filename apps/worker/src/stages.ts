import { eq } from 'drizzle-orm';
import { agentRuns, pipelineRuns, stageExecutions, type Db } from '@ai-system/db';
import { StageKind, TicketSnapshot, uuidv7 } from '@ai-system/domain';
import { applyEvent } from '@ai-system/orchestration';
import { createArtifact } from './artifacts.js';
import {
  classifyStage,
  codeStage,
  packageStage,
  planStage,
  researchStage,
  reviewStage,
  testStage,
} from './mvp-stages.js';
import type { StageServices } from './services.js';

export interface StageOutcome {
  artifactIds: string[];
  /**
   * True when the handler emitted its own transition event (epic
   * classification, iteration needed) — stage.completed must not fire.
   */
  suppressCompletion?: boolean;
}

export type RunRow = typeof pipelineRuns.$inferSelect;

export async function executeStage(
  services: StageServices,
  input: { runId: string; stage: string },
): Promise<void> {
  const { db } = services;
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
    const outcome = await runStage(services, stage, run);
    await db
      .update(stageExecutions)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(stageExecutions.id, stageExecutionId));
    if (!outcome.suppressCompletion) {
      await applyEvent(db, {
        name: 'run.stage.completed',
        payload: { runId: run.id, stageExecutionId, stage, artifactIds: outcome.artifactIds },
      });
    }
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

async function runStage(
  services: StageServices,
  stage: StageKind,
  run: RunRow,
): Promise<StageOutcome> {
  switch (stage) {
    case 'intake':
      return intakeStage(services.db, run);
    case 'echo_agent':
      return echoAgentStage(services.db, run);
    case 'classify':
      return classifyStage(services, run);
    case 'research':
      return researchStage(services, run);
    case 'plan':
      return planStage(services, run);
    case 'code':
      return codeStage(services, run);
    case 'review':
      return reviewStage(services, run);
    case 'test':
      return testStage(services, run);
    case 'package':
      return packageStage(services, run);
    default:
      throw new Error(`stage ${stage} has no handler`);
  }
}

async function intakeStage(db: Db, run: RunRow): Promise<StageOutcome> {
  const ticket = TicketSnapshot.parse(run.ticket);
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'ticket_snapshot',
    content: ticket,
  });
  return { artifactIds: [artifactId] };
}

async function echoAgentStage(db: Db, run: RunRow): Promise<StageOutcome> {
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
  return { artifactIds: [artifactId] };
}
