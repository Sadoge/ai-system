import { desc, eq } from 'drizzle-orm';
import { knowledgeItems, type Db } from '@ai-system/db';
import { KnowledgeKind, uuidv7, type KnowledgeStatus } from '@ai-system/domain';
import { indexChunks } from './chunks.js';
import type { Embedder } from './embedding.js';

/** Manual (static) knowledge is approved on authoring — the author is the human (docs/08 §4). */
export async function addManualKnowledge(
  db: Db,
  input: {
    organizationId: string;
    projectId?: string;
    repositoryId?: string;
    kind: KnowledgeKind;
    title: string;
    content: string;
    scopeTags?: string[];
  },
  embedder?: Embedder,
): Promise<{ knowledgeItemId: string }> {
  const knowledgeItemId = uuidv7();
  await db.insert(knowledgeItems).values({
    id: knowledgeItemId,
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    repositoryId: input.repositoryId ?? null,
    kind: input.kind,
    title: input.title,
    content: input.content,
    origin: 'manual',
    status: 'approved',
    scopeTags: input.scopeTags ?? [],
  });
  if (embedder) {
    await indexChunks(db, embedder, {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      sourceType: 'knowledge_item',
      sourceId: knowledgeItemId,
      title: input.title,
      content: input.content,
    });
  }
  return { knowledgeItemId };
}

/**
 * Learned knowledge enters as `proposed` and is invisible to retrieval until a
 * human approves it (docs/08 §3) — proposals are never embedded, so they
 * cannot leak into an agent's context by accident.
 */
export async function proposeKnowledge(
  db: Db,
  input: {
    organizationId: string;
    projectId?: string;
    kind: KnowledgeKind;
    title: string;
    content: string;
    sourceRunId: string;
    evidence: string[];
  },
): Promise<{ knowledgeItemId: string }> {
  const knowledgeItemId = uuidv7();
  await db.insert(knowledgeItems).values({
    id: knowledgeItemId,
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    title: input.title,
    content: input.content,
    origin: 'learned',
    status: 'proposed',
    scopeTags: input.evidence,
    sourceRunId: input.sourceRunId,
  });
  return { knowledgeItemId };
}

export async function listKnowledge(db: Db, status?: KnowledgeStatus) {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(status ? eq(knowledgeItems.status, status) : undefined)
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(200);
  return rows;
}

/**
 * The human decision on a proposal. Approving embeds it (making it
 * retrievable); rejecting keeps the row so the distiller stops re-proposing it
 * — rejected knowledge is a negative example, not a deletion.
 */
export async function decideKnowledge(
  db: Db,
  input: {
    knowledgeItemId: string;
    decision: 'approved' | 'rejected';
    /** A human edit wins: the edited text becomes canonical. */
    editedContent?: string | undefined;
    editedTitle?: string | undefined;
  },
  embedder?: Embedder,
): Promise<{ status: KnowledgeStatus }> {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, input.knowledgeItemId));
  const item = rows[0];
  if (!item) throw new Error(`unknown knowledge item ${input.knowledgeItemId}`);
  if (item.status !== 'proposed') throw new Error(`knowledge item is ${item.status}, not proposed`);

  const title = input.editedTitle ?? item.title;
  const content = input.editedContent ?? item.content;
  const status: KnowledgeStatus = input.decision === 'approved' ? 'approved' : 'rejected';

  await db
    .update(knowledgeItems)
    .set({ status, title, content, updatedAt: new Date() })
    .where(eq(knowledgeItems.id, item.id));

  if (status === 'approved' && embedder) {
    await indexChunks(db, embedder, {
      organizationId: item.organizationId,
      projectId: item.projectId,
      sourceType: 'knowledge_item',
      sourceId: item.id,
      title,
      content,
    });
  }
  return { status };
}

/**
 * Promote a project rule to organization scope (docs/10 Phase 4:
 * cross-project knowledge). The rule then applies to every project in the
 * org, and its chunks are re-indexed org-wide so semantic retrieval finds it
 * from any project.
 */
export async function promoteKnowledge(
  db: Db,
  input: { knowledgeItemId: string; organizationId: string },
  embedder?: Embedder,
): Promise<void> {
  const rows = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, input.knowledgeItemId));
  const item = rows[0];
  if (!item || item.organizationId !== input.organizationId) {
    throw new Error(`unknown knowledge item ${input.knowledgeItemId}`);
  }
  if (item.status !== 'approved') throw new Error('only approved knowledge can be promoted');

  await db
    .update(knowledgeItems)
    .set({ projectId: null, repositoryId: null, updatedAt: new Date() })
    .where(eq(knowledgeItems.id, item.id));

  if (embedder) {
    await indexChunks(db, embedder, {
      organizationId: item.organizationId,
      projectId: null,
      sourceType: 'knowledge_item',
      sourceId: item.id,
      title: item.title,
      content: item.content,
    });
  }
}
