import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

// Schema follows docs/04-database-design.md. Conventions: UUIDv7 ids generated
// in application code; every tenant-scoped table carries organization_id;
// timestamps are timestamptz.

const id = () => uuid('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ── Identity & Tenancy ────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  // Per-tenant limits: { maxConcurrentRuns, monthlyBudgetUsd, requestsPerMinute }.
  quotas: jsonb('quotas').notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

/**
 * Machine credentials for the CLI, CI, and webhooks. Only a hash is stored —
 * the plaintext key is shown once, at creation, and is unrecoverable after.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id').references(() => users.id),
    name: text('name').notNull(),
    // Short non-secret prefix so a key is identifiable in a list without revealing it.
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    role: text('role').notNull().default('member'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_keys_hash_idx').on(t.keyHash),
    index('api_keys_org_idx').on(t.organizationId),
  ],
);

/** Catalogue of usable models: pricing is data, not code (docs/07). */
export const modelCatalog = pgTable(
  'model_catalog',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputPerMTokUsd: numeric('input_per_mtok_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    outputPerMTokUsd: numeric('output_per_mtok_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    capabilities: jsonb('capabilities').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('model_catalog_key_idx').on(t.organizationId, t.provider, t.model)],
);

// ── Project & Repository ──────────────────────────────────────────────

export const projects = pgTable('projects', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  automationLevel: text('automation_level').notNull().default('plan_gated'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
});

export const repositories = pgTable('repositories', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  remoteUrl: text('remote_url').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  // Pointer into the secret store — the credential itself never lives here.
  credentialsRef: text('credentials_ref'),
  // Per-repository execution settings: allowlisted commands the sandbox may
  // run (testCommand, lintCommand), branch naming, etc. (docs/06 §4).
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
});

// ── Orchestration ─────────────────────────────────────────────────────

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    repositoryId: uuid('repository_id').references(() => repositories.id),
    status: text('status').notNull().default('created'),
    currentStage: text('current_stage'),
    // Optimistic-concurrency token: every transition does
    // UPDATE ... SET version = version + 1 WHERE version = $expected.
    version: integer('version').notNull().default(1),
    complexity: text('complexity'),
    policySnapshot: jsonb('policy_snapshot').notNull(),
    ticket: jsonb('ticket').notNull(),
    iterationCount: integer('iteration_count').notNull().default(0),
    error: text('error'),
    // Set when this run is an evaluation replay of another run (docs/10
    // Phase 4). Eval runs are excluded from analytics and from the learning
    // loop, so measuring the platform never changes it.
    evalOfRunId: uuid('eval_of_run_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pipeline_runs_project_idx').on(t.projectId, t.createdAt),
    index('pipeline_runs_eval_idx').on(t.evalOfRunId),
  ],
);

export const stageExecutions = pgTable(
  'stage_executions',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    stage: text('stage').notNull(),
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(1),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('stage_executions_run_idx').on(t.runId, t.createdAt)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    title: text('title').notNull(),
    spec: jsonb('spec').notNull(),
    status: text('status').notNull().default('created'),
    origin: text('origin').notNull().default('decomposition'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(2),
    // Each task gets its own branch + worktree so agents never collide (docs/06 §4).
    branch: text('branch'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('tasks_run_idx').on(t.runId)],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

// ── Agent Execution ───────────────────────────────────────────────────

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    stageExecutionId: uuid('stage_execution_id').references(() => stageExecutions.id),
    taskId: uuid('task_id').references(() => tasks.id),
    agentKind: text('agent_kind').notNull(),
    executorKind: text('executor_kind').notNull(),
    status: text('status').notNull().default('queued'),
    failureReason: text('failure_reason'),
    // Provider conversation id used to continue a timed-out/cancelled agent
    // without discarding its reasoning and validation context.
    sessionId: text('session_id'),
    // The exact context bundle is persisted (as an artifact) BEFORE execution
    // so every agent run is reproducible.
    contextBundleArtifactId: uuid('context_bundle_artifact_id'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('agent_runs_run_idx').on(t.runId)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    kind: text('kind').notNull(),
    // Small artifacts inline; large ones in object storage. Exactly one is set.
    content: jsonb('content'),
    storageRef: text('storage_ref'),
    contentHash: text('content_hash').notNull(),
    createdByAgentRunId: uuid('created_by_agent_run_id'),
    createdAt: createdAt(),
  },
  (t) => [index('artifacts_run_idx').on(t.runId, t.kind)],
);

// ── Review & Gates ────────────────────────────────────────────────────

export const gateRequests = pgTable(
  'gate_requests',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    gate: text('gate').notNull(),
    status: text('status').notNull().default('pending'),
    payload: jsonb('payload').notNull().default({}),
    // Team workflow: who is expected to decide, and who has been told.
    assignedToUserId: uuid('assigned_to_user_id'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('gate_requests_run_idx').on(t.runId, t.status)],
);

export const gateDecisions = pgTable('gate_decisions', {
  id: id(),
  gateRequestId: uuid('gate_request_id')
    .notNull()
    .references(() => gateRequests.id),
  decision: text('decision').notNull(),
  comment: text('comment'),
  decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
  createdAt: createdAt(),
});

export const reviewFindings = pgTable(
  'review_findings',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    filePath: text('file_path'),
    status: text('status').notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('review_findings_run_idx').on(t.runId, t.status)],
);

