import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { RateLimitedError, type EmbeddingAdapter } from '../types.js';

export class OpenAiEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async embed(
    model: string,
    texts: string[],
    dimensions: number,
  ): Promise<{ vectors: number[][]; inputTokens: number }> {
    try {
      const response = await this.client.embeddings.create({ model, input: texts, dimensions });
      return {
        vectors: response.data.map((d) => d.embedding),
        inputTokens: response.usage?.prompt_tokens ?? 0,
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError && err.status === 429) {
        throw new RateLimitedError(err.message);
      }
      throw err;
    }
  }
}

/**
 * Deterministic local embedder: hashed bag-of-words projected onto the unit
 * sphere. It is not semantic — it captures lexical overlap only — but it makes
 * the whole retrieval path runnable and reproducible without an API key
 * (MOCK_MODELS=true), and it costs nothing.
 */
export class LocalHashEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = 'local';

  async embed(
    _model: string,
    texts: string[],
    dimensions: number,
  ): Promise<{ vectors: number[][]; inputTokens: number }> {
    return {
      vectors: texts.map((text) => embedText(text, dimensions)),
      inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
    };
  }
}

export function embedText(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 2);
  for (const token of tokens) {
    const digest = createHash('sha1').update(token).digest();
    // Two hashed positions per token, signed, so unrelated tokens rarely cancel.
    for (let k = 0; k < 2; k++) {
      const slot = digest.readUInt32BE(k * 4) % dimensions;
      const sign = (digest[8 + k]! & 1) === 0 ? 1 : -1;
      vector[slot] = vector[slot]! + sign;
    }
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}
