import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS, computeCostUsd, type ModelPricing } from './pricing.js';
import type { CallLedger } from './ledger.js';
import {
  GatewayError,
  RateLimitedError,
  type CallMeta,
  type ChatMessage,
  type CompleteRequest,
  type CompleteResult,
  type EmbedRequest,
  type EmbedResult,
  type EmbeddingAdapter,
  type ModelTarget,
  type ProviderAdapter,
  type ResolvedProfile,
  type ToolCall,
  type ToolDefinition,
  type ToolTurn,
} from './types.js';

const DEFAULT_MAX_TOKENS = 4096;
const RATE_LIMIT_RETRIES = 2;

export interface ModelGatewayOptions {
  pricing?: Record<string, ModelPricing>;
  /** Injected for tests; defaults to real sleep with exponential backoff. */
  sleep?: (ms: number) => Promise<void>;
  embeddingAdapters?: EmbeddingAdapter[];
}

/**
 * The single door to LLM providers (docs/07). Owns: profile → adapter routing,
 * retry/fallback semantics, budget enforcement, and the call ledger. Agents
 * and stage handlers never import provider SDKs (lint-enforced later).
 */
export class ModelGateway {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly embeddingAdapters = new Map<string, EmbeddingAdapter>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    adapters: ProviderAdapter[],
    private readonly ledger: CallLedger,
    private readonly options: ModelGatewayOptions = {},
  ) {
    for (const a of adapters) this.adapters.set(a.provider, a);
    for (const a of options.embeddingAdapters ?? []) this.embeddingAdapters.set(a.provider, a);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Embeddings go through the same door as completions: same profile
   * resolution, same budget guard, same ledger — so vector spend is attributed
   * like every other model call.
   */
  async embed(profile: ResolvedProfile, req: EmbedRequest): Promise<EmbedResult> {
    if (req.texts.length === 0) {
      return {
        vectors: [],
        provider: profile.primary.provider,
        model: profile.primary.model,
        inputTokens: 0,
        costUsd: 0,
      };
    }
    await this.enforceBudget({ ...req, messages: [], meta: req.meta } as CompleteRequest);

    const targets = [profile.primary, ...profile.fallbacks];
    let lastError: unknown;
    for (const target of targets) {
      const adapter = this.embeddingAdapters.get(target.provider);
      if (!adapter) {
        lastError = new GatewayError('no_adapter', `no embedding adapter for ${target.provider}`);
        continue;
      }
      const startedAt = Date.now();
      try {
        const { vectors, inputTokens } = await adapter.embed(
          target.model,
          req.texts,
          EMBEDDING_DIMENSIONS,
        );
        const costUsd = computeCostUsd(target.model, inputTokens, 0, this.options.pricing);
        await this.ledger.record({
          runId: req.meta.runId,
          agentRunId: req.meta.agentRunId,
          provider: target.provider,
          model: target.model,
          purpose: req.meta.purpose,
          promptHash: hashTexts(req.texts),
          inputTokens,
          outputTokens: 0,
          costUsd,
          latencyMs: Date.now() - startedAt,
          status: 'succeeded',
        });
        return { vectors, provider: target.provider, model: target.model, inputTokens, costUsd };
      } catch (err) {
        lastError = err;
        await this.ledger.record({
          runId: req.meta.runId,
          agentRunId: req.meta.agentRunId,
          provider: target.provider,
          model: target.model,
          purpose: req.meta.purpose,
          promptHash: hashTexts(req.texts),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: Date.now() - startedAt,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (lastError instanceof GatewayError) throw lastError;
    throw new GatewayError(
      'model_error',
      `embedding failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  /**
   * A bounded tool loop (docs/07 §2): the platform owns the loop, executes the
   * tools, and stops on its own limits — iterations, tool calls, and cost.
   * There is no fallback chain here: switching providers mid-conversation
   * would discard the tool transcript, so a failure is a typed failure.
   */
  async toolLoop(
    profile: ResolvedProfile,
    req: {
      system?: string;
      messages: ChatMessage[];
      tools: ToolDefinition[];
      executeTool: (call: ToolCall) => Promise<{ content: string; isError?: boolean }>;
      maxIterations: number;
      maxToolCalls: number;
      maxTokens?: number;
      meta: CallMeta;
    },
  ): Promise<{ text: string; turns: ToolTurn[]; toolCallCount: number; costUsd: number }> {
    const target = profile.primary;
    const adapter = this.adapters.get(target.provider);
    if (!adapter?.completeWithTools) {
      throw new GatewayError('no_adapter', `provider ${target.provider} does not support tool use`);
    }

    const turns: ToolTurn[] = [];
    let costUsd = 0;
    let toolCallCount = 0;
    let text = '';

    for (let iteration = 0; iteration < req.maxIterations; iteration++) {
      await this.enforceBudget({ messages: req.messages, meta: req.meta } as CompleteRequest);
      const startedAt = Date.now();
      const completion = await adapter.completeWithTools(target.model, {
        ...(req.system !== undefined ? { system: req.system } : {}),
        messages: req.messages,
        turns,
        tools: req.tools,
        maxTokens: req.maxTokens ?? target.params?.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
      const callCost = computeCostUsd(
        target.model,
        completion.inputTokens,
        completion.outputTokens,
        this.options.pricing,
      );
      costUsd += callCost;
      await this.ledger.record({
        runId: req.meta.runId,
        agentRunId: req.meta.agentRunId,
        provider: target.provider,
        model: target.model,
        purpose: req.meta.purpose,
        promptHash: hashPrompt({
          messages: req.messages,
          meta: req.meta,
          ...(req.system !== undefined ? { system: req.system } : {}),
        }),
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        costUsd: callCost,
        billing: adapter.billing ?? 'metered',
        latencyMs: Date.now() - startedAt,
        status: 'succeeded',
      });

      if (completion.text) text = completion.text;
      if (!completion.wantsTools || completion.toolCalls.length === 0) {
        return { text, turns, toolCallCount, costUsd };
      }

      turns.push({ role: 'assistant', text: completion.text, toolCalls: completion.toolCalls });
      const results: { id: string; content: string; isError?: boolean }[] = [];
      for (const call of completion.toolCalls) {
        if (toolCallCount >= req.maxToolCalls) {
          results.push({ id: call.id, content: 'tool call budget exhausted', isError: true });
          continue;
        }
        toolCallCount++;
        try {
          const result = await req.executeTool(call);
          results.push({ id: call.id, ...result });
        } catch (err) {
          results.push({
            id: call.id,
            content: err instanceof Error ? err.message : String(err),
            isError: true,
          });
        }
      }
      turns.push({ role: 'tool_results', results });
    }

    return { text, turns, toolCallCount, costUsd };
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
            ...(target.params?.reasoningEffort
              ? { reasoningEffort: target.params.reasoningEffort }
              : {}),
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
            billing: adapter.billing ?? 'metered',
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
            billing: adapter.billing ?? 'metered',
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

function hashTexts(texts: string[]): string {
  return createHash('sha256').update(JSON.stringify(texts)).digest('hex');
}
