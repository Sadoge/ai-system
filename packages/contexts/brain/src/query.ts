import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { knowledgeItems, type Db } from '@ai-system/db';
import type { BrainContext, BrainNeed, BrainRule, RepoIndex } from './types.js';

const MAX_FILE_MAP_ENTRIES = 400;
const MAX_RELEVANT_FILES = 30;

/**
 * The one retrieval facade (docs/08 §2): structural first (deterministic),
 * approved rules ALWAYS included — never rank-filtered. Semantic retrieval
 * lands in Phase 2 behind this same signature.
 */
export async function brainQuery(
  db: Db,
  input: {
    projectId: string;
    repositoryId?: string;
    index: RepoIndex | null;
    need: BrainNeed;
  },
): Promise<BrainContext> {
  const rules = await approvedRules(db, input.projectId, input.repositoryId);

  if (!input.index) return { fileMap: '(no repository index)', relevantFiles: [], rules };

  const sourceFiles = input.index.files.filter((f) => f.role !== 'generated');
  const fileMap = sourceFiles
    .slice(0, MAX_FILE_MAP_ENTRIES)
    .map((f) => `${f.path} [${f.role}]`)
    .join('\n');

  const keywords = (input.need.structural?.keywords ?? []).map((k) => k.toLowerCase());
  const explicit = new Set(input.need.structural?.files ?? []);
  const scored = sourceFiles
    .filter((f) => f.role === 'source' || f.role === 'test')
    .map((f) => {
      let score = explicit.has(f.path) ? 100 : 0;
      const lower = f.path.toLowerCase();
      for (const k of keywords) if (lower.includes(k)) score += 10;
      const exports = input.index!.symbols[f.path] ?? [];
      for (const k of keywords) {
        if (exports.some((s) => s.toLowerCase().includes(k))) score += 5;
      }
      return { f, score, exports };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))
    .slice(0, MAX_RELEVANT_FILES);

  return {
    fileMap,
    relevantFiles: scored.map((s) => ({ path: s.f.path, exports: s.exports })),
    rules,
  };
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