// ── Project Brain ─────────────────────────────────────────────────────

export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    projectId: uuid('project_id').references(() => projects.id),
    repositoryId: uuid('repository_id').references(() => repositories.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    origin: text('origin').notNull().default('manual'),
    status: text('status').notNull().default('approved'),
    scopeTags: jsonb('scope_tags').notNull().default([]),
    version: integer('version').notNull().default(1),
    sourceRunId: uuid('source_run_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_items_project_idx').on(t.projectId, t.status, t.kind)],
);

/**
 * Embedded slices of retrievable text (docs/04 §2.6). `sourceType` keeps
 * curated knowledge and episodic memory in one index while remaining
 * filterable, so retrieval can weight them differently.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    sourceType: text('source_type').notNull(), // knowledge_item | run | finding
    sourceId: uuid('source_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('knowledge_chunks_source_idx').on(t.sourceType, t.sourceId),
    index('knowledge_chunks_project_idx').on(t.projectId, t.sourceType),
    // Cosine HNSW: the retrieval path is nearest-neighbour by cosine distance.
    index('knowledge_chunks_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
);

// Layer 1 cache, never truth (docs/08 §1): rebuildable from the repo.
export const repoIndexSnapshots = pgTable(
  'repo_index_snapshots',
  {
    id: id(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    commitSha: text('commit_sha').notNull(),
    index: jsonb('index').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('repo_index_snapshots_repo_idx').on(t.repositoryId, t.createdAt)],
);

// ── Model Gateway ─────────────────────────────────────────────────────

export const modelProfiles = pgTable('model_profiles', {
  id: id(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  projectId: uuid('project_id').references(() => projects.id),
  purpose: text('purpose').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  params: jsonb('params').notNull().default({}),
  fallbacks: jsonb('fallbacks').notNull().default([]),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const modelCalls = pgTable(
  'model_calls',
  {
    id: id(),
    runId: uuid('run_id').references(() => pipelineRuns.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    purpose: text('purpose').notNull(),
    promptHash: text('prompt_hash').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('model_calls_run_idx').on(t.runId, t.createdAt)],
);

// ── Events, Outbox, Audit ─────────────────────────────────────────────

export const domainEvents = pgTable(
  'domain_events',
  {
    id: id(),
    runId: uuid('run_id'),
    name: text('name').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('domain_events_run_idx').on(t.runId, t.createdAt)],
);

// Transactional outbox: command rows written in the SAME transaction as the
// state change; the dispatcher publishes them to pg-boss and marks them done.
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    jobName: text('job_name').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('outbox_pending_idx').on(t.processedAt, t.createdAt)],
);

export const auditRecords = pgTable(
  'audit_records',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_records_org_idx').on(t.organizationId, t.createdAt)],
);

/**
 * What Brain material a run actually received (docs/08 §4). One row per run per
 * source: the grant is "this run saw this", not "how often". Outcomes are joined
 * from `pipeline_runs` at query time rather than denormalized here, because a
 * run's outcome changes after the grant is written.
 */
export const contextGrants = pgTable(
  'context_grants',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    runId: uuid('run_id').notNull(),
    // knowledge_item | run | finding — mirrors knowledge_chunks.source_type.
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    title: text('title').notNull(),
    // Which part of the assembled context it landed in: related | episodes.
    section: text('section').notNull(),
    rank: integer('rank').notNull().default(0),
    // Retrieval score at grant time, kept so a prior can never be recomputed
    // from a later embedding and silently rewrite history.
    score: numeric('score', { precision: 8, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('context_grants_run_source_idx').on(t.runId, t.sourceType, t.sourceId),
    index('context_grants_source_idx').on(t.sourceType, t.sourceId),
    index('context_grants_project_idx').on(t.projectId),
  ],
);

// ── Outbound webhooks ─────────────────────────────────────────────────

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    // Signing secret for the HMAC-SHA256 signature header. Shown once at
    // creation, like an API key.
    secret: text('secret').notNull(),
    // Domain event names this endpoint wants; empty = every event.
    events: jsonb('events').notNull().default([]),
    active: boolean('active').notNull().default(true),
    /**
     * Tail position in `domain_events`. Set to the newest event at creation, so
     * a new endpoint receives what happens next rather than replaying history.
     * Ids are UUIDv7, so "greater than the cursor" is "later than the cursor".
     */
    cursorEventId: uuid('cursor_event_id'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_org_idx').on(t.organizationId, t.active)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    endpointId: uuid('endpoint_id').notNull(),
    eventName: text('event_name').notNull(),
    payload: jsonb('payload').notNull(),
    // pending | delivered | failed
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_deliveries_pending_idx').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
  ],
);
