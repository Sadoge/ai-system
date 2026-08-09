import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { knowledgeChunks, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import { chunkText, type Embedder } from './embedding.js';

export type ChunkSourceType = 'knowledge_item' | 'run' | 'finding';

export interface IndexChunkInput {
  organizationId: string;
  projectId?: string | null;
  sourceType: ChunkSourceType;
  sourceId: string;
  title: string;
  content: string;
}

/**
 * (Re)index one source: chunks are replaced wholesale, so re-indexing after an
 * edit can never leave stale text behind.
 */
export async function indexChunks(
  db: Db,
  embedder: Embedder,
  input: IndexChunkInput,
): Promise<{ chunks: number }> {
  await db
    .delete(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.sourceType, input.sourceType),
        eq(knowledgeChunks.sourceId, input.sourceId),
      ),
    );

  const texts = chunkText(`${input.title}\n\n${input.content}`);
  if (texts.length === 0) return { chunks: 0 };
  const vectors = await embedder.embed(texts);

  for (const [i, text] of texts.entries()) {
    await db.insert(knowledgeChunks).values({
      id: uuidv7(),
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      content: text,
      embedding: vectors[i] ?? null,
    });
  }
  return { chunks: texts.length };
}

export interface SemanticHit {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
}

/**
 * Nearest-neighbour search by cosine distance, optionally restricted to
 * certain source types. Returns provenance with every hit so an agent's
 * context can always be traced back (docs/08 §2).
 */
export async function semanticSearch(
  db: Db,
  embedder: Embedder,
  input: {
    projectId: string;
    query: string;
    topK: number;
    sourceTypes?: ChunkSourceType[];
  },
): Promise<SemanticHit[]> {
  const [vector] = await embedder.embed([input.query]);
  if (!vector) return [];
  const literal = `[${vector.join(',')}]`;
  const types = input.sourceTypes ?? ['knowledge_item', 'run', 'finding'];

  const rows = await db
    .select({
      sourceType: knowledgeChunks.sourceType,
      sourceId: knowledgeChunks.sourceId,
      title: knowledgeChunks.title,
      content: knowledgeChunks.content,
      distance: sql<number>`${knowledgeChunks.embedding} <=> ${literal}::vector`,
    })
    .from(knowledgeChunks)
    .where(
      and(
        // Project-scoped chunks plus org-wide ones (promoted knowledge).
        or(eq(knowledgeChunks.projectId, input.projectId), isNull(knowledgeChunks.projectId)),
        sql`${knowledgeChunks.sourceType} = ANY(${sql.raw(`ARRAY[${types.map((t) => `'${t}'`).join(',')}]`)})`,
        sql`${knowledgeChunks.embedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${knowledgeChunks.embedding} <=> ${literal}::vector`)
    .limit(input.topK);

  return rows.map((r) => ({
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    title: r.title,
    content: r.content,
    score: 1 - Number(r.distance),
  }));
}
