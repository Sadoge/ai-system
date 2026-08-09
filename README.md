# ai-system

An AI Software Engineering Platform: a deterministic orchestration system that manages a team of AI agents through the full software development lifecycle — from Jira ticket to human-approved pull request.

This is not a coding agent. It is the machinery around agents: pipeline orchestration, project knowledge (the Project Brain), provider-agnostic model routing, human review gates, and full auditability. LLMs make decisions inside well-defined boundaries; humans make the final calls.

## Status

**Phase 1 — MVP** ([roadmap](docs/10-roadmap.md)): the full linear pipeline runs end to
end — intake → classify → research → plan → **plan gate** → code (agent in an isolated git
worktree) → review → test → **iteration loop** → package → **final PR gate** — on the Phase 0
foundations (deterministic `advance()` engine, transactional outbox, Model Gateway, pg-boss
worker). Phase 1 delivers:

- **Project Brain v1** — structural repo index + curated rules, always injected into agent context
- **Typed agents** (classifier/research/planner/reviewer) with invalid-output retry; deterministic
  mock roster via `MOCK_MODELS=true` (no API key needed — one planted finding exercises iteration)
- **Pluggable coding executor** — `cli` wraps a headless agent CLI (Claude Code by default) in a
  worktree; credentials never enter the sandbox
- **Jira read integration** — `run start --jira KEY`, webhook trigger, PR-link comment write-back
- **GitHub** — branch push + PR with plan/review/test evidence in the body
- **Control plane API** (NestJS/Fastify) — REST + SSE live run streams, bearer-token single-user auth
- **Web UI** (Next.js) — runs list, run detail with live updates, gate approval screens, knowledge
  editor, model profile settings, per-run cost
- **Per-project model profiles** — resolution cascade project → org → platform default

**Phase 2 — the team, and a Brain that learns.** A third pipeline, `team`, turns one agent into
several, and the Project Brain starts compounding:

- **Task DAG + parallel agents** — planning is decomposed into tasks; independent ones run as
  parallel coding agents in their own branches and worktrees, bounded by a parallelism limit
  derived from the ticket's complexity. An **integration stage** merges the branches back.
- **Conflict resolution** — a merge conflict is handed to an agent in the run worktree; if
  conflict markers remain, the merge aborts and the stage fails. Nothing is ever force-resolved.
- **Semantic retrieval** — knowledge and episodic memory are chunked and embedded into pgvector
  (HNSW, cosine). Approved rules are always included and never trimmed; only ranked material is.
- **Episodic memory** — completed runs and their blocking findings are indexed automatically:
  record, not rule, so no approval is needed.
- **Learning loop** — on completion a distiller proposes evidence-cited knowledge. Proposals are
  never embedded, so they cannot reach an agent until a human approves them in the inbox
  (`ai-system knowledge inbox`, or the UI). Rejected proposals are kept as negative examples.
- **Pluggable coding agents** — the agent that writes code is chosen **per repository**:
  `claude_code` (Claude Code CLI), `codex` (OpenAI Codex CLI), `api_loop` (the platform's own
  tool loop through the Model Gateway), or `scripted`. CLIs are spawned directly (never through a
  shell) with the prompt on stdin, get only an allowlisted environment, and their self-reported
  spend is written into the same cost ledger as gateway calls.

  ```bash
  ai-system repo check-agents                          # what's installed here
  ai-system repo register <url> --executor codex       # per repository
  ```
- **Also** — documentation stage, optional pre-merge gate, Jira status transitions, and UI for the
  task graph, findings dashboard, knowledge approval inbox, and brain inspector.

```bash
node apps/cli/dist/main.js run start ticket.md --pipeline team
node apps/cli/dist/main.js knowledge inbox      # approve what the platform learned
```

Everything above runs with `MOCK_MODELS=true` and no API key: a deterministic local embedder
backs semantic retrieval, so the whole loop is exercisable offline.

**Phase 3 — the product.** From personal tool to multi-tenant platform:

- **Multi-tenancy** — every request resolves to a principal from a hashed API
  key, and the principal's organization scopes every query. There is no ambient
  "current org": cross-tenant reads return 404, verified end to end.
