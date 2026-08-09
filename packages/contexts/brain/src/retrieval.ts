import { sql } from 'drizzle-orm';
import { contextGrants, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import type { BrainContext } from './types.js';

/**
 * Retrieval tuning from outcomes (docs/08 §4).
 *
 * The platform records what Brain material each run received, then reads the
 * outcomes back to answer "which context correlates with first-pass success".
 * Two deliberate limits keep this honest:
 *
 *  - It is correlation. Material is granted because it looked relevant, and
 *    relevance is not random, so a rule can look "ineffective" simply because
 *    it is granted on the hard tickets. Every surface labels it as such.
 *  - The prior it produces is a *nudge* applied after nearest-neighbour search,
 *    bounded to ±PRIOR_MAX_ADJUSTMENT. It reorders what similarity already
 *    retrieved; it can never pull in material similarity rejected, and it never
 *    touches approved rules, which are always included in full.
 */

/** Below this many settled runs a source has no usable signal at all. */
export const PRIOR_MIN_SAMPLE = 3;
/** Hard ceiling on how far a prior may move a cosine score. */
export const PRIOR_MAX_ADJUSTMENT = 0.05;

export interface ContextGrantInput {
  organizationId: string;
  projectId: string;
  runId: string;
  context: BrainContext;
}

/**
 * Record one row per (run, source). Re-assembling context in a later stage of
 * the same run is a no-op: the grant means "this run saw this material", not
 * "how many times". Rules are written first, so when a rule is also a semantic
 * hit the row keeps the stronger `rules` attribution.
 */
export async function recordContextGrants(
  db: Db,
  input: ContextGrantInput,
): Promise<{ recorded: number }> {
  const rows: (typeof contextGrants.$inferInsert)[] = [];

  input.context.rules.forEach((rule, i) => {
    rows.push({
      id: uuidv7(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      runId: input.runId,
      sourceType: 'knowledge_item',
      sourceId: rule.id,
      title: rule.title,
      section: 'rules',
      rank: i,
      score: null,
    });
  });
  const ranked: [string, BrainContext['related']][] = [
    ['related', input.context.related],
    ['episodes', input.context.episodes],
  ];
  for (const [section, hits] of ranked) {
    hits.forEach((hit, i) => {
      rows.push({
        id: uuidv7(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        runId: input.runId,
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        title: hit.title,
        section,
        rank: i,
        score: hit.score.toFixed(6),
      });
    });
  }
  if (rows.length === 0) return { recorded: 0 };

  await db.insert(contextGrants).values(rows).onConflictDoNothing();
  return { recorded: rows.length };
}

export interface ContextEffectivenessRow {
  sourceType: string;
  sourceId: string;
  title: string;
  section: string;
  /** Runs that received this material and have since settled. */
  settledRuns: number;
  /** Of those, how many needed no iteration. */
  firstPassRuns: number;
  firstPassRate: number;
  avgIterations: number;
}

export interface ContextEffectiveness {
  /** First-pass rate across all settled runs — the number a row must beat. */
  baselineFirstPassRate: number;
  baselineRuns: number;
  rows: ContextEffectivenessRow[];
}

/**
 * A run is "settled" once it reached the final gate or stopped for good; it is a
 * first-pass success when it settled without failing and consumed no iteration.
 * Eval replays are excluded here exactly as they are from analytics: measuring
 * the platform must not move the platform's own numbers.
 */
const SETTLED = sql`r.status in ('completed', 'awaiting_final_approval', 'failed', 'cancelled')`;
const FIRST_PASS = sql`r.status in ('completed', 'awaiting_final_approval') and r.iteration_count = 0`;

export async function contextEffectiveness(
  db: Db,
  input: { organizationId: string; projectId?: string | undefined },
): Promise<ContextEffectiveness> {
  const projectFilter = input.projectId
    ? sql`and cg.project_id = ${input.projectId}`
    : sql``;

  const baseline = await db.execute(sql`
    select
      count(*) filter (where ${SETTLED})::int as settled,
      count(*) filter (where ${FIRST_PASS})::int as first_pass
    from pipeline_runs r
    where r.organization_id = ${input.organizationId}
      and r.eval_of_run_id is null
      ${input.projectId ? sql`and r.project_id = ${input.projectId}` : sql``}
  `);
  const baseRow = (baseline.rows as Record<string, unknown>[])[0] ?? {};
  const baselineRuns = Number(baseRow.settled ?? 0);
  const baselineFirstPassRate = baselineRuns > 0 ? Number(baseRow.first_pass ?? 0) / baselineRuns : 0;

  const result = await db.execute(sql`
    select
      cg.source_type,
      cg.source_id,
      min(cg.title) as title,
      min(cg.section) as section,
      count(*) filter (where ${SETTLED})::int as settled,
      count(*) filter (where ${FIRST_PASS})::int as first_pass,
      coalesce(avg(r.iteration_count) filter (where ${SETTLED}), 0) as avg_iterations
    from context_grants cg
    join pipeline_runs r on r.id = cg.run_id
    where cg.organization_id = ${input.organizationId}
      and r.eval_of_run_id is null
      ${projectFilter}
    group by cg.source_type, cg.source_id
    order by count(*) filter (where ${SETTLED}) desc, min(cg.title)
  `);

  const rows = (result.rows as Record<string, unknown>[]).map((row) => {
    const settledRuns = Number(row.settled ?? 0);
    const firstPassRuns = Number(row.first_pass ?? 0);
    return {
      sourceType: String(row.source_type),
      sourceId: String(row.source_id),
      title: String(row.title ?? ''),
      section: String(row.section ?? ''),
      settledRuns,
      firstPassRuns,
      firstPassRate: settledRuns > 0 ? firstPassRuns / settledRuns : 0,
      avgIterations: Number(row.avg_iterations ?? 0),
    };
  });

  return { baselineFirstPassRate, baselineRuns, rows };
}

/** `${sourceType}:${sourceId}` → score adjustment, already clamped. */
export type RetrievalPriors = Map<string, number>;

export function priorKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

/**
 * Turn measured outcomes into a bounded ranking adjustment. Sources with fewer
 * than PRIOR_MIN_SAMPLE settled runs get nothing — an early lucky run must not
 * pin a rule to the top of every future context window.
 */
export async function retrievalPriors(
  db: Db,
  input: { organizationId: string; projectId?: string | undefined },
): Promise<RetrievalPriors> {
  const measured = await contextEffectiveness(db, input);
  const priors: RetrievalPriors = new Map();
  if (measured.baselineRuns < PRIOR_MIN_SAMPLE) return priors;

  for (const row of measured.rows) {
    if (row.settledRuns < PRIOR_MIN_SAMPLE) continue;
    const delta = row.firstPassRate - measured.baselineFirstPassRate;
    const adjustment = Math.max(
      -PRIOR_MAX_ADJUSTMENT,
      Math.min(PRIOR_MAX_ADJUSTMENT, delta * PRIOR_MAX_ADJUSTMENT * 2),
    );
    if (adjustment !== 0) priors.set(priorKey(row.sourceType, row.sourceId), adjustment);
  }
  return priors;
}

/** Apply priors to ranked hits and re-sort. Pure, so the behaviour is testable. */
export function applyPriors<T extends { sourceType: string; sourceId: string; score: number }>(
  hits: T[],
  priors: RetrievalPriors,
): (T & { prior: number })[] {
  return hits
    .map((hit) => {
      const prior = priors.get(priorKey(hit.sourceType, hit.sourceId)) ?? 0;
      return { ...hit, prior, score: hit.score + prior };
    })
    .sort((a, b) => b.score - a.score);
}
