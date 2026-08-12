import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { modelCalls, pipelineRuns, type Db } from '@ai-system/db';
import { getQuotas } from './principal.js';

export class QuotaExceededError extends Error {
  constructor(
    public readonly quota: string,
    message: string,
  ) {
    super(message);
  }
}

const ACTIVE_RUN_STATUSES = [
  'created',
  'classifying',
  'researching',
  'planning',
  'decomposing',
  'executing',
  'integrating',
  'reviewing',
  'testing',
  'documenting',
  'packaging',
];

/**
 * Concurrency and spend are enforced at run start, where refusing is cheap and
 * comprehensible. Mid-run budget exhaustion is handled separately by the
 * gateway's budget guard, which pauses the run for a human instead.
 */
export async function assertRunAllowed(db: Db, organizationId: string): Promise<void> {
  const quotas = await getQuotas(db, organizationId);

  if (quotas.maxConcurrentRuns !== undefined) {
    const rows = await db
      .select({ count: sql<string>`count(*)` })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.organizationId, organizationId),
          inArray(pipelineRuns.status, ACTIVE_RUN_STATUSES),
        ),
      );
    const active = Number(rows[0]?.count ?? 0);
    if (active >= quotas.maxConcurrentRuns) {
      throw new QuotaExceededError(
        'maxConcurrentRuns',
        `organization already has ${active} active runs (limit ${quotas.maxConcurrentRuns})`,
      );
    }
  }

  if (quotas.monthlyBudgetUsd !== undefined) {
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    // Metered calls only. A subscription-backed CLI spends plan quota, not
    // money, and the USD it self-reports is an API-equivalent estimate — a
    // dollar budget must not refuse a run over a charge nobody will receive.
    // On a subscription-only deployment this budget therefore never binds and
    // maxConcurrentRuns is the effective limit.
    const rows = await db
      .select({ total: sql<string>`coalesce(sum(${modelCalls.costUsd}), 0)` })
      .from(modelCalls)
      .innerJoin(pipelineRuns, eq(modelCalls.runId, pipelineRuns.id))
      .where(
        and(
          eq(pipelineRuns.organizationId, organizationId),
          gte(modelCalls.createdAt, since),
          eq(modelCalls.billing, 'metered'),
        ),
      );
    const spent = Number(rows[0]?.total ?? 0);
    if (spent >= quotas.monthlyBudgetUsd) {
      throw new QuotaExceededError(
        'monthlyBudgetUsd',
        `organization has spent $${spent.toFixed(2)} this month (limit $${quotas.monthlyBudgetUsd})`,
      );
    }
  }
}

/**
 * In-process token bucket. Enough for a single API node; a shared limiter
 * (Redis or Postgres) is the obvious upgrade when the control plane scales
 * horizontally, and the interface here does not change when it does.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(private readonly defaultPerMinute: number) {}

  /** Returns true when the request is allowed. */
  take(key: string, perMinute = this.defaultPerMinute): boolean {
    if (perMinute <= 0) return true;
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
    const refill = ((now - bucket.updatedAt) / 60_000) * perMinute;
    const tokens = Math.min(perMinute, bucket.tokens + refill);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }
}
