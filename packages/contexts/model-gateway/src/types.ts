import { z } from 'zod';

export const ChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Mandatory attribution: no anonymous model calls (docs/07 §2). */
export interface CallMeta {
  purpose: string;
  runId?: string;
  agentRunId?: string;
  /** Budget ceiling for the owning run, from its frozen policy snapshot. null = unlimited. */
  budgetUsd?: number | null;
}

export interface CompleteRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  meta: CallMeta;
}

export interface CompleteResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface ModelTarget {
  provider: string;
  model: string;
  params?: {
    maxTokens?: number;
    temperature?: number;
    /** Provider-neutral reasoning budget. CLI adapters translate this to native flags. */
    reasoningEffort?: 'low' | 'medium' | 'high';
  };
}

export interface ResolvedProfile {
  purpose: string;
  primary: ModelTarget;
  fallbacks: ModelTarget[];
}

/** What an adapter returns; the gateway adds cost + ledger concerns. */
export interface AdapterCompletion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** One turn of a tool loop: assistant text and/or tool calls, then results. */
export type ToolTurn =
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool_results'; results: { id: string; content: string; isError?: boolean }[] };

export interface AdapterToolCompletion {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  /** True when the model stopped because it wants tool results. */
  wantsTools: boolean;
}

export interface ProviderAdapter {
  readonly provider: string;
  complete(
    model: string,
    req: {
      system?: string;
      messages: ChatMessage[];
      maxTokens: number;
      temperature?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
    },
  ): Promise<AdapterCompletion>;
  /** Optional: providers without tool support simply omit this. */
  completeWithTools?(
    model: string,
    req: {
      system?: string;
      messages: ChatMessage[];
      turns: ToolTurn[];
      tools: ToolDefinition[];
      maxTokens: number;
    },
  ): Promise<AdapterToolCompletion>;
}

/** Embeddings are a separate SPI: the providers that serve them differ. */
export interface EmbeddingAdapter {
  readonly provider: string;
  embed(
    model: string,
    texts: string[],
    dimensions: number,
  ): Promise<{ vectors: number[][]; inputTokens: number }>;
}

export interface EmbedRequest {
  texts: string[];
  meta: CallMeta;
}

export interface EmbedResult {
  vectors: number[][];
  provider: string;
  model: string;
  inputTokens: number;
  costUsd: number;
}

export type GatewayFailureReason = 'budget_denied' | 'rate_limited' | 'model_error' | 'no_adapter';

export class GatewayError extends Error {
  constructor(
    public readonly reason: GatewayFailureReason,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown by provider adapters to mark retryable rate limiting. */
export class RateLimitedError extends Error {}
