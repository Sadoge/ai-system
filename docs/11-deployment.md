# 11 — Deployment & Operations

## 1. Topologies

| Mode | What runs | When |
|---|---|---|
| Local dev | Postgres in Docker; api/worker/web via `pnpm dev` | day-to-day development |
| Single host | `docker compose -f infra/docker/docker-compose.prod.yml up` | a team, one box |
| Cloud | managed Postgres + S3 + autoscaled workers behind the same images | multi-tenant |

The topology changes nothing about the architecture: workers are stateless and
pull from pg-boss, so scaling is `--scale worker=N` (or a task-count change),
and the control plane is a normal stateless HTTP service.

## 2. Images

One image (`infra/docker/Dockerfile`) serves the API, worker, and CLI — three
entrypoints, one dependency set, so the planes can never drift. `git` is
installed deliberately: worktrees are how coding agents are isolated. The UI
has its own image built on Next's standalone output.

## 3. Artifact storage

Artifacts are content-addressed. Small ones stay inline in Postgres so they
remain queryable; anything above `S3_INLINE_THRESHOLD_BYTES` (64 KiB default)
is written to object storage and the row keeps only a pointer. Setting
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` is the whole
switch — no code change, and `S3_ENDPOINT` covers MinIO/R2.

## 4. Tenancy and access

Every request carries a principal resolved from an API key, and the principal's
organization scopes every query. Roles are a total order —
`viewer < member < admin < owner` — because a permission matrix nobody can
reason about is a permission matrix nobody enforces correctly.

```bash
# Bootstrap the first organization, owner key, and project
ai-system org bootstrap --name "Acme" --key-name "founder"
```

Keys are stored as SHA-256 hashes; the plaintext is shown once at creation and
is unrecoverable afterwards. Revocation is immediate (`revoked_at`).

## 5. Quotas and rate limits

Per organization, in `organizations.quotas`:

| Quota | Enforced | Effect |
|---|---|---|
| `maxConcurrentRuns` | at run start | refuses to start a run beyond the limit |
| `monthlyBudgetUsd` | at run start | refuses when this month's spend is exhausted |
| `requestsPerMinute` | per request | token bucket per organization |

Mid-run budget exhaustion is deliberately *not* a hard stop: the gateway's
budget guard pauses the run and asks a human, because killing work halfway
wastes what was already spent.

The rate limiter is in-process, which is correct for one API node. A shared
limiter (Postgres or Redis) is the upgrade for multiple nodes; the interface
does not change.

## 6. Audit

Every mutation that a human might later have to explain — approvals above all —
writes an `audit_records` row with actor, action, subject, and payload.
`GET /api/audit?format=csv` exports it.

## 7. Backup and restore

Postgres is the source of truth for everything except large artifacts.

```bash
pg_dump --format=custom "$DATABASE_URL" > ai-system-$(date +%F).dump
pg_restore --clean --if-exists --dbname "$DATABASE_URL" ai-system-2026-01-01.dump
```

Object storage should have versioning enabled; artifacts are immutable and
content-addressed, so a restore never has to reconcile conflicting versions.
Repository checkouts and worktrees under `AI_DATA_DIR` are disposable — they
are rebuilt from the git remote on demand and need no backup.

## 8. Observability

Structured logs (pino) on every service. The domain event stream is the audit
trail of what the machine did, and `model_calls` is the cost ledger — including
CLI-driven spend, recorded under provider `cli:<name>` so dashboards do not
under-report the most expensive part of a run.
