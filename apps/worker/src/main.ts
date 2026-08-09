import { join } from 'node:path';
import PgBoss from 'pg-boss';
import { pino } from 'pino';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { artifacts, createDb, createPool, migrateDb, type Db } from '@ai-system/db';
import { GateKind } from '@ai-system/domain';
import { createGateRequest } from '@ai-system/orchestration';
import {
  AnthropicAdapter,
  DrizzleCallLedger,
  ModelGateway,
  OpenAiAdapter,
  PLATFORM_DEFAULT_PROFILES,
} from '@ai-system/model-gateway';
import { createLlmAgents, createMockAgents, type Agents } from '@ai-system/agents';
import {
  CliAgentExecutor,
  ScriptedAgentExecutor,
  type AgentExecutor,
} from '@ai-system/agent-execution';
import { OutboxDispatcher } from './outbox-dispatcher.js';
import { executeStage } from './stages.js';
import type { StageServices } from './services.js';

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
  payload: z.record(z.unknown()).optional(),
});

const QUEUES = ['stage.execute', 'gate.request'] as const;

function buildServices(db: Db): StageServices {
  const mock = process.env.MOCK_MODELS === 'true';
  let agents: Agents;
  let executor: AgentExecutor;

  if (mock) {
    log.warn('MOCK_MODELS=true — deterministic agents and scripted executor (no LLM calls)');
    agents = createMockAgents();
    executor = new ScriptedAgentExecutor();
  } else {
    const gateway = new ModelGateway(
      [new AnthropicAdapter(), new OpenAiAdapter()],
      new DrizzleCallLedger(db),
    );
    agents = createLlmAgents(gateway, {
      classifier: PLATFORM_DEFAULT_PROFILES.classifier!,
      research: PLATFORM_DEFAULT_PROFILES.research!,
      planning: PLATFORM_DEFAULT_PROFILES.planning!,
      review: PLATFORM_DEFAULT_PROFILES.review!,
    });
    executor = new CliAgentExecutor({
      ...(process.env.CODING_AGENT_CMD ? { commandTemplate: process.env.CODING_AGENT_CMD } : {}),
    });
  }

  return {
    db,
    agents,
    executor,
    dataDir: process.env.AI_DATA_DIR ?? join(process.cwd(), 'data'),
    codingTimeoutMs: Number(process.env.CODING_TIMEOUT_MS ?? 15 * 60 * 1000),
    githubToken: process.env.GITHUB_TOKEN,
  };
}

/** Attach the artifact a human needs to judge this gate (plan, PR package). */
async function enrichGatePayload(
  db: Db,
  runId: string,
  gate: GateKind,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const kind =
    gate === 'plan_approval' ? 'implementation_plan' : gate === 'final_pr' ? 'pr_package' : null;
  if (!kind) return payload;
  const rows = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.kind, kind)))
    .orderBy(desc(artifacts.createdAt))
    .limit(1);
  return rows[0] ? { ...payload, artifactId: rows[0].id, artifactKind: kind } : payload;
}

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://ai:ai@localhost:5432/ai_system';
  const pool = createPool(connectionString);
  const db = createDb(pool);

  if (process.env.MIGRATE_ON_START !== 'false') {
    await migrateDb(db);
    log.info('migrations applied');
  }

  const services = buildServices(db);

  const boss = new PgBoss({ connectionString });
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);

  await boss.work('stage.execute', async (jobs) => {
    for (const job of jobs) {
      const payload = ExecuteStagePayload.parse(job.data);
      log.info({ runId: payload.runId, stage: payload.stage }, 'executing stage');
      await executeStage(services, payload);
    }
  });

  await boss.work('gate.request', async (jobs) => {
    for (const job of jobs) {
      const parsed = RequestGatePayload.parse(job.data);
      log.info({ runId: parsed.runId, gate: parsed.gate }, 'creating gate request');
      const payload = await enrichGatePayload(db, parsed.runId, parsed.gate, parsed.payload ?? {});
      await createGateRequest(db, { runId: parsed.runId, gate: parsed.gate, payload });
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
