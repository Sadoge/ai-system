import { describe, expect, it } from 'vitest';
import { CliAgentExecutor, ScriptedAgentExecutor } from '@ai-system/agent-execution';
import { resolveExecutor, resumableSessionFrom } from '../src/executors.js';

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
});

describe('resumableSessionFrom', () => {
  it.each(['timeout', 'cancelled'])('continues the latest %s Codex run', (failureReason) => {
    expect(
      resumableSessionFrom({
        executorKind: 'cli',
        status: 'failed',
        failureReason,
        sessionId: 'session-123',
      }),
    ).toBe('session-123');
  });

  it('never revives a stale session after a later successful run', () => {
    expect(
      resumableSessionFrom({
        executorKind: 'cli',
        status: 'succeeded',
        failureReason: null,
        sessionId: 'session-123',
      }),
    ).toBeUndefined();
  });
});
