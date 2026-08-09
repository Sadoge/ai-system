import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Db } from './client.js';

/** Apply committed migrations (packages/db/migrations). Used by worker startup and `ai-system db migrate`. */
export async function migrateDb(db: Db, migrationsFolder?: string): Promise<void> {
  await migrate(db, {
    migrationsFolder: migrationsFolder ?? fileURLToPath(new URL('../migrations', import.meta.url)),
  });
}
