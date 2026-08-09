import PgBoss from 'pg-boss';
import { pino } from 'pino';
import { z } from 'zod';
import { createDb, createPool, migrateDb } from '@ai-system/db';
import { GateKind } from '@ai-system/domain';
import { createGateRequest } from '@ai-system/orchestration';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { executeStage } from './stages.js';

const log = pino({ name: 'worker', level: process.env.LOG_LEVEL ?? 'info' });

const ExecuteStagePayload = z.object({
  kind: z.literal('execute_stage'),
  runId: z.string().uuid(),
  stage: z.string(),
});

const RequestGatePayload = z.object({
  kind: z.literal('request_gate'),
  runId: z.string().uuid(),
  gate: GateKind,
});

const QUEUES = ['stage.execute', 'gate.request'] as const;

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://ai:ai@localhost:5432/ai_system';
  const pool = createPool(connectionString);
  const db = createDb(pool);

  if (process.env.MIGRATE_ON_START !== 'false') {
    await migrateDb(db);
    log.info('migrations applied');
  }

  const boss = new PgBoss({ connectionString });
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);

  await boss.work('stage.execute', async (jobs) => {
    for (const job of jobs) {
      const payload = ExecuteStagePayload.parse(job.data);
      log.info({ runId: payload.runId, stage: payload.stage }, 'executing stage');
      await executeStage(db, payload);
    }
  });

  await boss.work('gate.request', async (jobs) => {
    for (const job of jobs) {
      const payload = RequestGatePayload.parse(job.data);
      log.info({ runId: payload.runId, gate: payload.gate }, 'creating gate request');
      await createGateRequest(db, payload);
    }
  });

  const dispatcher = new OutboxDispatcher(db, boss, log);
  dispatcher.start();
  log.info('worker started');

  const shutdown = async () => {
    log.info('shutting down');
    await dispatcher.stop();
    await boss.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'worker failed to start');
  process.exit(1);
});
