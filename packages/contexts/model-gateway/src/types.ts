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
  params?: { maxTokens?: number; temperature?: number };
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

export interface ProviderAdapter {
  readonly provider: string;
  complete(
    model: string,
    req: { system?: string; messages: ChatMessage[]; maxTokens: number; temperature?: number },
  ): Promise<AdapterCompletion>;
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
