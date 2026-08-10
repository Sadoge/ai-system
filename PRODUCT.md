# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user of the web UI is **an engineer who has started a run and is following it
through the pipeline**. They open the UI already knowing which run they care about: they
read the plan, watch stages advance live, inspect findings, and approve their own plan and
final-PR gates. The runs list is a way back to their run, not a fleet dashboard.

Two secondary audiences exist in the data model but do not drive the UI's design:

- Reviewers and leads acting on someone else's work through the gate queue and knowledge inbox.
- Organization admins managing quotas, budgets, model profiles, and audit exports.

Roles are a total order — `viewer < member < admin < owner` — and approving knowledge sits
above plain membership.

## Product Purpose

ai-system is a deterministic orchestration platform that drives a team of AI agents through
the full software development lifecycle, from Jira ticket to human-approved pull request.

It is explicitly **not a coding agent**. It is the machinery around agents: pipeline
orchestration, project knowledge (the Project Brain), provider-agnostic model routing, human
review gates, and full auditability. LLMs make decisions inside well-defined boundaries;
humans make the final calls.

Success is a run that reaches a pull request a human approves, with every decision along the
way legible after the fact.

## Positioning

Determinism and human gates are the mechanism, not a feature list. The `advance()` engine is
replayable, the outbox is transactional, and the pipeline pauses at plan and final-PR gates
rather than proceeding on the model's confidence. A neighboring product that wraps an agent in
a nicer chat window cannot truthfully claim the same: the value is that the run is inspectable
and stoppable at defined boundaries.

The Project Brain compounds — approved knowledge is always injected and never trimmed, while
proposals stay unembedded until a human approves them, so learning cannot silently reach an
agent.

## Operating Context

- Runs are started from the CLI (`run start ticket.md --pipeline mvp|team`), a Jira webhook,
  or the API. The UI is where they are watched and approved, not usually where they begin.
- The control plane API runs on `:3001`, the web UI on `:3000`; live run updates arrive over SSE.
- Coding agents execute in isolated git worktrees. Credentials never enter the sandbox.
- `MOCK_MODELS=true` exercises the entire loop offline with a deterministic local embedder and
  no API key — the normal state for development and for the test suite.
- Local infrastructure is Postgres 16 + pgvector via Docker Compose.

## Capabilities and Constraints

Confirmed capabilities the UI surfaces: runs list and live run detail, plan and final-PR gate
approval, findings dashboard, task DAG for the parallel `team` pipeline, knowledge editor and
approval inbox, Project Brain inspector, per-project model profiles, per-run cost, analytics,
and webhook settings.

Technical constraints:

- Next.js 15 App Router, React 19, Tailwind CSS v4 (`@import 'tailwindcss'`), TypeScript.
- pnpm workspaces driven by Turborepo; the web app is `apps/web`.
- Multi-tenant by construction: every request resolves to a principal from a hashed API key,
  and the principal's organization scopes every query. There is no ambient "current org" —
  cross-tenant reads return 404.
- Quotas are per organization (concurrent runs, monthly budget, requests per minute). Refusal
  happens at run start; mid-run budget exhaustion pauses for a human instead of failing.
- Merge conflicts are handed to an agent in the run worktree; if conflict markers remain the
  merge aborts and the stage fails. Nothing is ever force-resolved.

Terminology that should stay consistent in the interface: **run**, **stage**, **pipeline**
(`trivial` / `mvp` / `team`), **gate**, **finding**, **task DAG**, **Project Brain**,
**knowledge** vs **proposal**, **episodic memory**, **model profile**, **worktree**.

## Brand Commitments

The product name is lowercase **ai-system**, currently set in a monospace face with an emerald
accent against a near-black (`zinc-950`) ground. Nothing beyond the name is contractually
binding; the incumbent look is evidence, not a committed identity.

No logo, wordmark, or brand assets exist yet.

## Evidence on Hand

- Complete system design in `docs/` (architecture, bounded contexts, domain model, database
  design, event flow, agent lifecycle, model management, Project Brain, stack, roadmap,
  deployment), plus a substantial `README.md` with a working quickstart.
- A shipped, functioning UI across twelve routes in `apps/web/src/app`.
- Phases 0–4 are delivered per `docs/10-roadmap.md`.

Absences that future work must not fabricate: there are **no** customers, testimonials, case
studies, benchmarks, press, pricing, uptime figures, or usage numbers. There is no LICENSE
file in the repository yet, so the open-source license is undetermined.

## Product Principles

1. **The human decides at the boundary.** Gates are the product. Any surface that makes
   approving feel like a rubber stamp has failed, and any that hides the evidence behind the
   decision has failed worse.
2. **Determinism is legible or it is marketing.** If a run is replayable, the interface should
   let someone actually see what happened and in what order.
3. **Follow the engineer's own run.** The default path is one person tracking one run they
   started; breadth (fleet health, cross-org analytics) serves that, not the reverse.
4. **Never invent proof.** No fabricated metrics, customers, or claims — the honest absence of
   evidence is a product fact, not a gap to fill with placeholder copy.
5. **Terminology is load-bearing.** A finding, a proposal, and approved knowledge are
   different things with different consequences; the interface must never blur them.

## Open Decisions

- **License.** The project is intended to be open source but no LICENSE file exists and no
  license has been chosen.
- **Mobile scope beyond gates.** Gate approval is committed to mobile (see below); whether
  runs, findings, brain inspector, and analytics get real mobile design is unsettled.

## Accessibility & Inclusion

**Gate approval must work on a phone.** Approving a plan gate or a final PR gate is
time-sensitive and should not wait for a laptop, so gate surfaces get genuine mobile design.
Remaining surfaces are desktop-first and need only avoid breaking at smaller widths.

No other product-specific accessibility requirement has been established; standard contrast
and keyboard expectations apply.

## Distribution

Personal, open-source project. Multi-tenancy, roles, and quotas are groundwork built into the
platform, not preparation for a commercial launch — there are no customers to sell to and no
marketing surface is planned. A documentation or landing surface may matter for contributors.
