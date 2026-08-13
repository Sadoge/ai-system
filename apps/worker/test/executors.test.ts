import { describe, expect, it } from 'vitest';
import { CliAgentExecutor, ScriptedAgentExecutor } from '@ai-system/agent-execution';
import {
  resolveExecutor,
  resolveExecutorCandidates,
  recordExecutorUsage,
  resumableSessionFrom,
  withAutomaticExecutorFallbacks,
} from '../src/executors.js';

const deps = {
  mock: false,
  apiLoop: () => new ScriptedAgentExecutor(),
};

describe('stage executor assignments', () => {
  it('maps a Codex subscription profile to the worktree-editing Codex CLI', () => {
    const executor = resolveExecutor(null, deps, {
      purpose: 'coding',
      primary: {
        provider: 'codex_cli',
        model: 'default',
        params: { reasoningEffort: 'low' },
      },
      fallbacks: [],
    });

    expect(executor).toBeInstanceOf(CliAgentExecutor);
    expect((executor as CliAgentExecutor).cliName).toBe('codex');
  });

  it('maps a Claude subscription profile to the worktree-editing Claude CLI', () => {
    const executor = resolveExecutor(null, deps, {
      purpose: 'integration',
      primary: { provider: 'claude_cli', model: 'sonnet' },
      fallbacks: [],
    });

    expect(executor).toBeInstanceOf(CliAgentExecutor);
    expect((executor as CliAgentExecutor).cliName).toBe('claude_code');
  });

  it('rejects completion-only providers for file-touching stages', () => {
    expect(() =>
      resolveExecutor(null, deps, {
        purpose: 'coding',
        primary: { provider: 'anthropic', model: 'claude-sonnet' },
        fallbacks: [],
      }),
    ).toThrow(/cannot edit a worktree/i);
  });

  it('maps every configured provider/model fallback into an ordered executor', () => {
    const candidates = resolveExecutorCandidates(null, deps, {
      purpose: 'coding',
      primary: { provider: 'codex_cli', model: 'large' },
      fallbacks: [
        { provider: 'codex_cli', model: 'small' },
        { provider: 'claude_cli', model: 'default' },
      ],
    });

    expect(candidates.map((candidate) => candidate.target.model)).toEqual([
      'large',
      'small',
      'default',
    ]);
    expect(candidates.map((candidate) => (candidate.executor as CliAgentExecutor).cliName)).toEqual(
      ['codex', 'codex', 'claude_code'],
    );
  });
});

describe('automatic executor fallbacks', () => {
  it('keeps configured model fallbacks before switching to another agent', () => {
    const profile = withAutomaticExecutorFallbacks(
      {
        purpose: 'coding',
        primary: { provider: 'codex_cli', model: 'large' },
        fallbacks: [{ provider: 'codex_cli', model: 'small' }],
      },
      [
        { provider: 'codex_cli', model: 'default' },
        { provider: 'claude_cli', model: 'default' },
      ],
      3,
    );

    expect([profile.primary, ...profile.fallbacks]).toEqual([
      { provider: 'codex_cli', model: 'large' },
      { provider: 'codex_cli', model: 'small' },
      { provider: 'claude_cli', model: 'default' },
    ]);
  });

  it('switches agents automatically and deduplicates the primary target', () => {
    const profile = withAutomaticExecutorFallbacks(
      {
        purpose: 'coding',
        primary: { provider: 'claude_cli', model: 'default' },
        fallbacks: [],
      },
      [
        { provider: 'codex_cli', model: 'default' },
        { provider: 'claude_cli', model: 'default' },
      ],
      3,
    );

    expect([profile.primary, ...profile.fallbacks]).toEqual([
      { provider: 'claude_cli', model: 'default' },
      { provider: 'codex_cli', model: 'default' },
    ]);
  });
});

describe('resumableSessionFrom', () => {
  it.each(['timeout', 'cancelled'])('continues the latest %s Codex run', (failureReason) => {
    expect(
      resumableSessionFrom({
        executorKind: 'cli:codex',
        status: 'failed',
        failureReason,
        sessionId: 'session-123',
      }),
    ).toBe('session-123');
  });

  it('never revives a stale session after a later successful run', () => {
    expect(
      resumableSessionFrom({
        executorKind: 'cli:codex',
        status: 'succeeded',
        failureReason: null,
        sessionId: 'session-123',
      }),
    ).toBeUndefined();
  });

  it.each(['cli', 'cli:claude_code'])(
    'does not pass a %s conversation to the Codex resume command',
    (executorKind) => {
      expect(
        resumableSessionFrom({
          executorKind,
          status: 'failed',
          failureReason: 'timeout',
          sessionId: 'foreign-session',
        }),
      ).toBeUndefined();
    },
  );
});

/** A drizzle insert/update chain that captures what was written. */
function captureDb() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
    update: () => ({
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          updated.push(row);
        },
      }),
    }),
  } as unknown as Parameters<typeof recordExecutorUsage>[0];
  return { db, inserted, updated };
}

const usageInput = {
  runId: '01936b00-0000-7000-8000-000000000001',
  agentRunId: '01936b00-0000-7000-8000-0000000000a1',
  executorKind: 'cli',
  status: 'succeeded' as const,
  latencyMs: 1234,
};

describe('recordExecutorUsage', () => {
  it('records a subscription CLI that reports tokens but no cost', async () => {
    // Codex on a ChatGPT subscription emits input/output tokens and no
    // total_cost_usd, because nothing was charged. Requiring a dollar figure
    // discarded the entire row and made the coding stage invisible.
    const { db, inserted } = captureDb();

    await recordExecutorUsage(db, {
      ...usageInput,
      cliName: 'codex',
      usage: { inputTokens: 120_000, outputTokens: 4_000 },
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      provider: 'cli:codex',
      inputTokens: 120_000,
      outputTokens: 4_000,
      costUsd: '0.000000',
      billing: 'subscription',
    });
  });

  it('marks a self-reported dollar figure as subscription, not spend', async () => {
    // Claude Code reports total_cost_usd, but no preset forwards an API key
    // into the sandbox, so that number is API-equivalent pricing rather than
    // a charge. Recorded, but never as metered spend.
    const { db, inserted, updated } = captureDb();

    await recordExecutorUsage(db, {
      ...usageInput,
      cliName: 'claude_code',
      usage: { inputTokens: 900, outputTokens: 100, costUsd: 0.42 },
    });

    expect(inserted[0]).toMatchObject({ costUsd: '0.420000', billing: 'subscription' });
    expect(updated).toHaveLength(1);
  });

  it('skips only when the CLI reported nothing at all', async () => {
    const { db, inserted } = captureDb();

    await recordExecutorUsage(db, { ...usageInput, usage: undefined });
    await recordExecutorUsage(db, { ...usageInput, usage: {} });

    expect(inserted).toHaveLength(0);
  });
});
