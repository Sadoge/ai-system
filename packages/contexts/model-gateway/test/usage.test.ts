import { describe, expect, it } from 'vitest';
import { USAGE_WINDOWS, summarizeUsage, type UsageRow } from '../src/usage.js';

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    provider: 'anthropic',
    billing: 'metered',
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ...over,
  };
}

describe('summarizeUsage', () => {
  it('never adds a subscription estimate to money actually spent', () => {
    // The whole point: a CLI's self-reported cost is API-equivalent pricing,
    // not a charge. Summing the two would invent spend that never happened.
    const usage = summarizeUsage([
      row({ provider: 'anthropic', billing: 'metered', costUsd: 1.25 }),
      row({ provider: 'cli:claude_code', billing: 'subscription', costUsd: 9.99 }),
    ]);

    expect(usage.metered.meteredUsd).toBe(1.25);
    expect(usage.subscription.notionalUsd).toBe(9.99);
    expect(usage.meteredUsd).toBe(1.25);
    expect(usage.notionalUsd).toBe(9.99);
  });

  it('totals tokens across both billing modes', () => {
    const usage = summarizeUsage([
      row({ billing: 'metered', inputTokens: 1_000, outputTokens: 100 }),
      row({ billing: 'subscription', inputTokens: 500_000, outputTokens: 20_000 }),
    ]);

    expect(usage.inputTokens).toBe(501_000);
    expect(usage.outputTokens).toBe(20_100);
    expect(usage.calls).toBe(2);
    expect(usage.subscription.inputTokens).toBe(500_000);
    expect(usage.metered.inputTokens).toBe(1_000);
  });

  it('reports a subscription-only workload as real usage at zero spend', () => {
    const usage = summarizeUsage([
      row({ provider: 'cli:codex', billing: 'subscription', inputTokens: 2_000_000, calls: 40 }),
    ]);

    expect(usage.meteredUsd).toBe(0);
    expect(usage.metered.calls).toBe(0);
    expect(usage.subscription.calls).toBe(40);
    expect(usage.inputTokens).toBe(2_000_000);
  });

  it('returns zeroes for an empty ledger', () => {
    const usage = summarizeUsage([]);

    expect(usage).toMatchObject({ calls: 0, inputTokens: 0, meteredUsd: 0, notionalUsd: 0 });
    expect(usage.metered.calls).toBe(0);
    expect(usage.subscription.calls).toBe(0);
  });
});

describe('USAGE_WINDOWS', () => {
  it('covers the rolling windows subscription plans are enforced over', () => {
    expect(USAGE_WINDOWS.map((w) => w.label)).toEqual(['5h', '24h', '7d']);
    // Ascending, so the report reads shortest-burst to longest-trend.
    const spans = USAGE_WINDOWS.map((w) => w.ms);
    expect([...spans].sort((a, b) => a - b)).toEqual([...spans]);
  });
});
