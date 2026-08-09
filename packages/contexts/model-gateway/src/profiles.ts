import { and, eq, isNull } from 'drizzle-orm';
import { modelProfiles, type Db } from '@ai-system/db';
import type { ModelTarget, ResolvedProfile } from './types.js';

// Platform defaults when no DB profile matches. Purposes mirror docs/07 §4.
export const PLATFORM_DEFAULT_PROFILES: Record<string, ResolvedProfile> = {
  classifier: {
    purpose: 'classifier',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5', params: { maxTokens: 1024, temperature: 0 } },
    fallbacks: [],
  },
  planning: {
    purpose: 'planning',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5', params: { maxTokens: 8192 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  research: {
    purpose: 'research',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5', params: { maxTokens: 4096 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  review: {
    purpose: 'review',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5', params: { maxTokens: 8192, temperature: 0 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  echo: {
    purpose: 'echo',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5', params: { maxTokens: 256, temperature: 0 } },
    fallbacks: [],
  },
};

/**
 * Resolution cascade (docs/07 §4): project profile > org profile > platform
 * default. The result is resolved ONCE per run and carried in the policy
 * snapshot's context, not re-resolved mid-run.
 */
export async function resolveProfile(
  db: Db,
  input: { purpose: string; projectId?: string; organizationId?: string },
): Promise<ResolvedProfile> {
  const candidates = [
    input.projectId
      ? and(
          eq(modelProfiles.purpose, input.purpose),
          eq(modelProfiles.projectId, input.projectId),
          eq(modelProfiles.active, true),
        )
      : null,
    input.organizationId
      ? and(
          eq(modelProfiles.purpose, input.purpose),
          eq(modelProfiles.organizationId, input.organizationId),
          isNull(modelProfiles.projectId),
          eq(modelProfiles.active, true),
        )
      : null,
  ].filter((c) => c !== null);

  for (const where of candidates) {
    const rows = await db.select().from(modelProfiles).where(where).limit(1);
    const row = rows[0];
    if (row) {
      const params = row.params as NonNullable<ModelTarget['params']> | null;
      return {
        purpose: row.purpose,
        primary: {
          provider: row.provider,
          model: row.model,
          ...(params ? { params } : {}),
        },
        fallbacks: (row.fallbacks as ModelTarget[]) ?? [],
      };
    }
  }

  const fallback = PLATFORM_DEFAULT_PROFILES[input.purpose];
  if (!fallback) throw new Error(`No model profile for purpose "${input.purpose}"`);
  return fallback;
}
