import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  evalSuiteMembers,
  modelCalls,
  pipelineRuns,
  reviewFindings,
  tasks,
  type Db,
} from '@ai-system/db';
import {
  AutomationLevel,
  PolicySnapshot,
  TicketSnapshot,
  defaultMvpPolicy,
  defaultTeamPolicy,
  defaultTrivialPolicy,
  uuidv7,
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

// ── golden suites ─────────────────────────────────────────────────────

/**
 * A single replay answers "did this ticket go better?". That is not the
 * question you actually have after changing a prompt, a model, or an approved
 * rule — the question is whether the change helped *in general*, and one
 * ticket cannot answer it.
 *
 * A suite is a named set of runs whose outcome you were happy with. Replaying
 * all of them and reading the aggregate is the difference between measuring
 * and guessing. Everything below composes the single-run harness above; none
 * of it reaches into the engine.
 */
export const SUITE_METRICS = [
  'iterations',
  'findingsTotal',
  'findingsBlocking',
  'taskCount',
  'costUsd',
  'durationMinutes',
] as const;
export type SuiteMetric = (typeof SUITE_METRICS)[number];

export interface SuiteMember {
  suiteName: string;
  sourceRunId: string;
  note: string | null;
  createdAt: Date;
}

export async function addSuiteMember(
  db: Db,
  input: { organizationId: string; suiteName: string; sourceRunId: string; note?: string },
): Promise<void> {
  const rows = await db
    .select({ evalOfRunId: pipelineRuns.evalOfRunId })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.id, input.sourceRunId),
        eq(pipelineRuns.organizationId, input.organizationId),
      ),
    );
  const run = rows[0];
  if (!run) throw new Error(`unknown run ${input.sourceRunId}`);
  // Same guard as startEvalReplay: a replay is a measurement, never a baseline.
  if (run.evalOfRunId) {
    throw new Error('refusing to add an eval replay to a suite — add its source run instead');
  }

  await db
    .insert(evalSuiteMembers)
    .values({
      id: uuidv7(),
      organizationId: input.organizationId,
      suiteName: input.suiteName,
      sourceRunId: input.sourceRunId,
      note: input.note ?? null,
    })
    // Adding the same run twice is a no-op, not an error — re-running the
    // command after a typo elsewhere should not fail.
    .onConflictDoNothing();
}

export async function listSuiteMembers(
  db: Db,
  input: { organizationId: string; suiteName?: string },
): Promise<SuiteMember[]> {
  const rows = await db
    .select({
      suiteName: evalSuiteMembers.suiteName,
      sourceRunId: evalSuiteMembers.sourceRunId,
      note: evalSuiteMembers.note,
      createdAt: evalSuiteMembers.createdAt,
    })
    .from(evalSuiteMembers)
    .where(
      input.suiteName
        ? and(
            eq(evalSuiteMembers.organizationId, input.organizationId),
            eq(evalSuiteMembers.suiteName, input.suiteName),
          )
        : eq(evalSuiteMembers.organizationId, input.organizationId),
    )
    .orderBy(asc(evalSuiteMembers.suiteName), asc(evalSuiteMembers.createdAt));
  return rows;
}

export async function removeSuiteMember(
  db: Db,
  input: { organizationId: string; suiteName: string; sourceRunId: string },
): Promise<boolean> {
  const removed = await db
    .delete(evalSuiteMembers)
    .where(
      and(
        eq(evalSuiteMembers.organizationId, input.organizationId),
        eq(evalSuiteMembers.suiteName, input.suiteName),
        eq(evalSuiteMembers.sourceRunId, input.sourceRunId),
      ),
    )
    .returning({ id: evalSuiteMembers.id });
  return removed.length > 0;
}

export interface SuiteReplayStart {
  sourceRunId: string;
  evalRunId: string | null;
  /** Why this member could not be replayed. Null when it started cleanly. */
  error: string | null;
}

/**
 * Start a replay for every member. A member that cannot be replayed is
 * reported and skipped rather than aborting the suite — one stale run should
 * not cost you the other nine measurements.
 */
export async function startSuiteReplay(
  db: Db,
  input: { organizationId: string; suiteName: string },
): Promise<SuiteReplayStart[]> {
  const members = await listSuiteMembers(db, input);
  const started: SuiteReplayStart[] = [];
  for (const member of members) {
    try {
      const { evalRunId } = await startEvalReplay(db, {
        sourceRunId: member.sourceRunId,
        organizationId: input.organizationId,
      });
      started.push({ sourceRunId: member.sourceRunId, evalRunId, error: null });
    } catch (err) {
      started.push({
        sourceRunId: member.sourceRunId,
        evalRunId: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return started;
}

export interface SuiteSummary {
  /** Replays that have settled and are safe to average. */
  readyCount: number;
  /** Replays still moving — counted, never averaged. */
  pendingCount: number;
  /** Members that have never been replayed at all. */
  missingCount: number;
  totals: Record<SuiteMetric, number>;
  means: Record<SuiteMetric, number>;
}

/**
 * Aggregate suite deltas. Pure, so it is testable without a database.
 *
 * Only settled replays contribute to totals and means, for the same reason
 * compareEvalRun exposes `ready`: averaging a run that is still moving
 * produces a number that changes under the reader. A `null` entry is a member
 * that has never been replayed.
 */
export function summarizeSuite(entries: readonly (EvalComparison | null)[]): SuiteSummary {
  const zero = () =>
    Object.fromEntries(SUITE_METRICS.map((m) => [m, 0])) as Record<SuiteMetric, number>;
  const totals = zero();
  let readyCount = 0;
  let pendingCount = 0;
  let missingCount = 0;

  for (const entry of entries) {
    if (!entry) {
      missingCount += 1;
      continue;
    }
    if (!entry.ready) {
      pendingCount += 1;
      continue;
    }
    readyCount += 1;
    for (const metric of SUITE_METRICS) totals[metric] += entry.deltas[metric] ?? 0;
  }

  const means = zero();
  if (readyCount > 0) {
    for (const metric of SUITE_METRICS) means[metric] = totals[metric] / readyCount;
  }
  return { readyCount, pendingCount, missingCount, totals, means };
}

export interface SuiteEntry {
  sourceRunId: string;
  note: string | null;
  /** Null when this member has never been replayed. */
  comparison: EvalComparison | null;
}

export interface SuiteReport {
  suiteName: string;
  entries: SuiteEntry[];
  summary: SuiteSummary;
}

/**
 * Compare each member against its most recent replay. The link is already
 * recorded by pipeline_runs.eval_of_run_id, so a suite report needs no state
 * of its own beyond the membership list.
 */
export async function reportSuite(
  db: Db,
  input: { organizationId: string; suiteName: string },
): Promise<SuiteReport> {
  const members = await listSuiteMembers(db, input);
  const entries = await Promise.all(
    members.map(async (member): Promise<SuiteEntry> => {
      // Indexed by pipeline_runs_eval_idx; one row, never the whole history.
      const latest = await db
        .select({ id: pipelineRuns.id })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.evalOfRunId, member.sourceRunId))
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(1);
      const replay = latest[0];
      if (!replay) {
        return { sourceRunId: member.sourceRunId, note: member.note, comparison: null };
      }
      return {
        sourceRunId: member.sourceRunId,
        note: member.note,
        comparison: await compareEvalRun(db, {
          evalRunId: replay.id,
          organizationId: input.organizationId,
        }),
      };
    }),
  );

  return {
    suiteName: input.suiteName,
    entries,
    summary: summarizeSuite(entries.map((e) => e.comparison)),
  };
}
