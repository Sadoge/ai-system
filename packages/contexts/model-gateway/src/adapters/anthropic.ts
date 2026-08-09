import Anthropic from '@anthropic-ai/sdk';
import { RateLimitedError, type AdapterCompletion, type ChatMessage, type ProviderAdapter } from '../types.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async complete(
    model: string,
    req: { system?: string; messages: ChatMessage[]; maxTokens: number; temperature?: number },
  ): Promise<AdapterCompletion> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens,
        ...(req.system !== undefined ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 429) {
        throw new RateLimitedError(err.message);
      }
      throw err;
    }
  }
}
