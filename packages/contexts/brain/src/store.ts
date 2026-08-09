import { desc, eq } from 'drizzle-orm';
import { repoIndexSnapshots, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import { RepoIndex } from './types.js';

export async function saveIndexSnapshot(
  db: Db,
  repositoryId: string,
  index: RepoIndex,
): Promise<void> {
  await db.insert(repoIndexSnapshots).values({
    id: uuidv7(),
    repositoryId,
    commitSha: index.commitSha,
    index,
  });
}

export async function latestIndexSnapshot(
  db: Db,
  repositoryId: string,
): Promise<RepoIndex | null> {
  const rows = await db
    .select()
    .from(repoIndexSnapshots)
    .where(eq(repoIndexSnapshots.repositoryId, repositoryId))
    .orderBy(desc(repoIndexSnapshots.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? RepoIndex.parse(row.index) : null;
}
