# 07 — Model Management & Provider Abstraction

## 1. Goals

- Any stage can use any provider's model; mixing providers within one run is normal (e.g. plan with one vendor's strongest reasoning model, code with another's, review with a third).
- No provider SDK appears outside the Model Gateway context.
- Every call is metered, priced, and attributable to agent run → task/stage → run → project → org.
- Failures degrade predictably: retries → fallback chain → typed error to the engine.

## 2. The gateway interface

```ts
interface ModelGateway {
  complete(req: CompletionRequest, meta: CallMeta): Promise<CompletionResult>;
  stream(req: CompletionRequest, meta: CallMeta): AsyncIterable<CompletionDelta>;
  toolLoop(req: ToolLoopRequest, meta: CallMeta): Promise<ToolLoopResult>; // for api_loop executors
  embed(req: EmbedRequest, meta: CallMeta): Promise<EmbedResult>;
}

interface CompletionRequest {
  profile: ResolvedModelProfile; // provider+model+params already resolved
  system: string;
  messages: Message[];
  responseSchema?: JsonSchema; // structured output — enforced per provider capability
}

interface CallMeta {
  // attribution + control, mandatory on every call
  organizationId: string;
  runId: string;
  agentRunId: string;
  purpose: string; // 'planning' | 'coding' | ...
  budget: { remainingUsd: number }; // gateway refuses calls that would exceed it → budget_denied
}
```

Provider adapters implement a smaller internal SPI (`invoke`, `countTokens`, `price`, capability flags: structured output, tool use, reasoning-effort, streaming). The gateway normalizes differences: providers without native structured output get schema-in-prompt + gateway-side JSON validation and repair-retry; token accounting uses provider usage data when returned, adapter estimation otherwise.

```mermaid
flowchart LR
    subgraph agents["Agent Execution"]
        AE["Executors"]
    end
    subgraph gw["Model Gateway"]
        RES["Profile resolver"]
        POL["Retry / fallback / rate-limit"]
        BUD["Budget guard"]
        LED["Call ledger"]
        subgraph adapters["Adapters"]
            C1["Codex CLI subscription"]
            C2["Claude CLI subscription"]
            A1["Anthropic"]
            A2["OpenAI"]
            A3["Google"]
            A4["OpenAI-compatible / local"]
        end
    end
    AE --> RES --> BUD --> POL --> adapters
    POL --> LED
```

The `cli` executor is the one component that talks to a provider without going through the gateway's request path (the CLI owns its own loop). It is still integrated: the gateway issues it a scoped budget, and the executor reports the CLI's token/cost telemetry into the same ledger after the run, tagged `via: 'cli'`.

For local reasoning stages, the gateway also has two **subscription CLI adapters**:

- `codex_cli` invokes `codex exec` in an ephemeral read-only sandbox and reuses the saved
  ChatGPT login established by `codex login`.
- `claude_cli` invokes `claude -p` with tools disabled and reuses the saved login established by
  `claude auth login`.

For read-only stages these adapters receive only the persisted prompt and cannot edit the
repository. For file-touching purposes (`coding` and conflict-only `integration`), the worker
translates the same `codex_cli` / `claude_cli` profile into the corresponding Codex or Claude Code
worktree executor. API-key environment variables are deliberately omitted from both paths, so a
subscription assignment cannot silently turn into metered API usage. Subscription calls record
provider-reported tokens; `cost_usd` is zero when the subscription has no per-call API price to
attribute.

## 3. Model profiles & resolution

A **ModelProfile** binds `agent kind (or stage)` → `{provider, model, params, fallbacks[]}`. Resolution is a deterministic cascade, most specific wins:

```
project profile  >  organization default  >  platform default
```

The worker resolves each purpose the first time that run needs it and caches the result for the
rest of the run. Changing a project's profiles therefore affects new runs, not an agent already in
flight. Example project configuration:

