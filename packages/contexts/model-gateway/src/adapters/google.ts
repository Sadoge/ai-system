import { RateLimitedError, type AdapterCompletion, type ChatMessage, type ProviderAdapter } from '../types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Google Gemini via the REST API. Deliberately fetch-based rather than another
 * SDK dependency: the surface we use is one endpoint, and keeping it thin
 * makes the adapter easy to audit.
 */
export class GoogleAdapter implements ProviderAdapter {
  readonly provider = 'google';

  constructor(
    private readonly apiKey = process.env.GOOGLE_API_KEY,
    private readonly baseUrl = process.env.GOOGLE_BASE_URL ?? DEFAULT_BASE_URL,
  ) {}

  async complete(
    model: string,
    req: { system?: string; messages: ChatMessage[]; maxTokens: number; temperature?: number },
  ): Promise<AdapterCompletion> {
    if (!this.apiKey) throw new Error('GOOGLE_API_KEY is not set');
    const response = await fetch(
      `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
          contents: req.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          },
        }),
      },
    );
    if (response.status === 429) throw new RateLimitedError(await response.text());
    if (!response.ok) throw new Error(`Google API error ${response.status}: ${await response.text()}`);

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    return {
      text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
