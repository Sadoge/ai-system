import { and, eq, sql } from 'drizzle-orm';
import { modelCalls, pipelineRuns, reviewFindings, tasks, type Db } from '@ai-system/db';
import {
  AutomationLevel,
  PolicySnapshot,
  TicketSnapshot,
  defaultMvpPolicy,
  defaultTeamPolicy,
  defaultTrivialPolicy,
} from '@ai-system/domain';
import { startRun } from './runtime.js';

/**
 * Evaluation harness (docs/10 Phase 4): replay a historical ticket through the
 * pipeline as it is configured TODAY — current prompts, models, and approved
 * rules — and diff the outcome against the original run.
 *
 * Two properties are deliberate:
 * - The replay's policy is rebuilt from current defaults, not copied from the
 *   frozen snapshot: the question being asked is "did our changes help?", and
 *   the changes include policy.
 * - Eval runs never feed the learning loop or analytics, so measuring the
 *   platform cannot change it.
 */
export async function startEvalReplay(
  db: Db,
  input: { sourceRunId: string; organizationId: string },
): Promise<{ evalRunId: string }> {
  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.id, input.sourceRunId),
        eq(pipelineRuns.organizationId, input.organizationId),
      ),
    );
  const source = rows[0];
  if (!source) throw new Error(`unknown source run ${input.sourceRunId}`);
  if (source.evalOfRunId) throw new Error('refusing to replay an eval run — replay its source instead');

  const sourcePolicy = PolicySnapshot.parse(source.policySnapshot);
  const automation = AutomationLevel.parse(sourcePolicy.automationLevel);
  const policy =
    sourcePolicy.pipeline === 'team'
      ? defaultTeamPolicy(automation)
      : sourcePolicy.pipeline === 'mvp_linear'
        ? defaultMvpPolicy(automation === 'autonomous' ? 'autonomous' : 'plan_gated')
        : defaultTrivialPolicy();

  const { runId } = await startRun(db, {
    organizationId: source.organizationId,
    projectId: source.projectId,
    ...(source.repositoryId ? { repositoryId: source.repositoryId } : {}),
    ticket: TicketSnapshot.parse(source.ticket),
    policy,
    evalOfRunId: source.id,
  });
  return { evalRunId: runId };
}

export interface RunMetrics {
  runId: string;
  status: string;
  iterations: number;
  findingsTotal: number;
  findingsBlocking: number;
  taskCount: number;
  costUsd: number;
  durationMinutes: number;
}

/**
 * The final PR gate is never disabled, so an unattended replay parks at
 * awaiting_final_approval rather than completing. For comparison purposes
 * that parked state IS the finish line: the machine did all it is allowed
 * to do on its own.
 */
const EVAL_TERMINAL = ['completed', 'failed', 'cancelled', 'awaiting_final_approval'];

async function metricsFor(db: Db, runId: string): Promise<RunMetrics | null> {
  const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  const run = rows[0];
  if (!run) return null;
  const [findings, taskRows, cost] = await Promise.all([
    db.select().from(reviewFindings).where(eq(reviewFindings.runId, runId)),
    db.select({ count: sql<string>`count(*)` }).from(tasks).where(eq(tasks.runId, runId)),
    db
      .select({ total: sql<string>`coalesce(sum(${modelCalls.costUsd}), 0)` })
      .from(modelCalls)
      .where(eq(modelCalls.runId, runId)),
  ]);
  return {
    runId,
    status: run.status,
    iterations: run.iterationCount,
    findingsTotal: findings.length,
    findingsBlocking: findings.filter((f) => ['blocker', 'major'].includes(f.severity)).length,
    taskCount: Number(taskRows[0]?.count ?? 0),
    costUsd: Number(cost[0]?.total ?? 0),
    durationMinutes: (run.updatedAt.getTime() - run.createdAt.getTime()) / 60_000,
  };
}

export interface EvalComparison {
  ready: boolean;
  source: RunMetrics;
  replay: RunMetrics;
  deltas: Record<string, number>;
}

export async function compareEvalRun(
  db: Db,
  input: { evalRunId: string; organizationId: string },
): Promise<EvalComparison> {
  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.id, input.evalRunId),
        eq(pipelineRuns.organizationId, input.organizationId),
      ),
    );
  const evalRun = rows[0];
  if (!evalRun) throw new Error(`unknown eval run ${input.evalRunId}`);
  if (!evalRun.evalOfRunId) throw new Error(`run ${input.evalRunId} is not an eval replay`);

  const [source, replay] = await Promise.all([
    metricsFor(db, evalRun.evalOfRunId),
    metricsFor(db, input.evalRunId),
  ]);
  if (!source || !replay) throw new Error('source or replay run missing');

  return {
    // Comparing a run that is still moving would produce numbers that change
    // under the reader; callers show "in progress" until this flips.
    ready: EVAL_TERMINAL.includes(replay.status),
    source,
    replay,
    deltas: {
      iterations: replay.iterations - source.iterations,
      findingsTotal: replay.findingsTotal - source.findingsTotal,
      findingsBlocking: replay.findingsBlocking - source.findingsBlocking,
      taskCount: replay.taskCount - source.taskCount,
      costUsd: replay.costUsd - source.costUsd,
      durationMinutes: replay.durationMinutes - source.durationMinutes,
    },
  };
}
