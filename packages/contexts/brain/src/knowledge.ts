import { knowledgeItems, type Db } from '@ai-system/db';
import { KnowledgeKind, uuidv7 } from '@ai-system/domain';

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
  return { knowledgeItemId };
}
