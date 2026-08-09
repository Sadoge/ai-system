import { describe, expect, it } from 'vitest';
import { InMemoryCallLedger } from '../src/ledger.js';
import { ModelGateway } from '../src/gateway.js';
import {
  GatewayError,
  RateLimitedError,
  type AdapterCompletion,
  type ChatMessage,
  type CompleteRequest,
  type ProviderAdapter,
  type ResolvedProfile,
} from '../src/types.js';

const RUN_ID = '01936b00-0000-7000-8000-00000000000a';

class ScriptedAdapter implements ProviderAdapter {
  readonly calls: string[] = [];
  constructor(
    readonly provider: string,
    private readonly script: (model: string, call: number) => AdapterCompletion,
  ) {}

  async complete(model: string): Promise<AdapterCompletion> {
    this.calls.push(model);
    return this.script(model, this.calls.length);
  }
}

function req(meta: Partial<CompleteRequest['meta']> = {}): CompleteRequest {
  const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];
  return { messages, meta: { purpose: 'test', ...meta } };
}

function profile(fallbacks: ResolvedProfile['fallbacks'] = []): ResolvedProfile {
  return {
    purpose: 'test',
    primary: { provider: 'fake', model: 'claude-sonnet-4-5' },
    fallbacks,
  };
}

const noSleep = { sleep: async () => {} };

describe('ModelGateway', () => {
  it('completes via the primary target and records a ledger entry with cost', async () => {
    const adapter = new ScriptedAdapter('fake', () => ({
      text: 'hi',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }));
    const ledger = new InMemoryCallLedger();
    const gateway = new ModelGateway([adapter], ledger, noSleep);

    const result = await gateway.complete(profile(), req({ runId: RUN_ID }));

    expect(result.text).toBe('hi');
    expect(result.costUsd).toBeCloseTo(18); // 3 + 15 per MTok
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      status: 'succeeded',
      provider: 'fake',
      model: 'claude-sonnet-4-5',
      runId: RUN_ID,
    });
    expect(ledger.entries[0]!.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('retries rate limits, then falls back to the next target', async () => {
    let rateLimitedCalls = 0;
    const flaky = new ScriptedAdapter('fake', () => {
      rateLimitedCalls++;
      throw new RateLimitedError('429');
    });
    const backup = new ScriptedAdapter('backup', () => ({
      text: 'from backup',
      inputTokens: 10,
      outputTokens: 10,
    }));
    const ledger = new InMemoryCallLedger();
    const gateway = new ModelGateway([flaky, backup], ledger, noSleep);

    const result = await gateway.complete(
      profile([{ provider: 'backup', model: 'gpt-4o' }]),
      req(),
    );

    expect(rateLimitedCalls).toBe(3); // 1 + 2 retries
    expect(result.provider).toBe('backup');
    expect(ledger.entries.filter((e) => e.status === 'failed')).toHaveLength(3);
    expect(ledger.entries.at(-1)).toMatchObject({ status: 'succeeded', provider: 'backup' });
  });

  it('throws a typed model_error when every target fails', async () => {
    const broken = new ScriptedAdapter('fake', () => {
      throw new Error('boom');
    });
    const gateway = new ModelGateway([broken], new InMemoryCallLedger(), noSleep);

    await expect(gateway.complete(profile(), req())).rejects.toMatchObject({
      reason: 'model_error',
    });
  });

  it('denies the call before spending when the run budget is exhausted', async () => {
    const adapter = new ScriptedAdapter('fake', () => ({ text: 'x', inputTokens: 1, outputTokens: 1 }));
    const ledger = new InMemoryCallLedger();
    await ledger.record({
      runId: RUN_ID,
      provider: 'fake',
      model: 'claude-sonnet-4-5',
      purpose: 'earlier',
      promptHash: 'h',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 5,
      latencyMs: 1,
      status: 'succeeded',
    });
    const gateway = new ModelGateway([adapter], ledger, noSleep);

    await expect(
      gateway.complete(profile(), req({ runId: RUN_ID, budgetUsd: 5 })),
    ).rejects.toMatchObject({ reason: 'budget_denied' });
    expect(adapter.calls).toHaveLength(0); // denied before any provider call
  });

  it('reports no_adapter when the provider is not registered', async () => {
    const gateway = new ModelGateway([], new InMemoryCallLedger(), noSleep);
    await expect(gateway.complete(profile(), req())).rejects.toBeInstanceOf(GatewayError);
    await expect(gateway.complete(profile(), req())).rejects.toMatchObject({ reason: 'no_adapter' });
  });
});
