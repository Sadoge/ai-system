import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import { endpointWants } from './endpoints.js';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
} from './signing.js';
import { assertSafeWebhookTarget } from './target-guard.js';

/** Attempt schedule in seconds; length is the attempt limit. */
export const RETRY_BACKOFF_SECONDS = [5, 30, 120, 600, 3600];
export const MAX_ATTEMPTS = RETRY_BACKOFF_SECONDS.length;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Fan out newly recorded domain events to subscribed endpoints.
 *
 * Endpoints tail `domain_events` through their own cursor instead of having
 * rows pushed to them at event time. That keeps the orchestration engine free
 * of any knowledge of webhooks — the engine's transaction stays exactly as
 * small as it was — and it means a subscriber added today cannot be starved by
 * one that is failing.
 *
 * Only run-scoped events are deliverable: an event with no run cannot be
 * attributed to a tenant, and delivering unattributed events across an
 * organization boundary is worse than delivering nothing.
 */
export async function fanoutEvents(
  db: Db,
  options: { batchSize?: number } = {},
): Promise<{ created: number; scanned: number }> {
  const batchSize = options.batchSize ?? 200;
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.active, true));

  let created = 0;
  let scanned = 0;

  for (const endpoint of endpoints) {
    const cursor = endpoint.cursorEventId;
    const result = await db.execute(sql`
      select e.id, e.name, e.payload, e.run_id, e.created_at, r.project_id, r.eval_of_run_id
      from domain_events e
      join pipeline_runs r on r.id = e.run_id
      where r.organization_id = ${endpoint.organizationId}
        ${cursor ? sql`and e.id > ${cursor}` : sql``}
      order by e.id asc
      limit ${batchSize}
    `);
    const rows = result.rows as Record<string, unknown>[];
    if (rows.length === 0) continue;
    scanned += rows.length;

    const wanted = rows.filter((row) => endpointWants(endpoint.events as string[], String(row.name)));
    if (wanted.length > 0) {
      await db.insert(webhookDeliveries).values(
        wanted.map((row) => ({
          id: uuidv7(),
          organizationId: endpoint.organizationId,
          endpointId: endpoint.id,
          eventName: String(row.name),
          payload: {
            id: String(row.id),
            event: String(row.name),
            occurredAt: new Date(String(row.created_at)).toISOString(),
            runId: row.run_id ? String(row.run_id) : null,
            projectId: row.project_id ? String(row.project_id) : null,
            // Replays are delivered too, flagged so a subscriber can ignore
            // them the way analytics does.
            isEvalRun: row.eval_of_run_id !== null,
            data: row.payload,
          },
        })),
      );
      created += wanted.length;
    }

    // The cursor advances past everything scanned, including events this
    // endpoint filtered out — they are consumed, not pending.
    await db
      .update(webhookEndpoints)
      .set({ cursorEventId: String(rows[rows.length - 1]!.id) })
      .where(eq(webhookEndpoints.id, endpoint.id));
  }

  return { created, scanned };
}

export interface DeliveryResult {
  attempted: number;
  delivered: number;
  failed: number;
  retrying: number;
}

/**
 * Deliver due rows. At-least-once: a crash between the POST and the status
 * update re-sends, which is why every payload carries a stable event id for
 * receiver-side deduplication.
 */
export async function deliverPending(
  db: Db,
  options: { batchSize?: number; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<DeliveryResult> {
  const batchSize = options.batchSize ?? 20;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const result: DeliveryResult = { attempted: 0, delivered: 0, failed: 0, retrying: 0 };

  const due = await db
    .select({
      delivery: webhookDeliveries,
      url: webhookEndpoints.url,
      secret: webhookEndpoints.secret,
      active: webhookEndpoints.active,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(batchSize);

  for (const row of due) {
    const delivery = row.delivery;
    result.attempted++;

    if (!row.active) {
      // Deactivated mid-flight: stop rather than keep hammering.
      await db
        .update(webhookDeliveries)
        .set({ status: 'failed', lastError: 'endpoint deactivated' })
        .where(eq(webhookDeliveries.id, delivery.id));
      result.failed++;
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(now.getTime() / 1000));
    let responseStatus: number | null = null;
    let error: string | null = null;

    try {
      await assertSafeWebhookTarget(row.url);
      const response = await doFetch(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [EVENT_HEADER]: delivery.eventName,
          [DELIVERY_HEADER]: delivery.id,
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signPayload(row.secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      responseStatus = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const attempts = delivery.attempts + 1;
    if (!error) {
      await db
        .update(webhookDeliveries)
        .set({
          status: 'delivered',
          attempts,
          responseStatus,
          deliveredAt: new Date(),
          lastError: null,
          nextAttemptAt: null,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      result.delivered++;
      continue;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    const backoff = RETRY_BACKOFF_SECONDS[Math.min(attempts, MAX_ATTEMPTS) - 1]!;
    await db
      .update(webhookDeliveries)
      .set({
        status: exhausted ? 'failed' : 'pending',
        attempts,
        responseStatus,
        lastError: error.slice(0, 500),
        nextAttemptAt: exhausted ? null : new Date(now.getTime() + backoff * 1000),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    if (exhausted) result.failed++;
    else result.retrying++;
  }

  return result;
}

export async function listDeliveries(
  db: Db,
  organizationId: string,
  options: { endpointId?: string; limit?: number } = {},
) {
  return db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organizationId, organizationId),
        ...(options.endpointId ? [eq(webhookDeliveries.endpointId, options.endpointId)] : []),
      ),
    )
    .orderBy(sql`${webhookDeliveries.createdAt} desc`)
    .limit(options.limit ?? 50);
}

/** Put a failed delivery back in the queue — the manual half of at-least-once. */
export async function redeliver(
  db: Db,
  organizationId: string,
  deliveryId: string,
): Promise<boolean> {
  const updated = await db
    .update(webhookDeliveries)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null })
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.organizationId, organizationId),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  return updated.length > 0;
}
