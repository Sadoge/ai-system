# AI Software Engineering Platform — System Design

This directory contains the complete system design for the platform: a **deterministic orchestration system** that manages multiple AI agents through the full software development lifecycle — from Jira ticket to human-approved pull request.

The platform is *not* a coding agent. It is the machinery around agents: pipeline orchestration, knowledge management (the Project Brain), model routing, human review gates, and full auditability. LLMs make decisions **inside well-defined stage boundaries**; the system itself is deterministic.

## Reading order

| # | Document | What it covers |
|---|----------|----------------|
| 1 | [High-Level Architecture](01-architecture.md) | Layered architecture, component diagram, determinism boundary, deployment views |
| 2 | [Bounded Contexts](02-bounded-contexts.md) | DDD context map, responsibilities, relationships between contexts |
| 3 | [Domain Model](03-domain-model.md) | Aggregates, entities, invariants, lifecycle states |
| 4 | [Database Design](04-database-design.md) | PostgreSQL schema, pgvector, outbox, artifact storage, multi-tenancy |
| 5 | [Event Flow](05-event-flow.md) | Pipeline state machine, event catalog, sequence diagrams, iteration loop |
| 6 | [Agent Lifecycle](06-agent-lifecycle.md) | Agent contract, context assembly, worktree sandboxing, failure handling |
| 7 | [Model Management](07-model-management.md) | Provider abstraction layer, model profiles, fallbacks, cost metering |
| 8 | [Project Brain](08-project-brain.md) | Knowledge architecture, static vs. learned memory, approval workflow, retrieval |
| 9 | [Technology Stack](09-technology-stack.md) | Concrete technology choices with rationale |
| 10 | [Roadmap & MVP](10-roadmap.md) | Phased development roadmap and a realistic single-developer MVP scope |
| 11 | [Deployment & Operations](11-deployment.md) | Topologies, tenancy, quotas, backup/restore, observability |

## Core design decisions (summary)

These decisions were made up front and are elaborated in the documents above:

1. **Modular monolith, TypeScript end-to-end.** One pnpm monorepo; backend modules map 1:1 to bounded contexts so any context can be extracted into a service later. ([01](01-architecture.md), [09](09-technology-stack.md))
2. **Deterministic orchestration via an explicit state machine on PostgreSQL.** Pipeline runs are finite state machines persisted in Postgres, driven by a transactional outbox and a job queue (pg-boss). No LLM ever decides what stage runs next. ([05](05-event-flow.md))
3. **PostgreSQL as the single source of truth.** Relational schema + `pgvector` embeddings + append-only event/audit tables. Object storage for large artifacts. ([04](04-database-design.md))
4. **Pluggable `AgentExecutor` interface.** The MVP executor wraps headless agent CLIs running in isolated git worktrees; an API-driven custom loop is a later, second implementation of the same contract. ([06](06-agent-lifecycle.md))
5. **Provider-agnostic `ModelGateway`.** All LLM traffic flows through one internal gateway with per-provider adapters. Stage-level model profiles select provider/model; retries, fallbacks, and cost metering live in the gateway. ([07](07-model-management.md))
6. **Human-in-the-loop as first-class states.** Review gates are pipeline states, not bolt-ons. Automation level is a per-project policy. ([03](03-domain-model.md), [05](05-event-flow.md))
7. **Learned knowledge requires human approval.** The Project Brain distinguishes static from learned knowledge; learned items are `proposed` until a human approves them. ([08](08-project-brain.md))

## Glossary

| Term | Meaning |
|------|---------|
| **Pipeline run** | One end-to-end execution for one ticket, from intake to PR package |
| **Stage** | A deterministic step of a pipeline run (research, planning, review, …) |
| **Task** | A unit of coding work produced by decomposition; a node in the run's task DAG |
| **Agent run** | One invocation of one agent against one stage or task |
| **Gate** | A pipeline state that pauses for human approval |
| **Project Brain** | The layered, queryable knowledge store scoped to a project |
| **Model profile** | The binding of a stage/agent type to a provider, model, and parameters |
| **Artifact** | An immutable, versioned output of a stage or agent run (plan, diff, report, …) |