```yaml
profiles:
  planning: { provider: claude_cli, model: sonnet, params: { reasoningEffort: medium } }
  coding: { provider: claude_cli, model: sonnet, params: { reasoningEffort: medium } }
  testing: { provider: codex_cli, model: default, params: { reasoningEffort: low } }
  review: { provider: codex_cli, model: default, params: { reasoningEffort: high } }
  classifier: { provider: claude_cli, model: haiku, params: { reasoningEffort: low } }
  embeddings: { provider: voyage, model: voyage-3-large }
```

(Models above are illustrative; the model catalog — context windows, pricing, capability flags — is data, updated without code changes.)

With no project or organization override, the worker's `REASONING_PROVIDER=auto` order is:

1. authenticated `codex_cli`;
2. authenticated `claude_cli`;
3. Anthropic when `ANTHROPIC_API_KEY` is set;
4. OpenAI when `OPENAI_API_KEY` is set.

Set `REASONING_PROVIDER` explicitly to pin the primary provider. A database model profile still
wins over this platform default, so a profile such as `{ provider: codex_cli, model: default }`
can pin one purpose independently. `CODEX_REASONING_MODEL` and `CLAUDE_REASONING_MODEL` optionally
override the corresponding CLI's default model.

The configurable purposes are `classifier`, `research`, `planning`, `decomposition`, `coding`,
`integration`, `review`, `testing`, `documentation`, and `distillation`. `model: default` leaves
model selection to the CLI. Otherwise the model is passed through verbatim. `reasoningEffort` is
`low`, `medium`, or `high`; Codex receives `model_reasoning_effort`, while Claude receives
`--effort`. Editing-purpose fallbacks deliberately continue in the same isolated worktree: the
assigned provider/model runs first, explicit `fallbacks[]` follow in order, and then the other
authenticated subscription CLI is appended automatically. Partial edits are preserved so the
next agent diagnoses and completes the existing work instead of restarting it. Each attempt has
its own `agent_run`, context artifact, transcript, cost entry, and live fallback activity. A
`budget_denied` result stops the chain rather than bypassing the frozen run budget.

## 4. Reliability policy

Per call, in order:

1. **Rate limit** — per-provider concurrency + token-rate caps; queued, not dropped.
2. **Retry** — transient errors (5xx, timeouts, rate-limit responses) retried with exponential backoff + jitter, bounded per profile (default 3).
3. **Fallback** — on retry exhaustion, advance down the profile's `fallbacks[]` chain; `fallback_index` is recorded on the ledger row so degraded runs are visible.
4. **Fail typed** — chain exhausted → `model_error` to the agent harness; the engine decides (retry stage later, fail stage, park run). The gateway never invents an answer.

Structured-output failures are handled _above_ fallback: schema-invalid output triggers one in-place repair attempt (validation errors appended), then counts as a failed attempt.

## 5. Cost metering & budgets

- Every ledger row carries `input_tokens`, `output_tokens`, `cost_usd` (priced from the model catalog at call time — historical prices stay historical).
- Budgets are hierarchical: per agent run (limit in `AgentExecutionInput`), per pipeline run, per project per month. The gateway checks _before_ dispatching; a would-exceed call returns `budget_denied` and emits `budget.exhausted`, which the engine turns into a paused run + human gate — a run never dies mid-flight for cost reasons without a human seeing it.
- The cost dashboard is SQL over the ledger: by project, by run, by stage, by provider, by model, over time. "What did this ticket cost, and where?" is one query.

## 6. Prompt management

- Prompt templates are versioned entities (`prompt_templates`: binding, version, body, changelog), editable in the UI; each agent definition references a template binding, resolved at run start and frozen like model profiles.
- Rendered prompts are not stored verbatim per call (bundles already are); the ledger stores a `prompt_hash` so identical-input calls are identifiable and template versions are provably linked to outcomes.
- Template changes are auditable events; A/B-ing a template = two versions + comparing run outcomes in the dashboard. No silent prompt drift.

## 7. Adding a provider

1. Implement the adapter SPI (one file: auth, request mapping, usage extraction, error mapping).
2. Add catalog entries (models, prices, capabilities).
3. Done — profiles can now reference it. No engine, agent, or UI changes.
