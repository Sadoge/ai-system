# ai-system

An AI Software Engineering Platform: a deterministic orchestration system that manages a team of AI agents through the full software development lifecycle — from Jira ticket to human-approved pull request.

This is not a coding agent. It is the machinery around agents: pipeline orchestration, project knowledge (the Project Brain), provider-agnostic model routing, human review gates, and full auditability. LLMs make decisions inside well-defined boundaries; humans make the final calls.

## Status

**Phase 1 — MVP pipeline** ([roadmap](docs/10-roadmap.md)): on top of the Phase 0 foundations
(deterministic `advance()` engine, transactional outbox, Model Gateway, pg-boss worker, CLI), the
full linear pipeline now runs: intake → classify → research → plan → **plan gate** → code (agent in
an isolated git worktree) → review → test → **iteration loop** → package → **final PR gate**.
Includes Project Brain v1 (structural repo index + curated rules, always injected into agent
context), typed single-call agents with invalid-output retry, the pluggable coding executor
(`cli` wrapping a headless agent CLI; `scripted` for keyless runs), review findings driving
bounded fix iterations, and GitHub branch push + PR creation in the package stage.

Set `MOCK_MODELS=true` to run the entire pipeline deterministically with no API key — mock agents
plant one review finding so you can watch the iteration loop work. Still to come in Phase 1: Jira
intake, the web UI, and per-project model profile resolution.

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

Start with [docs/README.md](docs/README.md) for the reading order and a summary of the core design decisions.
