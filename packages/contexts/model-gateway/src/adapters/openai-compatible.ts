import OpenAI from 'openai';
import { RateLimitedError, type AdapterCompletion, type ChatMessage, type ProviderAdapter } from '../types.js';

/**
 * Anything speaking the OpenAI chat-completions protocol: vLLM, Ollama,
 * LM Studio, Together, OpenRouter, a self-hosted gateway. One adapter covers
 * the whole category, which is why "add a provider" is usually a config change
 * rather than code.
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly provider: string;
  private readonly client: OpenAI;

  constructor(options: { provider?: string; baseUrl?: string; apiKey?: string } = {}) {
    this.provider = options.provider ?? 'openai_compatible';
    this.client = new OpenAI({
      baseURL: options.baseUrl ?? process.env.OPENAI_COMPATIBLE_BASE_URL,
      // Local servers usually ignore the key but the SDK insists on one.
      apiKey: options.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? 'not-needed',
    });
  }

  async complete(
    model: string,
    req: { system?: string; messages: ChatMessage[]; maxTokens: number; temperature?: number },
  ): Promise<AdapterCompletion> {
    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: req.maxTokens,
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
