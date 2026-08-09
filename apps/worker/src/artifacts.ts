import { createHash } from 'node:crypto';
import { artifacts, type Db } from '@ai-system/db';
import { uuidv7, type ArtifactKind } from '@ai-system/domain';

export async function createArtifact(
  db: Db,
  input: {
    runId: string;
    kind: ArtifactKind;
    content: unknown;
    createdByAgentRunId?: string;
  },
): Promise<{ artifactId: string }> {
  const artifactId = uuidv7();
  const serialized = JSON.stringify(input.content);
  await db.insert(artifacts).values({
    id: artifactId,
    runId: input.runId,
    kind: input.kind,
    content: input.content,
    contentHash: createHash('sha256').update(serialized).digest('hex'),
    createdByAgentRunId: input.createdByAgentRunId ?? null,
  });
  return { artifactId };
}
