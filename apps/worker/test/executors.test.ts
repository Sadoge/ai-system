import { describe, expect, it } from 'vitest';
import { CliAgentExecutor, ScriptedAgentExecutor } from '@ai-system/agent-execution';
import {
  resolveExecutor,
  resolveExecutorCandidates,
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
