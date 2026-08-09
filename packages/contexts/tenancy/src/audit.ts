import { and, desc, eq, gte } from 'drizzle-orm';
import { auditRecords, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import type { Principal } from './principal.js';

/**
 * Append-only record of who changed what. Written for every mutation that a
 * human could later need to explain — approvals above all (docs/03).
 */
export async function recordAudit(
  db: Db,
  input: {
    principal: Principal;
    action: string;
    subjectType: string;
    subjectId?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditRecords).values({
    id: uuidv7(),
    organizationId: input.principal.organizationId,
    actorType: input.principal.kind,
    actorId: input.principal.userId ?? input.principal.apiKeyId ?? null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    data: { actor: input.principal.label, ...(input.data ?? {}) },
  });
}

export async function listAudit(
  db: Db,
  input: { organizationId: string; since?: Date; limit?: number },
) {
  return db
    .select()
    .from(auditRecords)
    .where(
      input.since
        ? and(
            eq(auditRecords.organizationId, input.organizationId),
            gte(auditRecords.createdAt, input.since),
          )
        : eq(auditRecords.organizationId, input.organizationId),
    )
    .orderBy(desc(auditRecords.createdAt))
    .limit(input.limit ?? 500);
}

/** CSV export — the format an auditor or finance team actually asks for. */
export function auditToCsv(rows: Awaited<ReturnType<typeof listAudit>>): string {
  const header = 'created_at,actor_type,actor_id,action,subject_type,subject_id,data';
  const escape = (value: unknown): string => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    header,
    ...rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.actorType,
        r.actorId ?? '',
        r.action,
        r.subjectType,
        r.subjectId ?? '',
        escape(r.data),
      ].join(','),
    ),
  ].join('\n');
}
