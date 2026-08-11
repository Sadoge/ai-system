import { join, resolve } from 'node:path';
import PgBoss from 'pg-boss';
import { pino } from 'pino';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { artifacts, createDb, createPool, migrateDb, type Db } from '@ai-system/db';
import { GateKind } from '@ai-system/domain';
import { createGateRequest } from '@ai-system/orchestration';
import {
  AnthropicAdapter,
  ClaudeSubscriptionAdapter,
  CodexSubscriptionAdapter,
  DrizzleCallLedger,
  LocalHashEmbeddingAdapter,
  ModelGateway,
  OpenAiAdapter,
  OpenAiEmbeddingAdapter,
  PLATFORM_DEFAULT_PROFILES,
  resolveProfile,
} from '@ai-system/model-gateway';
import type {
  ModelTarget,
  ProviderAdapter,
  ResolvedProfile,
  SubscriptionCliStatus,
} from '@ai-system/model-gateway';
import type { Embedder } from '@ai-system/brain';
import { createLlmAgents, createMockAgents, type Agents } from '@ai-system/agents';
import { ApiLoopAgentExecutor, CliAgentExecutor } from '@ai-system/agent-execution';
import { agentJobLeaseSeconds, OutboxDispatcher } from './outbox-dispatcher.js';
import { DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS, recoverOrphanedAgentJobs } from './orphan-recovery.js';
import { WebhookNotifier } from './webhook-notifier.js';
import { executeStage, runTask } from './stages.js';
import { distillKnowledge } from './learning.js';
import { resolveExecutorCandidates, withAutomaticExecutorFallbacks } from './executors.js';
import type { StageServices } from './services.js';
// (Agents type is used for the mock roster's explicit annotation.)

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

const ExecuteTaskPayload = z.object({
  kind: z.literal('execute_task'),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
});

const DistillPayload = z.object({
  kind: z.literal('distill_knowledge'),
  runId: z.string().uuid(),
});

const QUEUES = ['stage.execute', 'task.execute', 'knowledge.distill', 'gate.request'] as const;
const DEFAULT_CODING_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_AGENT_JOB_LEASE_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_CODING_MAX_ATTEMPTS = 3;

function positiveDuration(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  log.warn({ name, value: raw, fallback }, 'invalid duration environment value');
  return fallback;
}

function positiveInteger(name: string, fallback: number): number {
  const value = positiveDuration(name, fallback);
  if (Number.isInteger(value)) return value;
  log.warn({ name, value, fallback }, 'expected an integer environment value');
  return fallback;
}

type ReasoningProvider = 'codex_cli' | 'claude_cli' | 'anthropic' | 'openai';
const REASONING_PURPOSES = [
  'classifier',
  'research',
  'planning',
  'decomposition',
  'review',
  'testing',
  'documentation',
  'distillation',
] as const;

function targetFor(provider: ReasoningProvider, purpose: string): ModelTarget {
  const defaults = PLATFORM_DEFAULT_PROFILES[purpose]!;
  const maxTokens = defaults.primary.params?.maxTokens;
  if (provider === 'codex_cli') {
    return {
      provider,
      model: process.env.CODEX_REASONING_MODEL || 'default',
      ...(maxTokens ? { params: { maxTokens } } : {}),
    };
  }
  if (provider === 'claude_cli') {
    return {
      provider,
      model: process.env.CLAUDE_REASONING_MODEL || 'default',
      ...(maxTokens ? { params: { maxTokens } } : {}),
    };
  }
  if (provider === 'anthropic') return defaults.primary;
  const openAi = [defaults.primary, ...defaults.fallbacks].find(
    (target) => target.provider === 'openai',
  );
  return {
    provider: 'openai',
    model: openAi?.model ?? 'gpt-4o',
    ...(maxTokens ? { params: { maxTokens } } : {}),
  };
}

