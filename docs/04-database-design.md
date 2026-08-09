# 04 — Database Design

## 1. Storage decisions

| Concern | Choice | Why |
|---|---|---|
| Domain state | **PostgreSQL 16+** | Single source of truth; transactional state machine; one backup story |
| Embeddings | **pgvector** extension | Avoids a second vector database at MVP scale; HNSW indexes are ample for per-project corpora (10⁴–10⁶ chunks); swappable behind the Brain's retrieval facade if ever needed |
| Job queue | **pg-boss** (Postgres-backed) | Jobs enqueue in the *same transaction* as state changes — no dual-write problem; no Redis to operate |
| Events / audit | Append-only Postgres tables + transactional outbox | Perfect ordering with state changes; audit and state can never disagree |
| Large artifacts | Object storage (local FS → S3-compatible), content-addressed | Diffs, transcripts, logs don't belong in row storage; DB keeps hash + ref |
| Repo checkouts | Worker filesystem (ephemeral) | Clones are cache; git remotes are truth |

Conventions: UUIDv7 primary keys (time-ordered); `created_at`/`updated_at` everywhere; **every tenant-owned table carries `organization_id`** with composite indexes, enabling row-level security in cloud mode without schema change; enums as Postgres enum types (values in [03-domain-model.md](03-domain-model.md)); soft deletes only where the UI needs undo (projects, knowledge) — runs are never deleted, only cancelled.

## 2. Schema by context

DDL is representative, not exhaustive (timestamps, FKs, and obvious indexes elided).

### 2.1 Identity & Tenancy

```sql
CREATE TABLE organizations (
  id uuid PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL
);
CREATE TABLE users (
  id uuid PRIMARY KEY, email citext UNIQUE NOT NULL, display_name text
);
CREATE TABLE memberships (
  organization_id uuid REFERENCES organizations,
  user_id uuid REFERENCES users,
  role text NOT NULL,               -- owner | admin | maintainer | viewer
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE api_keys (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  name text, key_hash text NOT NULL, scopes text[] NOT NULL, expires_at timestamptz
);
```

### 2.2 Project & Repository

```sql
CREATE TABLE projects (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  name text NOT NULL, description text,
  settings jsonb NOT NULL DEFAULT '{}',        -- branch policy, budgets, iteration defaults
  deleted_at timestamptz
);
CREATE TABLE repositories (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
  remote_url text NOT NULL, default_branch text NOT NULL,
  credentials_ref text,                        -- pointer into secret store, never the secret
  index_status text NOT NULL DEFAULT 'pending',-- pending | indexing | ready | stale | error
  last_indexed_commit text
);
```

### 2.3 Orchestration

```sql
CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  project_id uuid NOT NULL, repository_id uuid NOT NULL,
  ticket_key text NOT NULL,
  ticket_snapshot jsonb NOT NULL,
  complexity text,                              -- tiny|small|medium|large|epic
  status text NOT NULL,                         -- see 03 §3.1
  current_stage text,
  policy_snapshot jsonb NOT NULL,               -- frozen gates + model profiles + budgets
  branch_name text,
  iteration_count int NOT NULL DEFAULT 0,
  iteration_budget int NOT NULL,
  version int NOT NULL DEFAULT 0                -- optimistic lock: engine transitions CAS on this
);
CREATE INDEX ON pipeline_runs (organization_id, project_id, status);

CREATE TABLE stage_executions (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES pipeline_runs,
  stage_kind text NOT NULL, attempt int NOT NULL DEFAULT 1,
  status text NOT NULL,                         -- queued|running|succeeded|failed|skipped
  input_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  output_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  error jsonb, started_at timestamptz, finished_at timestamptz,
  UNIQUE (run_id, stage_kind, attempt)
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES pipeline_runs,
  title text NOT NULL, spec_artifact_id uuid NOT NULL,
  status text NOT NULL,                         -- pending|ready|running|completed|failed
  origin text NOT NULL,                         -- decomposition | fix_iteration
  worktree_branch text, assigned_agent_kind text NOT NULL DEFAULT 'coding',
  attempt int NOT NULL DEFAULT 1, max_attempts int NOT NULL DEFAULT 2
);
CREATE TABLE task_dependencies (
  task_id uuid REFERENCES tasks, depends_on_task_id uuid REFERENCES tasks,
  PRIMARY KEY (task_id, depends_on_task_id)
);
```

### 2.4 Agent Execution & Artifacts

```sql
CREATE TABLE agent_runs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL,
  stage_execution_id uuid, task_id uuid,        -- exactly one is set
  agent_kind text NOT NULL, executor_kind text NOT NULL,   -- cli | api_loop
  status text NOT NULL,                         -- queued|preparing|running|validating|succeeded|failed
  failure_reason text,                          -- invalid_output|sandbox_error|model_error|timeout|budget_denied
  model_profile_used jsonb NOT NULL,
  context_bundle_artifact_id uuid,
  result_artifact_id uuid,
  duration_ms int, total_input_tokens int, total_output_tokens int, total_cost_usd numeric(12,6)
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid,
  kind text NOT NULL, schema_version int NOT NULL DEFAULT 1,
  content_hash text NOT NULL,
  content jsonb,                                -- small artifacts inline
  storage_ref text,                             -- large artifacts in object storage
  produced_by_agent_run_id uuid,
  supersedes_artifact_id uuid,
  CHECK (content IS NOT NULL OR storage_ref IS NOT NULL)
);
CREATE INDEX ON artifacts (run_id, kind);
```

### 2.5 Review & Gates

