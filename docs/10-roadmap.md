# 10 — Roadmap & MVP Scope

Phased for a single developer: every phase ends with something that runs end-to-end and is used on real tickets. The platform should start paying for itself (doing real work on your projects) at the end of Phase 1, and its own development becomes its best test corpus.

## Phase 0 — Foundations (≈ 2–3 weeks)

Skeleton with the load-bearing decisions implemented while they're cheap.

- Monorepo scaffold (apps, packages, lint-enforced context boundaries).
- Postgres + Drizzle schema for the core aggregates; migrations.
- Domain event + outbox + pg-boss plumbing; the `advance()` engine with a **trivial 3-stage pipeline** (intake → echo-agent → done) and engine replay tests.
- Model Gateway v1: Anthropic + OpenAI adapters, profiles, ledger, budget guard.
- CLI: `run start <ticket-file>`, `run status`, `gate approve` — the UI before the UI.
- Docker Compose local environment.

**Exit criterion:** a fake ticket flows through the trivial pipeline with events, artifacts, and costs recorded, resumable after killing the worker mid-run.

## Phase 1 — MVP: ticket → PR (≈ 6–8 weeks)

**The MVP thesis:** one project, one repo, a *linear* pipeline with a single coding agent, and a human gate on the plan and the PR. No decomposition, no parallelism — those multiply an already-working pipeline later.

### In scope

| Area | MVP content |
|---|---|
| Pipeline | intake → classify → research → plan → **plan gate** → code (1 task, 1 worktree) → review → test → iterate (budget 2) → package → **final gate** → PR |
| Ticket source | Jira read integration (fetch by key + webhook trigger); manual ticket paste as fallback |
| Agents | intake, classifier, research, planning, coding (via `cli` executor), review (read-only), testing (deterministic run + LLM interpretation) |
| Project Brain v1 | Layer 1 repo index (file map + symbols + deps); Layer 2 hand-authored rules/conventions via import scan + editor; structural + rules context assembly (semantic retrieval deferred) |
| Gates | automation levels `plan_gated` and `autonomous`; gate resolution via UI and CLI |
| UI (minimal) | runs list, run detail (timeline from events, artifacts, live logs via SSE), gate approval screens (plan diff view, PR package view), knowledge editor, model profile settings, basic cost view per run |
| Git host | GitHub first: push branch, open PR with plan + review + test evidence in the body |
| Delivery | single-user auth, Docker Compose, one org/project seeded |

### Explicitly out of MVP scope

Task decomposition & parallel agents; integration agent; semantic (vector) retrieval; learning loop/distiller; multi-repo, multi-project, multi-org UI; documentation agent; Jira write-back beyond a PR-link comment; cloud deployment; `api_loop` executor; prompt A/B tooling.

**Exit criterion:** a real Jira ticket on a real repository becomes a reviewed, tested, human-approved PR — and you actually merge it.

## Phase 2 — The team (≈ 6–8 weeks) — **delivered**

Turn one agent into a coordinated team; make the Brain learn.

- Complexity-driven policy (full [03 §4](03-domain-model.md) table); decomposition agent + task DAG + parallel coding agents in worktrees; deterministic integration stage + conflict-resolution agent.
- Iteration loop on review findings (findings → fix tasks → bounded re-execution).
- Project Brain: pgvector semantic retrieval; episodic memory; **learning loop** (distiller → proposals → approval inbox).
- Documentation agent; Jira write-back (transitions, comments).
- UI: task graph visualization, review dashboard (findings lifecycle), knowledge approval inbox, brain inspector.
- `api_loop` executor v1 — first step off CLI dependence.

**Implementation notes.** Two things landed differently from the sketch above, deliberately:
complexity specialization of policy is applied by the *engine* at classification time (a stage
handler must never write policy), and knowledge approval is a direct decision on the item rather
than a `gate_request` — the source run has already completed, so there is no run to park. The
conflict-resolution agent ships as "attempt, verify, else fail": it re-checks for conflict markers
and aborts the merge if any remain.

## Phase 3 — The product (≈ 8–12 weeks) — **delivered**

From personal tool to multi-tenant platform.