function reasoningOrder(input: {
  codex: SubscriptionCliStatus;
  claude: SubscriptionCliStatus;
}): ReasoningProvider[] {
  const available: ReasoningProvider[] = [
    ...(input.codex.authenticated ? (['codex_cli'] as const) : []),
    ...(input.claude.authenticated ? (['claude_cli'] as const) : []),
    ...(process.env.ANTHROPIC_API_KEY ? (['anthropic'] as const) : []),
    ...(process.env.OPENAI_API_KEY ? (['openai'] as const) : []),
  ];
  const configured = process.env.REASONING_PROVIDER ?? 'auto';
  const allowed = new Set<ReasoningProvider>(['codex_cli', 'claude_cli', 'anthropic', 'openai']);
  if (configured !== 'auto' && !allowed.has(configured as ReasoningProvider)) {
    throw new Error(
      `invalid REASONING_PROVIDER="${configured}" — expected auto, codex_cli, claude_cli, anthropic, or openai`,
    );
  }
  if (configured === 'auto') return available.length > 0 ? available : ['codex_cli'];
  const primary = configured as ReasoningProvider;
  return [primary, ...available.filter((provider) => provider !== primary)];
}

function reasoningProfiles(order: ReasoningProvider[]): Record<string, ResolvedProfile> {
  const profiles: Record<string, ResolvedProfile> = { ...PLATFORM_DEFAULT_PROFILES };
  for (const purpose of REASONING_PURPOSES) {
    const targets = order.map((provider) => targetFor(provider, purpose));
    profiles[purpose] = {
      purpose,
      primary: targets[0]!,
      fallbacks: targets.slice(1),
    };
  }
  return profiles;
}

