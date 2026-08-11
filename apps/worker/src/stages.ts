import { and, desc, eq } from 'drizzle-orm';
import { agentRuns, pipelineRuns, stageExecutions, type Db } from '@ai-system/db';
import { PolicySnapshot, StageKind, TicketSnapshot, uuidv7 } from '@ai-system/domain';
import { applyEvent, pipelineFor } from '@ai-system/orchestration';
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
import { decomposeStage, documentStage, executeTask, integrateStage } from './team-stages.js';
import type { StageServices } from './services.js';
import { reportActivity } from './activity.js';

export interface StageOutcome {
  artifactIds: string[];
  /**
   * True when the handler emitted its own transition event (epic
   * classification, iteration needed) — stage.completed must not fire.
   */
  suppressCompletion?: boolean;
}

export type RunRow = typeof pipelineRuns.$inferSelect;

type StageGuardRun = Pick<RunRow, 'currentStage' | 'status' | 'policySnapshot'>;

export function shouldExecuteStage(run: StageGuardRun, stage: StageKind): boolean {
  if (run.currentStage !== stage) return false;
  const policy = PolicySnapshot.parse(run.policySnapshot);
  return run.status === pipelineFor(policy).statusDuring(stage);
}

export async function executeStage(
  services: StageServices,
  input: { runId: string; stage: string },
): Promise<void> {
  const { db } = services;
  const stage = StageKind.parse(input.stage);
  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.runId));
  const run = runRows[0];
  if (!run) throw new Error(`unknown run ${input.runId}`);

  // A completed/failed/gated run retains its last currentStage. Require the
  // matching active status too, or pg-boss redelivery restarts terminal work.
  if (!shouldExecuteStage(run, stage)) return;

  const previousAttempts = await db
    .select({ attempt: stageExecutions.attempt })
    .from(stageExecutions)
    .where(and(eq(stageExecutions.runId, run.id), eq(stageExecutions.stage, stage)))
    .orderBy(desc(stageExecutions.createdAt))
    .limit(1);
  const attempt = (previousAttempts[0]?.attempt ?? 0) + 1;
  const stageExecutionId = uuidv7();
  await db.insert(stageExecutions).values({
    id: stageExecutionId,
    runId: run.id,
    stage,
    status: 'running',
    attempt,
    startedAt: new Date(),
  });
  await applyEvent(db, {
    name: 'run.stage.started',
    payload: { runId: run.id, stageExecutionId, stage },
  });
  await reportActivity(
    db,
    { runId: run.id, stage, stageExecutionId },
    { kind: 'stage', message: STAGE_ACTIVITY[stage] },
  );

  try {
    const outcome = await runStage(services, stage, run);
    if (await runWasCancelled(db, run.id)) return;
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
    if (await runWasCancelled(db, run.id)) return;
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

async function runWasCancelled(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .select({ status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .limit(1);
  return rows[0]?.status === 'cancelled';
}

const STAGE_ACTIVITY: Record<StageKind, string> = {
  intake: 'Capturing the ticket snapshot',
  echo_agent: 'Running the echo agent',
  classify: 'Classifying ticket complexity',
  research: 'Gathering repository and Project Brain context',
  plan: 'Drafting the implementation plan',
  decompose: 'Building the task dependency graph',
  code: 'Preparing the coding worktree and agent',
  integrate: 'Merging completed task branches',
  review: 'Reviewing the implementation for findings',
  test: 'Running repository validation and tests',
  document: 'Writing implementation documentation',
  package: 'Preparing the pull-request package',
};

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
    case 'decompose':
      return decomposeStage(services, run);
    case 'code':
      return codeStage(services, run);
    case 'integrate':
      return integrateStage(services, run);
    case 'review':
      return reviewStage(services, run);
    case 'test':
      return testStage(services, run);
    case 'document':
      return documentStage(services, run);
    case 'package':
      return packageStage(services, run);
    default:
      throw new Error(`stage ${stage} has no handler`);
  }
}

/** Entry point for the `task.execute` job: one DAG node, one worktree. */
export async function runTask(
  services: StageServices,
  input: { runId: string; taskId: string },
): Promise<void> {
  const runRows = await services.db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, input.runId));
  const run = runRows[0];
  if (!run) throw new Error(`unknown run ${input.runId}`);
  await executeTask(services, input, run);
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
