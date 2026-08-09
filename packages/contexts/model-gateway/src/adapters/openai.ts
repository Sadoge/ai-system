import OpenAI from 'openai';
import { RateLimitedError, type AdapterCompletion, type ChatMessage, type ProviderAdapter } from '../types.js';

export class OpenAiAdapter implements ProviderAdapter {
  readonly provider = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
  }

  async complete(
    model: string,
    req: { system?: string; messages: ChatMessage[]; maxTokens: number; temperature?: number },
  ): Promise<AdapterCompletion> {
    try {
      const response = await this.client.chat.completions.create({
        model,
        max_completion_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [
          ...(req.system !== undefined ? [{ role: 'system' as const, content: req.system }] : []),
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      const choice = response.choices[0];
      return {
        text: choice?.message?.content ?? '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError && err.status === 429) {
        throw new RateLimitedError(err.message);
      }
      throw err;
    }
  }
}
