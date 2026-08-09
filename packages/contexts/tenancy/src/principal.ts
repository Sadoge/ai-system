import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, memberships, organizations, users, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import { isRole, type Role } from './roles.js';

/** Who is making a request. Every tenant-scoped query is filtered by its organizationId. */
export interface Principal {
  kind: 'api_key' | 'user';
  organizationId: string;
  userId: string | null;
  role: Role;
  apiKeyId?: string;
  label: string;
}

const KEY_PREFIX = 'ais_';
const PREFIX_VISIBLE_CHARS = 8;

/** sha256 of the plaintext key. Keys are high-entropy random, so no KDF stretching is needed. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export async function createApiKey(
  db: Db,
  input: { organizationId: string; name: string; role: Role; userId?: string },
): Promise<{ apiKeyId: string; plaintext: string; keyPrefix: string }> {
  // 32 random bytes: guessing is not a threat model we need to model further.
  const plaintext = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const apiKeyId = uuidv7();
  const keyPrefix = plaintext.slice(0, KEY_PREFIX.length + PREFIX_VISIBLE_CHARS);
  await db.insert(apiKeys).values({
    id: apiKeyId,
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    name: input.name,
    keyPrefix,
    keyHash: hashApiKey(plaintext),
    role: input.role,
  });
  // The plaintext is returned exactly once and never stored.
  return { apiKeyId, plaintext, keyPrefix };
}

export async function revokeApiKey(db: Db, apiKeyId: string, organizationId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.organizationId, organizationId)));
}

export async function listApiKeys(db: Db, organizationId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      role: apiKeys.role,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, organizationId));
}

/** Resolve a bearer token to a principal, or null when it is unknown or revoked. */
export async function resolveApiKey(db: Db, plaintext: string): Promise<Principal | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const hash = hashApiKey(plaintext);
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
  const key = rows[0];
  if (!key) return null;

  // Constant-time confirmation: the lookup already matched on the hash, but
  // comparing again this way keeps the code honest if the lookup ever changes.
  const a = Buffer.from(key.keyHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
  return {
    kind: 'api_key',
    organizationId: key.organizationId,
    userId: key.userId,
    role: isRole(key.role) ? key.role : 'member',
    apiKeyId: key.id,
    label: `${key.name} (${key.keyPrefix}…)`,
  };
}

/** Resolve a user's membership in an organization. */
export async function resolveUser(
  db: Db,
  input: { userId: string; organizationId: string },
): Promise<Principal | null> {
  const rows = await db
    .select({ role: memberships.role, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.organizationId, input.organizationId),
      ),
    );
  const row = rows[0];
  if (!row) return null;
  return {
    kind: 'user',
    organizationId: input.organizationId,
    userId: input.userId,
    role: isRole(row.role) ? row.role : 'member',
    label: row.email,
  };
}

export interface OrgQuotas {
  maxConcurrentRuns?: number | undefined;
  monthlyBudgetUsd?: number | undefined;
  requestsPerMinute?: number | undefined;
}

export async function getQuotas(db: Db, organizationId: string): Promise<OrgQuotas> {
  const rows = await db
    .select({ quotas: organizations.quotas })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return (rows[0]?.quotas ?? {}) as OrgQuotas;
}

export async function setQuotas(db: Db, organizationId: string, quotas: OrgQuotas): Promise<void> {
  await db.update(organizations).set({ quotas }).where(eq(organizations.id, organizationId));
}
