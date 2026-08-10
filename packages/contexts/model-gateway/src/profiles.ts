import { and, desc, eq, isNull } from 'drizzle-orm';
import { modelProfiles, type Db } from '@ai-system/db';
import type { ModelTarget, ResolvedProfile } from './types.js';

// Platform defaults when no DB profile matches. Purposes mirror docs/07 §4.
export const PLATFORM_DEFAULT_PROFILES: Record<string, ResolvedProfile> = {
  classifier: {
    purpose: 'classifier',
    primary: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      params: { maxTokens: 1024, temperature: 0 },
    },
    fallbacks: [],
  },
  planning: {
    purpose: 'planning',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5', params: { maxTokens: 8192 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  decomposition: {
    purpose: 'decomposition',
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
    primary: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      params: { maxTokens: 8192, temperature: 0 },
    },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  testing: {
    purpose: 'testing',
    primary: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      params: { maxTokens: 4096, temperature: 0 },
    },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  documentation: {
    purpose: 'documentation',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5', params: { maxTokens: 4096 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  distillation: {
    purpose: 'distillation',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5', params: { maxTokens: 4096 } },
    fallbacks: [{ provider: 'openai', model: 'gpt-4o' }],
  },
  embeddings: {
    purpose: 'embeddings',
    primary: { provider: 'openai', model: 'text-embedding-3-small' },
    fallbacks: [{ provider: 'local', model: 'local-hash' }],
  },
  echo: {
    purpose: 'echo',
    primary: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      params: { maxTokens: 256, temperature: 0 },
    },
    fallbacks: [],
  },
};

/**
 * Resolution cascade (docs/07 §4): project profile > org profile > platform
 * default. The worker resolves each purpose once and caches it for the run,
 * so a settings change cannot switch an in-flight agent midway through work.
 */
export async function resolveProfile(
  db: Db,
  input: { purpose: string; projectId?: string; organizationId?: string },
  platformDefaults: Record<string, ResolvedProfile> = PLATFORM_DEFAULT_PROFILES,
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
    const rows = await db
      .select()
      .from(modelProfiles)
      .where(where)
      .orderBy(desc(modelProfiles.createdAt))
      .limit(1);
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

  const fallback = platformDefaults[input.purpose];
  if (!fallback) throw new Error(`No model profile for purpose "${input.purpose}"`);
  return fallback;
}
