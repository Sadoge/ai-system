import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  InMemoryCallLedger,
  ModelGateway,
  type AdapterCompletion,
  type ProviderAdapter,
  type ResolvedProfile,
} from '@ai-system/model-gateway';
import { InvalidAgentOutputError, runJsonAgent } from '../src/runner.js';

class ScriptedAdapter implements ProviderAdapter {
  readonly provider = 'fake';
  readonly prompts: string[] = [];
  private call = 0;
  constructor(private readonly responses: string[]) {}

  async complete(
    _model: string,
    req: { messages: { content: string }[] },
  ): Promise<AdapterCompletion> {
    this.prompts.push(req.messages[0]!.content);
    const text = this.responses[Math.min(this.call++, this.responses.length - 1)]!;
    return { text, inputTokens: 1, outputTokens: 1 };
  }
}

const profile: ResolvedProfile = {
  purpose: 'test',
  primary: { provider: 'fake', model: 'm' },
  fallbacks: [],
};
const schema = z.object({ answer: z.number() });
const meta = { purpose: 'test' };

function gatewayWith(adapter: ScriptedAdapter) {
  return new ModelGateway([adapter], new InMemoryCallLedger(), { sleep: async () => {} });
}

describe('runJsonAgent', () => {
  it('parses valid JSON, tolerating markdown fences', async () => {
    const adapter = new ScriptedAdapter(['```json\n{"answer": 42}\n```']);
    const result = await runJsonAgent(gatewayWith(adapter), profile, {
      system: 's',
      user: 'u',
      schema,
      meta,
    });
    expect(result).toEqual({ answer: 42 });
  });

  it('retries with validation errors appended, then succeeds', async () => {
    const adapter = new ScriptedAdapter(['{"answer": "not a number"}', '{"answer": 7}']);
    const result = await runJsonAgent(gatewayWith(adapter), profile, {
      system: 's',
      user: 'u',
      schema,
      meta,
    });
    expect(result).toEqual({ answer: 7 });
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[1]).toContain('previous response was invalid');
  });

  it('fails typed after max retries', async () => {
    const adapter = new ScriptedAdapter(['garbage']);
    await expect(
      runJsonAgent(gatewayWith(adapter), profile, { system: 's', user: 'u', schema, meta }),
    ).rejects.toBeInstanceOf(InvalidAgentOutputError);
    expect(adapter.prompts).toHaveLength(3); // 1 + 2 retries
  });
});