- **Roles** — a total order (`viewer < member < admin < owner`), because a
  permission matrix nobody can reason about is one nobody enforces correctly.
  Approving knowledge sits above plain membership.
- **Quotas & rate limits** — per organization: concurrent runs, monthly budget,
  requests per minute. Refusal happens at run start, where it's cheap and
  comprehensible; mid-run budget exhaustion still pauses for a human instead.
- **Audit** — every mutation a human might have to explain is recorded with
  actor, action, and subject; `GET /api/audit?format=csv` exports it.
- **More providers** — Google Gemini and any OpenAI-compatible endpoint (vLLM,
  Ollama, OpenRouter). Pricing moved into a **model catalog** table, so a new
  model or a price change is a row, not a release.
- **Analytics** — daily spend, spend by provider and purpose, run outcomes with
  success rate and average iterations. CLI spend is included, so the numbers
  don't quietly exclude the most expensive part of a run.
- **Cloud** — S3-compatible artifact storage (large artifacts offloaded, small
  ones stay queryable in SQL), Docker images, a full production compose, and
  [deployment docs](docs/11-deployment.md).

```bash
ai-system org bootstrap --name "Acme" --key-name founder   # org + owner key + project
ai-system org quotas --org <id> --max-concurrent-runs 5
```

**Phase 4 — the moat (first delivery).** What makes the platform measurably better at *your*
projects than any generic agent:

- **Evaluation harness** — replay a historical ticket through the pipeline as configured *today*
  (current prompts, models, approved rules) and diff the outcome: iterations, findings, cost,
  duration. Eval runs never feed analytics or the learning loop, so measuring the platform
  cannot change it.
- **`api_loop` is now a real coding agent** — `edit_file` requires a unique exact match
  (ambiguity is an error, never a guess) and `run_command` executes only commands the repository
  declared; the model selects from an allowlist, it never composes shell.
- **Specialized reviewers** — opt-in security and performance passes per repository, each blind
  to everything outside its dimension, attributed through the finding category.
- **Cross-project knowledge** — promote a proven project rule to organization scope; knowledge
  effectiveness analytics show how runs that received each rule actually fared (correlation,
  labeled as such).
- **GitLab + Linear** — merge requests and issue intake behind the same ports as GitHub and Jira.

```bash
ai-system eval replay <run-id> && ai-system eval compare <eval-run-id>
ai-system knowledge promote <knowledge-item-id>
ai-system repo register <url> --reviewers security,performance
```


### Quickstart

```bash
pnpm install && pnpm build
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres 16 + pgvector
cp .env.example .env

node apps/cli/dist/main.js db migrate
node apps/cli/dist/main.js seed
node apps/worker/dist/main.js &                            # or: pnpm --filter @ai-system/worker dev

echo '# My first ticket' > ticket.md
node apps/cli/dist/main.js run start ticket.md            # trivial pipeline
node apps/cli/dist/main.js run status <run-id>

# Full MVP pipeline against a real repository (mock mode needs no API key):
node apps/cli/dist/main.js repo register /path/to/repo --test-command 'npm test'
MOCK_MODELS=true node apps/worker/dist/main.js &
node apps/cli/dist/main.js run start ticket.md --pipeline mvp
node apps/cli/dist/main.js gate list                      # approve the plan, then the final PR

# Or drive everything from the API + web UI:
node apps/api/dist/main.js &                              # control plane on :3001
pnpm --filter @ai-system/web start &                      # UI on :3000
```

`pnpm test` runs the engine replay tests and gateway tests; no database or API key required.

## Design

The complete system design lives in [`docs/`](docs/README.md):

- [High-Level Architecture](docs/01-architecture.md)
- [Bounded Contexts](docs/02-bounded-contexts.md)
- [Domain Model](docs/03-domain-model.md)
- [Database Design](docs/04-database-design.md)
- [Event Flow](docs/05-event-flow.md)
- [Agent Lifecycle](docs/06-agent-lifecycle.md)
- [Model Management](docs/07-model-management.md)
- [Project Brain](docs/08-project-brain.md)
- [Technology Stack](docs/09-technology-stack.md)
- [Roadmap & MVP](docs/10-roadmap.md)
- [Deployment & Operations](docs/11-deployment.md)

Start with [docs/README.md](docs/README.md) for the reading order and a summary of the core design decisions.
