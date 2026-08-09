import { createHash } from 'node:crypto';
import { artifacts, type Db } from '@ai-system/db';
import { uuidv7, type ArtifactKind } from '@ai-system/domain';
import { storageFromEnv, type ArtifactStorage } from './storage.js';

const storage: ArtifactStorage = storageFromEnv();

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
  const contentHash = createHash('sha256').update(serialized).digest('hex');

  // Large payloads go to object storage; the row then holds a pointer only,
  // which is what keeps Postgres small as run history accumulates.
  const storageRef = await storage.put(`artifacts/${input.runId}/${artifactId}.json`, serialized);

  await db.insert(artifacts).values({
    id: artifactId,
    runId: input.runId,
    kind: input.kind,
    content: storageRef ? null : input.content,
    storageRef,
    contentHash,
    createdByAgentRunId: input.createdByAgentRunId ?? null,
  });
  return { artifactId };
}
