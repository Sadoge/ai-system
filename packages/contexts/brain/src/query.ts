import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { knowledgeItems, type Db } from '@ai-system/db';
import { semanticSearch } from './chunks.js';
import { applyPriors, type RetrievalPriors } from './retrieval.js';
import type { Embedder } from './embedding.js';
import type { BrainContext, BrainHit, BrainNeed, BrainRule, RepoIndex } from './types.js';

const MAX_FILE_MAP_ENTRIES = 400;
const MAX_RELEVANT_FILES = 30;
const DEFAULT_TOKEN_BUDGET = 12_000;

/** Cheap, stable estimate — good enough to decide what to drop. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The one retrieval facade (docs/08 §2). Order matters and is fixed:
 *   1. structural lookup (deterministic)
 *   2. approved rules — ALWAYS included, never rank-filtered or trimmed
 *   3. semantic + episodic hits (ranked, trimmed first under budget pressure)
 * Correctness constraints must not depend on embedding luck.
 */
export async function brainQuery(
  db: Db,
  input: {
    projectId: string;
    repositoryId?: string;
    index: RepoIndex | null;
    need: BrainNeed;
    /** Optional: without it, semantic and episodic needs are skipped. */
    embedder?: Embedder;
    /**
     * Outcome-derived ranking nudge (docs/08 §4). Applied AFTER nearest-neighbour
     * search, so it reorders what similarity already retrieved and can never
     * introduce material similarity rejected. Never applied to rules.
     */
    priors?: RetrievalPriors;
    maxTokens?: number;
  },
): Promise<BrainContext> {
  const rules = await approvedRules(db, input.projectId, input.repositoryId);
  const trimmed: BrainContext['trimmed'] = [];

  // ── 1. structural ──────────────────────────────────────────────────
  let fileMap = '(no repository index)';
  let relevantFiles: BrainContext['relevantFiles'] = [];
  if (input.index) {
    const sourceFiles = input.index.files.filter((f) => f.role !== 'generated');
    fileMap = sourceFiles
      .slice(0, MAX_FILE_MAP_ENTRIES)
      .map((f) => `${f.path} [${f.role}]`)
      .join('\n');

    const keywords = (input.need.structural?.keywords ?? []).map((k) => k.toLowerCase());
    const explicit = new Set(input.need.structural?.files ?? []);
    relevantFiles = sourceFiles
      .filter((f) => f.role === 'source' || f.role === 'test')
      .map((f) => {
        let score = explicit.has(f.path) ? 100 : 0;
        const lower = f.path.toLowerCase();
        for (const k of keywords) if (lower.includes(k)) score += 10;
        const exports = input.index!.symbols[f.path] ?? [];
        for (const k of keywords) {
          if (exports.some((s) => s.toLowerCase().includes(k))) score += 5;
        }
        return { path: f.path, exports, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, MAX_RELEVANT_FILES)
      .map(({ path, exports }) => ({ path, exports }));
  }

  // ── 3. ranked retrieval ────────────────────────────────────────────
  let related: BrainHit[] = [];
  let episodes: BrainHit[] = [];
  if (input.embedder) {
    if (input.need.semantic) {
      related = await semanticSearch(db, input.embedder, {
        projectId: input.projectId,
        query: input.need.semantic.query,
        topK: input.need.semantic.topK ?? 5,
        sourceTypes: ['knowledge_item'],
      });
    }
    if (input.need.episodic) {
      episodes = await semanticSearch(db, input.embedder, {
        projectId: input.projectId,
        query: input.need.episodic.query,
        topK: input.need.episodic.topK ?? 3,
        sourceTypes: ['run', 'finding'],
      });
    }
  }

  // Outcome priors reorder the ranked sections only — rules are untouched, and
  // so is the structural layer. Under budget pressure this decides what
  // survives, which is the entire point of measuring effectiveness.
  if (input.priors && input.priors.size > 0) {
    related = applyPriors(related, input.priors);
    episodes = applyPriors(episodes, input.priors);
  }

  // ── budget: trim ranked material first, never rules ─────────────────
  const budget = input.maxTokens ?? DEFAULT_TOKEN_BUDGET;
  const rulesTokens = rules.reduce((n, r) => n + estimateTokens(r.title + r.content), 0);
  let used = rulesTokens + estimateTokens(fileMap);

  const fitHits = (hits: BrainHit[], section: string): BrainHit[] => {
    const kept: BrainHit[] = [];
    let dropped = 0;
    for (const hit of hits) {
      const cost = estimateTokens(hit.title + hit.content);
      if (used + cost > budget) {
        dropped++;
        continue;
      }
      used += cost;
      kept.push(hit);
    }
    if (dropped > 0) trimmed.push({ section, dropped });
    return kept;
  };
  episodes = fitHits(episodes, 'episodes');
  related = fitHits(related, 'related');

  if (used > budget && relevantFiles.length > 0) {
    const before = relevantFiles.length;
    relevantFiles = relevantFiles.slice(0, Math.max(1, Math.floor(before / 2)));
    trimmed.push({ section: 'relevantFiles', dropped: before - relevantFiles.length });
  }

  return { fileMap, relevantFiles, rules, related, episodes, trimmed };
}

async function approvedRules(
  db: Db,
  projectId: string,
  repositoryId?: string,
): Promise<BrainRule[]> {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.status, 'approved'),
        or(
          eq(knowledgeItems.projectId, projectId),
          isNull(knowledgeItems.projectId),
          ...(repositoryId ? [eq(knowledgeItems.repositoryId, repositoryId)] : []),
        ),
        inArray(knowledgeItems.kind, [
          'architecture_rule',
          'convention',
          'pitfall',
          'pattern',
          'adr',
          'business_rule',
        ]),
      ),
    )
    .orderBy(knowledgeItems.createdAt);
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, content: r.content }));
}
