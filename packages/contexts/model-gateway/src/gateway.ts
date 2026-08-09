import { createHash } from 'node:crypto';
import { computeCostUsd, type ModelPricing } from './pricing.js';
import type { CallLedger } from './ledger.js';
import {
  GatewayError,
  RateLimitedError,
  type CompleteRequest,
  type CompleteResult,
  type ModelTarget,
  type ProviderAdapter,
  type ResolvedProfile,
} from './types.js';

const DEFAULT_MAX_TOKENS = 4096;
const RATE_LIMIT_RETRIES = 2;

export interface ModelGatewayOptions {
  pricing?: Record<string, ModelPricing>;
  /** Injected for tests; defaults to real sleep with exponential backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The single door to LLM providers (docs/07). Owns: profile → adapter routing,
 * retry/fallback semantics, budget enforcement, and the call ledger. Agents
 * and stage handlers never import provider SDKs (lint-enforced later).
 */
export class ModelGateway {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    adapters: ProviderAdapter[],
    private readonly ledger: CallLedger,
    private readonly options: ModelGatewayOptions = {},
  ) {
    for (const a of adapters) this.adapters.set(a.provider, a);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(profile: ResolvedProfile, req: CompleteRequest): Promise<CompleteResult> {
    await this.enforceBudget(req);

    const targets = [profile.primary, ...profile.fallbacks];
    const promptHash = hashPrompt(req);
    let lastError: unknown;

    for (const target of targets) {
      const adapter = this.adapters.get(target.provider);
      if (!adapter) {
        lastError = new GatewayError('no_adapter', `no adapter for provider ${target.provider}`);
        continue;
      }
      for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
        const startedAt = Date.now();
        try {
          const temperature = resolveTemperature(req, target);
          const completion = await adapter.complete(target.model, {
            ...(req.system !== undefined ? { system: req.system } : {}),
            messages: req.messages,
            maxTokens: req.maxTokens ?? target.params?.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(temperature !== undefined ? { temperature } : {}),
          });
          const costUsd = computeCostUsd(
            target.model,
            completion.inputTokens,
            completion.outputTokens,
            this.options.pricing,
          );
          const result: CompleteResult = {
            text: completion.text,
            provider: target.provider,
            model: target.model,
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
            costUsd,
            latencyMs: Date.now() - startedAt,
          };
          await this.ledger.record({
            runId: req.meta.runId,
            agentRunId: req.meta.agentRunId,
            provider: target.provider,
            model: target.model,
            purpose: req.meta.purpose,
            promptHash,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costUsd,
            latencyMs: result.latencyMs,
            status: 'succeeded',
          });
          return result;
        } catch (err) {
          lastError = err;
          await this.ledger.record({
            runId: req.meta.runId,
            agentRunId: req.meta.agentRunId,
            provider: target.provider,
            model: target.model,
            purpose: req.meta.purpose,
            promptHash,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: Date.now() - startedAt,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          if (err instanceof RateLimitedError && attempt < RATE_LIMIT_RETRIES) {
            await this.sleep(2 ** attempt * 1000);
            continue;
          }
          break; // non-retryable, or retries exhausted → next fallback target
        }
      }
    }

    if (lastError instanceof GatewayError) throw lastError;
    throw new GatewayError(
      lastError instanceof RateLimitedError ? 'rate_limited' : 'model_error',
      `all model targets failed for purpose ${req.meta.purpose}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private async enforceBudget(req: CompleteRequest): Promise<void> {
    const { runId, budgetUsd } = req.meta;
    if (!runId || budgetUsd === null || budgetUsd === undefined) return;
    const spent = await this.ledger.spentUsd(runId);
    if (spent >= budgetUsd) {
      throw new GatewayError(
        'budget_denied',
        `run ${runId} spent $${spent.toFixed(4)} of $${budgetUsd.toFixed(4)} budget`,
      );
    }
  }
}

function resolveTemperature(req: CompleteRequest, target: ModelTarget): number | undefined {
  return req.temperature ?? target.params?.temperature;
}

export function hashPrompt(req: CompleteRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ system: req.system ?? null, messages: req.messages }))
    .digest('hex');
}
