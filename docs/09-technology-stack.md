# 09 — Technology Stack

Confirmed direction: **TypeScript end-to-end, custom Postgres-backed orchestration, pluggable agent executors.** Choices below optimize for a single developer shipping an MVP without closing doors to a commercial SaaS.

## 1. Summary table

| Layer | Choice | Alternatives considered |
|---|---|---|
| Language | TypeScript (strict) everywhere | Python core, Go core |
| Monorepo | pnpm workspaces + Turborepo | Nx (heavier than needed) |
| Backend framework | **NestJS** (Fastify adapter) | plain Fastify, tRPC-only |
| ORM / DB access | **Drizzle ORM** + raw SQL where it earns it | Prisma (weaker pgvector/raw-SQL ergonomics) |
| Database | PostgreSQL 16 + pgvector | + dedicated vector DB (unnecessary at this scale) |
| Job queue | **pg-boss** | BullMQ+Redis (extra infra), Temporal (see §3) |
| API contract | REST + OpenAPI, Zod schemas shared via `packages/domain` | tRPC (couples UI to server too tightly for a future public API) |
| Frontend | Next.js (App Router) + Tailwind + shadcn/ui | Remix, SPA |
| Realtime (logs, timeline) | SSE from the event stream | WebSockets (not needed for one-way feeds) |
| Repo indexing | tree-sitter (via node bindings) + `simple-git` | LSP servers per language (heavier, later) |
| Coding agent | Pluggable per repository behind `AgentExecutor`: Claude Code CLI, Codex CLI, or the platform's own `api_loop` | committing to a single vendor CLI |
| LLM SDKs | official provider SDKs wrapped by our adapters | LiteLLM proxy (see §4) |
| Validation | Zod (source of truth) + generated JSON Schema for structured outputs | — |
| Auth | Auth.js (email/OAuth) + org membership model; API keys for CLI/webhooks | Clerk/Auth0 (external dependency + cost) |
| Secrets | env + encrypted-at-rest DB fields (libsodium sealed boxes); cloud: KMS | Vault (operational overweight for now) |
| Observability | OpenTelemetry SDK + pino structured logs; self-host Grafana/Tempo or a hosted APM later | — |
| Testing | Vitest (unit + engine replay tests), Testcontainers for Postgres, Playwright for UI | — |
| Packaging / deploy | Docker Compose (local) → the same images on Fly.io/Render/ECS later | k8s from day one (premature) |

## 2. Rationale for the load-bearing picks

**NestJS over plain Fastify.** The architecture's promise is *enforced module boundaries per bounded context*. Nest's module system, DI, and guards give that structure out of the box and keep the monolith honest as it grows; the Fastify adapter keeps the HTTP layer fast. The worker entrypoint reuses the same Nest application context minus the HTTP server, so context facades and DI work identically in both planes.

**Drizzle over Prisma.** The engine leans on Postgres specifics: CAS transitions, `FOR UPDATE SKIP LOCKED` patterns, pgvector operators, partial indexes, JSONB-heavy rows. Drizzle stays close to SQL, generates types from the schema in the repo, and never fights hand-written queries. Migrations via drizzle-kit, committed and reviewed like code.

**pg-boss over BullMQ/Redis.** The decisive property: jobs enqueue **in the same transaction** as the state change and outbox append — the dual-write problem disappears, which is the backbone of "deterministic and auditable". One database to run, back up, and reason about. pg-boss handles retries, backoff, and `SKIP LOCKED` delivery; at MVP-to-mid scale (thousands of jobs/day, dozens concurrent) Postgres is nowhere near stressed. If queue throughput ever becomes the bottleneck, the queue is behind a thin facade and swappable — but that day is far away.

**REST + shared Zod contracts over tRPC.** A commercial platform grows a public API, webhooks, and a CLI; OpenAPI is the lingua franca for all three. Zod schemas in `packages/domain` are the single source of truth: request/response validation server-side, typed client for the UI, JSON Schema generation for agent structured outputs.

## 3. Why not Temporal (recorded decision)

Temporal delivers durable execution, retries, and replay — genuinely close to our needs. Rejected for now because: (1) it is a second stateful infrastructure system to operate and upgrade, heavy for a solo developer; (2) its replay-determinism constraints add friction around long, tool-heavy LLM activities; (3) our state machine is *domain-modeled* — run status, gates, and iteration budgets are first-class rows the UI queries directly, not workflow-engine internals to be mirrored out. The engine's `advance()` function is the seam: if scale ever demands it, stages become Temporal activities behind the same interface. This is ADR #1 in the platform's own knowledge base.

## 4. Why not LiteLLM as the gateway (recorded decision)

A proxy gives quick provider coverage but would externalize exactly the things this platform treats as core domain: per-agent-run budget enforcement, the call ledger with cost attribution, fallback semantics, capability normalization. The adapter SPI is small (~1 file per provider, see [07 §7](07-model-management.md)); owning it keeps metering and control native. Official SDKs are used inside adapters — never imported elsewhere (lint-enforced).

## 5. Monorepo layout

```
ai-system/
  apps/
    api/            # NestJS control plane
    worker/         # execution plane (same Nest context, queue consumers)
    web/            # Next.js UI
    cli/            # thin client over the REST API
  packages/
    domain/         # shared types, Zod schemas, event catalog, IDs
    contexts/       # one package per bounded context (see 02 §4)
    db/             # drizzle schema + migrations
    agent-cli/      # `cli` executor: sandbox mgmt, CLI invocation, transcript capture
  infra/
    docker/         # compose files, images
  docs/             # these documents
```

Tooling: `tsconfig` strict; ESLint with `import/no-restricted-paths` enforcing context boundaries; Prettier; Vitest; Changesets if packages are ever published.

## 6. Environment story

- **Local (MVP):** `docker compose up` → Postgres+pgvector; `pnpm dev` → api, worker, web. Repo workspaces under a configurable data dir. Agent CLI installed on the host/worker image; provider keys via `.env`.
- **Cloud (later):** identical images; managed Postgres; S3 artifacts; worker pool autoscaled on queue depth; per-task container sandboxes (gVisor/Firecracker-class isolation when multi-tenant). No architectural change — see [01 §6](01-architecture.md).