- Multi-project, multi-repo, multi-org; roles and permissions; team gate workflows (assignments, notifications).
- Cloud deployment: managed Postgres, S3 artifacts, autoscaled workers, container-per-task sandboxes.
- Full dashboards: cost (project/provider/stage over time), execution history + analytics (success rate, iterations per run, findings by category), prompt/template management UI.
- Additional providers (Google, local/OpenAI-compatible); model catalog admin.
- Hardening: rate limits, run concurrency quotas, backup/restore, audit export, SSO groundwork.

**Implementation notes.** Auth landed as hashed API keys with a principal
resolved per request, rather than Auth.js sessions — machine access (CLI, CI,
webhooks) is the dominant case, and a session layer can sit on top later
without changing the principal contract. Roles are a total order rather than a
matrix. Deployment specifics are in [11-deployment.md](11-deployment.md).

## Phase 4 — The moat — **delivered**

- `api_loop` coding executor (full platform-owned tool loop) as a first-class alternative to CLI agents.
- Specialized agents (migration, security review, performance); cross-project knowledge (org-level patterns).
- Retrieval tuning from outcomes (which context correlates with first-pass success); evaluation harness — replay historical tickets against changed prompts/models/rules and diff outcomes.
- Public API + outbound webhooks; GitHub/GitLab/Bitbucket; Jira/Linear/Azure DevOps intake.

**Implementation notes.** The `api_loop` executor became a real coding agent:
`edit_file` demands a unique exact match (ambiguity is an error, never a
guess), and `run_command` executes only strings the repository itself declared
— the model selects from an allowlist, it never composes shell. Specialized
reviewers run as extra passes per repository, attributed through the finding
category; the specialty list (`security`, `performance`, `migration`) is data,
so adding one is an entry plus a prompt. The evaluation harness replays a
historical ticket through the pipeline as configured *today* and diffs outcome
metrics; eval runs are excluded from analytics and the learning loop, so
measuring the platform never changes it — and because the final PR gate is
never disabled, a replay "finishes" at `awaiting_final_approval`.
Cross-project knowledge is a promotion (`knowledge promote`).

Retrieval tuning landed as `context_grants`: every assembled context records
what the run received, and settled outcomes turn that into a bounded ranking
prior (sample floor of three runs, clamped to ±0.05, applied after
nearest-neighbour search, never to approved rules). Knowledge effectiveness
now reads from those grants rather than matching rule titles inside task-spec
artifacts, which also removed that query's blind spot for offloaded artifacts.
Every surface labels the result as correlation and shows the sample size.

Git hosts and trackers were pulled behind explicit ports: `gitHostFor` resolves
GitHub, GitLab, or Bitbucket from the remote and the credentials present, and
a recognized forge with no credentials now reports that in the package artifact
instead of silently producing no link. Azure DevOps joined Jira and Linear as
an intake source with the same PR-link write-back. Outbound webhooks close the
public-API item: endpoints tail `domain_events` through their own cursor, so
the orchestration engine keeps no knowledge of subscribers, and deliveries are
HMAC-signed with a bounded retry schedule that lives where an operator can see
it.

## Sequencing rationale & risks

| Risk | Mitigation in plan |
|---|---|
| Coding-agent quality is the product's ceiling | Wrap the best available CLIs first (Phase 1) instead of building a loop; invest in *context quality* (Brain) — the platform's real lever — from Phase 1 |
| Solo scope creep | MVP is deliberately linear; every later capability multiplies a pipeline that already ships PRs |
| Determinism erosion (LLM creep into control flow) | Engine replay tests from Phase 0; schemas + validation as the only door into domain state |
| Learning loop produces noise | Ships in Phase 2 only after real run history exists; evidence-citation + human approval gates from day one |
| CLI executor lock-in | `AgentExecutor` contract from Phase 0; `api_loop` grows from single-call agents (Phase 2) to coding (Phase 4) |

## What "done" looks like per phase

- **P0:** the machine is trustworthy.
- **P1:** the machine ships a PR you merge.
- **P2:** the machine works like a team and gets smarter every run.
- **P3:** other people can use it.
- **P4:** it is measurably better at *your* projects than any generic agent — because of the Brain, and it can now show the measurement.

Phase 4's scope is delivered. What follows is not a phase but a standing agenda: deeper retrieval models as grant history accumulates, more specialized reviewers as real findings justify them, and additional forges and trackers on demand — each one now an adapter behind an existing port rather than a change to the engine.