```sql
CREATE TABLE gate_policies (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid UNIQUE NOT NULL,
  automation_level text NOT NULL,               -- research_only | plan_gated | code_gated | review_gated | autonomous
  overrides jsonb NOT NULL DEFAULT '{}'         -- per-complexity gate additions/removals
);
CREATE TABLE gate_requests (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL,
  gate_kind text NOT NULL, payload_artifact_id uuid,
  status text NOT NULL DEFAULT 'open'           -- open | resolved | expired
);
CREATE TABLE gate_decisions (
  id uuid PRIMARY KEY, gate_request_id uuid UNIQUE NOT NULL REFERENCES gate_requests,
  decided_by uuid NOT NULL REFERENCES users,
  decision text NOT NULL,                       -- approve | reject | approve_with_edits
  comment text, edited_artifact_id uuid
);
CREATE TABLE review_findings (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL,
  agent_run_id uuid NOT NULL,
  severity text NOT NULL, category text NOT NULL,
  file text, line int, description text NOT NULL, suggested_fix text,
  status text NOT NULL DEFAULT 'open',
  fix_task_id uuid, waived_by uuid, waive_reason text
);
```

### 2.6 Project Brain

```sql
CREATE TABLE knowledge_items (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  scope text NOT NULL, project_id uuid, repository_id uuid,
  kind text NOT NULL, origin text NOT NULL,     -- manual | learned
  source_run_id uuid,
  status text NOT NULL DEFAULT 'proposed',      -- proposed | approved | deprecated | rejected
  title text NOT NULL, content text NOT NULL,   -- markdown
  structured jsonb NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1, supersedes_id uuid,
  approved_by uuid, approved_at timestamptz
);
CREATE INDEX ON knowledge_items (project_id, kind) WHERE status = 'approved';

CREATE TABLE knowledge_chunks (                 -- retrieval units
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  source_type text NOT NULL,                    -- knowledge_item | repo_file | past_run | review
  source_id uuid NOT NULL, project_id uuid NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1024),                       -- dimension per chosen embedding model
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE repo_index_snapshots (
  id uuid PRIMARY KEY, repository_id uuid NOT NULL,
  commit_sha text NOT NULL,
  file_map jsonb NOT NULL,                      -- tree + roles (src/test/config/docs)
  symbol_index_ref text NOT NULL,               -- object storage: symbols, exports, deps graph
  stats jsonb NOT NULL,
  UNIQUE (repository_id, commit_sha)
);
```

### 2.7 Model Gateway

```sql
CREATE TABLE model_profiles (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  project_id uuid,                              -- NULL = org default
  binding text NOT NULL,                        -- agent kind or stage kind
  provider text NOT NULL, model text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  fallbacks jsonb NOT NULL DEFAULT '[]',        -- ordered [{provider, model, params}]
  UNIQUE (organization_id, project_id, binding)
);
CREATE TABLE model_calls (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  agent_run_id uuid NOT NULL, run_id uuid NOT NULL,
  provider text NOT NULL, model text NOT NULL,
  prompt_hash text NOT NULL, fallback_index int NOT NULL DEFAULT 0,
  input_tokens int, output_tokens int, cost_usd numeric(12,6), latency_ms int,
  outcome text NOT NULL                         -- ok | rate_limited | provider_error | invalid_output
);
CREATE INDEX ON model_calls (organization_id, run_id);
```

### 2.8 Events, outbox, audit

```sql
CREATE TABLE domain_events (                    -- append-only; the run timeline is a query over this
  sequence bigserial PRIMARY KEY,
  organization_id uuid NOT NULL, run_id uuid,
  event_type text NOT NULL,
  aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON domain_events (run_id, sequence);

CREATE TABLE outbox (                           -- transactional outbox → pg-boss dispatcher
  id uuid PRIMARY KEY, event_sequence bigint NOT NULL REFERENCES domain_events,
  dispatched_at timestamptz
);

CREATE TABLE audit_records (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL,
  actor_kind text NOT NULL,                     -- user | agent | system
  actor_id uuid, action text NOT NULL,
  subject_type text NOT NULL, subject_id uuid NOT NULL,
  before_ref uuid, after_ref uuid, occurred_at timestamptz NOT NULL DEFAULT now()
);
```

## 3. Consistency mechanics

- **State transitions:** every engine transition is one transaction: CAS on `pipeline_runs.version` → update state → insert `domain_events` → insert `outbox` → enqueue pg-boss jobs. A concurrent conflicting transition fails the CAS and is re-evaluated against fresh state — the machine can never fork.
- **Outbox dispatch:** pg-boss jobs are enqueued in the same transaction (pg-boss lives in the same Postgres), so the classic outbox relay is only needed for *external* deliveries (webhooks out, notifications).
- **Idempotency:** workers treat jobs as at-least-once; every job handler keys its side effects on `(stage_execution_id, attempt)` or `(task_id, attempt)`.
- **Read models:** the UI's timeline, task graph, and cost dashboard are plain SQL projections over `domain_events` and `model_calls` — no separate read store until scale demands it.

## 4. Data retention & growth

| Data | Policy |
|---|---|
| `domain_events`, `audit_records` | Keep forever (partitioned by month at scale) |
| `model_calls` | Keep forever (cost history); roll up to daily aggregates for dashboards |
| Artifact blobs | Content-addressed, deduplicated; cold-tier after run completion |
| Agent transcripts | Keep for the audit window (configurable, default 180 days), then summarize + archive |
| `knowledge_chunks` | Rebuildable cache — always regenerable from sources |
