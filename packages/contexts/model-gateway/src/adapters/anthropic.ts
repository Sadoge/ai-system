import Anthropic from '@anthropic-ai/sdk';
import {
  RateLimitedError,
  type AdapterCompletion,
  type AdapterToolCompletion,
  type ChatMessage,
  type ProviderAdapter,
  type ToolDefinition,
  type ToolTurn,
} from '../types.js';

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
    const messages: Anthropic.MessageParam[] = [
      ...req.messages.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    ];
    for (const turn of req.turns) {
      if (turn.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (turn.text) content.push({ type: 'text', text: turn.text });
        for (const call of turn.toolCalls) {
          content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
        }
        messages.push({ role: 'assistant', content });
      } else {
        messages.push({
          role: 'user',
          content: turn.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          })),
        });
      }
    }

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens,
        ...(req.system !== undefined ? { system: req.system } : {}),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
        messages,
      });
      return {
        text: response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
        toolCalls: response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            name: b.name,
            arguments: (b.input ?? {}) as Record<string, unknown>,
          })),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        wantsTools: response.stop_reason === 'tool_use',
      };
    } catch (err) {
      if (err instanceof Anthropic.APIError && err.status === 429) {
        throw new RateLimitedError(err.message);
      }
      throw err;
    }
  }
}
