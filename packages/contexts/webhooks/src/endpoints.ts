import { and, desc, eq, sql } from 'drizzle-orm';
import { domainEvents, webhookEndpoints, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import { generateWebhookSecret } from './signing.js';
import { assertSafeWebhookTarget } from './target-guard.js';

export interface CreateEndpointInput {
  organizationId: string;
  url: string;
  description?: string;
  /** Event names to receive; empty means every event. */
  events?: string[];
}

/**
 * The secret is returned exactly once, like an API key. A new endpoint starts
 * at the newest event rather than at the beginning of history: subscribing must
 * not replay every run the organization has ever done.
 */
export async function createEndpoint(
  db: Db,
  input: CreateEndpointInput,
): Promise<{ id: string; secret: string }> {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('webhook URL must be https (localhost may use http for development)');
  }
  // Reject an unreachable-by-policy target now, at the point a human can fix
  // it, instead of failing every delivery later.
  await assertSafeWebhookTarget(input.url);
  const latest = await db
    .select({ id: domainEvents.id })
    .from(domainEvents)
    .orderBy(desc(domainEvents.id))
    .limit(1);

  const id = uuidv7();
  const secret = generateWebhookSecret();
  await db.insert(webhookEndpoints).values({
    id,
    organizationId: input.organizationId,
    url: input.url,
    description: input.description ?? '',
    secret,
    events: input.events ?? [],
    cursorEventId: latest[0]?.id ?? null,
  });
  return { id, secret };
}

/** Secrets are never included — a list endpoint must not leak signing material. */
export async function listEndpoints(db: Db, organizationId: string) {
  const rows = await db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      description: webhookEndpoints.description,
      events: webhookEndpoints.events,
      active: webhookEndpoints.active,
      createdAt: webhookEndpoints.createdAt,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId))
    .orderBy(desc(webhookEndpoints.createdAt));
  return rows.map((row) => ({ ...row, events: (row.events ?? []) as string[] }));
}

export async function setEndpointActive(
  db: Db,
  organizationId: string,
  endpointId: string,
  active: boolean,
): Promise<boolean> {
  const updated = await db
    .update(webhookEndpoints)
    .set({ active })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.organizationId, organizationId),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return updated.length > 0;
}

export async function deleteEndpoint(
  db: Db,
  organizationId: string,
  endpointId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.organizationId, organizationId),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return deleted.length > 0;
}

/** Rotating invalidates the old secret immediately; the new one is shown once. */
export async function rotateEndpointSecret(
  db: Db,
  organizationId: string,
  endpointId: string,
): Promise<{ secret: string } | null> {
  const secret = generateWebhookSecret();
  const updated = await db
    .update(webhookEndpoints)
    .set({ secret })
    .where(
      and(
        eq(webhookEndpoints.id, endpointId),
        eq(webhookEndpoints.organizationId, organizationId),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return updated.length > 0 ? { secret } : null;
}

/** Whether an endpoint's filter accepts an event name. Empty filter = everything. */
export function endpointWants(events: string[], eventName: string): boolean {
  if (events.length === 0) return true;
  return events.some((pattern) =>
    pattern.endsWith('.*') ? eventName.startsWith(pattern.slice(0, -1)) : pattern === eventName,
  );
}

export async function endpointStats(db: Db, organizationId: string) {
  const result = await db.execute(sql`
    select
      e.id,
      count(d.id) filter (where d.status = 'pending')::int as pending,
      count(d.id) filter (where d.status = 'delivered')::int as delivered,
      count(d.id) filter (where d.status = 'failed')::int as failed,
      max(d.delivered_at) as last_delivered_at
    from webhook_endpoints e
    left join webhook_deliveries d on d.endpoint_id = e.id
    where e.organization_id = ${organizationId}
    group by e.id
  `);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    pending: Number(row.pending ?? 0),
    delivered: Number(row.delivered ?? 0),
    failed: Number(row.failed ?? 0),
    lastDeliveredAt: row.last_delivered_at ? new Date(String(row.last_delivered_at)) : null,
  }));
}