async function buildServices(db: Db): Promise<StageServices> {
  const mock = process.env.MOCK_MODELS === 'true';
  let agents: StageServices['agents'];

  // Embeddings always run through the gateway; in mock mode (and as a fallback
  // when no OpenAI key is set) that resolves to the deterministic local
  // embedder, so semantic retrieval works offline.
  // The OpenAI SDK throws at construction without a key, so it is only
  // registered when one exists; the local embedder always is.
  const embeddingGateway = new ModelGateway([], new DrizzleCallLedger(db), {
    embeddingAdapters: [
      ...(process.env.OPENAI_API_KEY ? [new OpenAiEmbeddingAdapter()] : []),
      new LocalHashEmbeddingAdapter(),
    ],
  });
  const embeddingProfile =
    mock || !process.env.OPENAI_API_KEY
      ? {
          purpose: 'embeddings',
          primary: { provider: 'local', model: 'local-hash' },
          fallbacks: [],
        }
      : PLATFORM_DEFAULT_PROFILES.embeddings!;
  const embedder: Embedder = {
    embed: async (texts) =>
      (await embeddingGateway.embed(embeddingProfile, { texts, meta: { purpose: 'embeddings' } }))
        .vectors,
  };

  // Subscription CLI providers reuse the user's saved login without exposing
  // it to prompts or copying credentials into the worker environment.
  const cliTimeoutMs = Number(process.env.REASONING_CLI_TIMEOUT_MS ?? 10 * 60 * 1000);
  const codexSubscription = new CodexSubscriptionAdapter({ timeoutMs: cliTimeoutMs });
  const claudeSubscription = new ClaudeSubscriptionAdapter({ timeoutMs: cliTimeoutMs });
  const [codexStatus, claudeStatus] = await Promise.all([
    codexSubscription.status(),
    claudeSubscription.status(),
  ]);
  const order = reasoningOrder({ codex: codexStatus, claude: claudeStatus });
  const defaultProfiles = reasoningProfiles(order);
  const apiAdapters: ProviderAdapter[] = [
    ...(process.env.ANTHROPIC_API_KEY ? [new AnthropicAdapter()] : []),
    ...(process.env.OPENAI_API_KEY ? [new OpenAiAdapter()] : []),
  ];
  const completionAdapters: ProviderAdapter[] = [
    codexSubscription,
    claudeSubscription,
    ...apiAdapters,
  ];
  log[codexStatus.authenticated ? 'info' : 'warn'](
    {
      provider: 'codex_cli',
      available: codexStatus.available,
      authenticated: codexStatus.authenticated,
    },
    'reasoning subscription CLI probe',
  );
  log[claudeStatus.authenticated ? 'info' : 'warn'](
    {
      provider: 'claude_cli',
      available: claudeStatus.available,
      authenticated: claudeStatus.authenticated,
    },
    'reasoning subscription CLI probe',
  );
  log.info({ primary: order[0], fallbacks: order.slice(1) }, 'reasoning provider order');

  // File-touching executors resolve per run + purpose. A project can assign
  // coding to Claude and conflict resolution to Codex (or the reverse).
  let gatewayForLoop: ModelGateway | null = null;
  const executorDeps = {
    mock,
    apiLoop: () => {
      if (apiAdapters.length === 0) {
        throw new Error('api_loop coding requires ANTHROPIC_API_KEY or OPENAI_API_KEY');
      }
      const apiProvider: ReasoningProvider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
      gatewayForLoop ??= new ModelGateway(apiAdapters, new DrizzleCallLedger(db));
      return new ApiLoopAgentExecutor(gatewayForLoop, {
        purpose: 'coding',
        primary: targetFor(apiProvider, 'planning'),
        fallbacks: [],
      });
    },
  };
  const codingMaxAttempts = positiveInteger(
    'CODING_MAX_EXECUTOR_ATTEMPTS',
    DEFAULT_CODING_MAX_ATTEMPTS,
  );
  const automaticExecutorTargets: ModelTarget[] = [
    ...(!mock && codexStatus.authenticated
      ? [{ provider: 'codex_cli', model: process.env.CODEX_CODING_MODEL || 'default' }]
      : []),
    ...(!mock && claudeStatus.authenticated
      ? [{ provider: 'claude_cli', model: process.env.CLAUDE_CODING_MODEL || 'default' }]
      : []),
  ];
  const executorAssignments = new Map<string, ResolvedProfile>();
  const executorsFor: StageServices['executorsFor'] = async (run, repo, purpose) => {
    const settings = (repo?.settings ?? {}) as {
      executor?: string;
      executorModel?: string;
      executorEffort?: 'low' | 'medium' | 'high';
    };
    const legacyProvider =
      settings.executor === 'claude_code' || settings.executor === 'cli'
        ? 'claude_cli'
        : settings.executor === 'codex'
          ? 'codex_cli'
          : (settings.executor ??
            process.env.CODING_EXECUTOR ??
            (mock ? 'scripted' : 'claude_cli'));
    const legacyDefault: ResolvedProfile = {
      purpose,
      primary: {
        provider: legacyProvider,
        model: settings.executorModel ?? 'default',
        ...(settings.executorEffort
          ? { params: { reasoningEffort: settings.executorEffort } }
          : {}),
      },
      fallbacks: [],
    };
    const cacheKey = `${run.id}:${purpose}`;
    let assignment = executorAssignments.get(cacheKey);
    if (!assignment) {
      assignment = await resolveProfile(
        db,
        {
          purpose,
          projectId: run.projectId,
          organizationId: run.organizationId,
        },
        { [purpose]: legacyDefault },
      );
      executorAssignments.set(cacheKey, assignment);
      if (executorAssignments.size > 1_000) executorAssignments.clear();
    }
    const profile = withAutomaticExecutorFallbacks(
      assignment,
      automaticExecutorTargets,
      codingMaxAttempts,
    );
    return resolveExecutorCandidates(repo as never, executorDeps, profile);
  };

  if (mock) {
    log.warn('MOCK_MODELS=true — deterministic agents and scripted executor (no LLM calls)');
    const mockAgents: Agents = createMockAgents();
    agents = async () => mockAgents;
  } else {
    const gateway = new ModelGateway(completionAdapters, new DrizzleCallLedger(db));
    // Profiles resolve per run (project > org > platform default) and are
    // cached for the run's lifetime in this worker.
    const cache = new Map<string, Agents>();
    agents = async (run) => {
      const cached = cache.get(run.id);
      if (cached) return cached;
      const scope = { projectId: run.projectId, organizationId: run.organizationId };
      const purposes = REASONING_PURPOSES;
      const resolved = await Promise.all(
        purposes.map((purpose) => resolveProfile(db, { purpose, ...scope }, defaultProfiles)),
      );
      const profiles = Object.fromEntries(
        purposes.map((purpose, index) => [purpose, resolved[index]!]),
      ) as unknown as Parameters<typeof createLlmAgents>[1];
      const built = createLlmAgents(gateway, profiles);
      cache.set(run.id, built);
      if (cache.size > 500) cache.clear();
      return built;
    };
  }

  return {
    db,
    agents,
    executorsFor,
    embedder,
    // Git resolves worktree paths relative to the checkout it runs inside.
    // Keep this root absolute so checkout and worktree operations agree even
    // when AI_DATA_DIR is configured as the documented relative `./data`.
    dataDir: resolve(process.env.AI_DATA_DIR ?? join(process.cwd(), 'data')),
    codingTimeoutMs: positiveDuration('CODING_TIMEOUT_MS', DEFAULT_CODING_TIMEOUT_MS),
    codingMaxAttempts,
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
  const connectionString = process.env.DATABASE_URL ?? 'postgres://ai:ai@localhost:5432/ai_system';
  const pool = createPool(connectionString);
  const db = createDb(pool);

  if (process.env.MIGRATE_ON_START !== 'false') {
    await migrateDb(db);
    log.info('migrations applied');
  }

  const services = await buildServices(db);

  const boss = new PgBoss({ connectionString });
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const queue of QUEUES) await boss.createQueue(queue);

  const recoveredJobs = await recoverOrphanedAgentJobs(
    pool,
    log,
    positiveDuration('ORPHAN_AGENT_HEARTBEAT_GRACE_MS', DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS),
  );
  if (recoveredJobs > 0) log.info({ recoveredJobs }, 'orphaned agent recovery complete');

  await boss.work('stage.execute', async (jobs) => {
    for (const job of jobs) {
      const payload = ExecuteStagePayload.parse(job.data);
      log.info({ runId: payload.runId, stage: payload.stage }, 'executing stage');
      await executeStage(services, payload);
    }
  });

  // Parallel coding agents. The engine already caps in-flight tasks per run
  // (policy.maxParallelTasks); this is the worker's own capacity, and the
  // batch is executed concurrently rather than one job per poll.
  const taskConcurrency = Number(process.env.TASK_CONCURRENCY ?? 4);
  await boss.work(
    'task.execute',
    { batchSize: taskConcurrency, pollingIntervalSeconds: 1 },
    async (jobs) => {
      await Promise.all(
        jobs.map(async (job) => {
          const payload = ExecuteTaskPayload.parse(job.data);
          log.info({ runId: payload.runId, taskId: payload.taskId }, 'executing task');
          await runTask(services, payload);
        }),
      );
    },
  );

  // Post-run learning. The run is already complete, so a failure here is
  // logged and dropped rather than surfaced as a run failure.
  await boss.work('knowledge.distill', async (jobs) => {
    for (const job of jobs) {
      const payload = DistillPayload.parse(job.data);
      try {
        const { proposed } = await distillKnowledge(services, payload);
        log.info({ runId: payload.runId, proposed }, 'distilled knowledge proposals');
      } catch (err) {
        log.error({ err, runId: payload.runId }, 'knowledge distillation failed');
      }
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

  // Tell the operator which coding CLIs are actually usable, at startup,
  // instead of letting the first run discover a missing binary.
  for (const name of ['claude_code', 'codex'] as const) {
    const available = await new CliAgentExecutor({ preset: name }).isAvailable();
    log[available ? 'info' : 'warn']({ cli: name, available }, 'coding agent CLI probe');
  }

  const leaseGraceMs = positiveDuration(
    'AGENT_JOB_LEASE_GRACE_MS',
    DEFAULT_AGENT_JOB_LEASE_GRACE_MS,
  );
  const fallbackAwareExpireInSeconds = agentJobLeaseSeconds(
    services.codingTimeoutMs,
    services.codingMaxAttempts,
    leaseGraceMs,
  );
  const dispatcher = new OutboxDispatcher(db, boss, log, {
    longRunningExpireInSeconds: fallbackAwareExpireInSeconds,
  });
  dispatcher.start();
  const webhooks = new WebhookNotifier(db, log);
  webhooks.start();
  log.info('worker started');

  const shutdown = async () => {
    log.info('shutting down');
    await dispatcher.stop();
    await webhooks.stop();
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
