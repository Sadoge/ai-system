import OpenAI from 'openai';
import {
  RateLimitedError,
  type AdapterCompletion,
  type AdapterToolCompletion,
  type ChatMessage,
  type ProviderAdapter,
  type ToolDefinition,
  type ToolTurn,
} from '../types.js';

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

  async completeWithTools(
    model: string,
    req: {
      system?: string;
      messages: ChatMessage[];
      turns: ToolTurn[];
      tools: ToolDefinition[];
      maxTokens: number;
    },
  ): Promise<AdapterToolCompletion> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(req.system !== undefined ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    for (const turn of req.turns) {
      if (turn.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: turn.text || null,
          ...(turn.toolCalls.length > 0
            ? {
                tool_calls: turn.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
              }
            : {}),
        });
      } else {
        for (const result of turn.results) {
          messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
        }
      }
    }

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_completion_tokens: req.maxTokens,
        tools: req.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        messages,
      });
      const choice = response.choices[0];
      const calls = choice?.message?.tool_calls ?? [];
      return {
        text: choice?.message?.content ?? '',
        toolCalls: calls
          .filter((c): c is typeof c & { function: { name: string; arguments: string } } => 'function' in c)
          .map((c) => ({
            id: c.id,
            name: c.function.name,
            arguments: safeParseArgs(c.function.arguments),
          })),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        wantsTools: choice?.finish_reason === 'tool_calls',
      };
    } catch (err) {
      if (err instanceof OpenAI.APIError && err.status === 429) {
        throw new RateLimitedError(err.message);
      }
      throw err;
    }
  }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
