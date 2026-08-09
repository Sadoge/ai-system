import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString?: string): pg.Pool {
  return new pg.Pool({
    connectionString:
      connectionString ?? process.env.DATABASE_URL ?? 'postgres://ai:ai@localhost:5432/ai_system',
  });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}
