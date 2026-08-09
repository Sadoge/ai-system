/**
 * USD per million tokens. These are illustrative defaults — the model catalog
 * (Phase 3) makes pricing data-driven. Unknown models meter at 0 and are
 * flagged in the ledger via costUsd = 0, never guessed.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'text-embedding-3-small': { inputPerMTok: 0.02, outputPerMTok: 0 },
  'text-embedding-3-large': { inputPerMTok: 0.13, outputPerMTok: 0 },
  'local-hash': { inputPerMTok: 0, outputPerMTok: 0 },
};

/** Every embedding in the platform is this wide (docs/04: vector(1024)). */
export const EMBEDDING_DIMENSIONS = 1024;

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<string, ModelPricing> = DEFAULT_PRICING,
): number {
  const p = pricing[model];
  if (!p) return 0;
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
}
