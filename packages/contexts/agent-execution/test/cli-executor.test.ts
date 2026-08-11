import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliAgentExecutor } from '../src/cli-executor.js';
import { CLAUDE_CODE_PRESET, CODEX_PRESET } from '../src/cli-presets.js';
import type { CodingTaskSpec } from '../src/types.js';

const spec: CodingTaskSpec = {
  ticketTitle: 'Add a greeting',
  planSummary: 'create greeting.txt',
  steps: [{ title: 'write it', detail: 'create the file', files: ['greeting.txt'] }],
  findings: [],
  rules: [],
};

/** A stand-in binary: writes a file, then emits Claude Code's JSON contract. */
function fakeCli(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fakecli-'));
  const path = join(dir, 'fake-cli');
  writeFileSync(path, `#!/bin/bash\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

describe('CliAgentExecutor', () => {
  it('passes the prompt on stdin and parses cost and usage from JSON output', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-'));
    const binary = fakeCli(`
prompt=$(cat)
echo "$prompt" > prompt-received.txt
echo "hello" > greeting.txt
cat <<'EOF'
{"result":"created greeting.txt","is_error":false,"total_cost_usd":0.0421,
 "usage":{"input_tokens":120,"output_tokens":45},
 "modelUsage":{"claude-haiku-4-5":{"costUSD":0.001},"claude-sonnet-5":{"costUSD":0.0411}}}
EOF`);

    const result = await new CliAgentExecutor({ preset: 'claude_code', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
    });

    expect(result.status).toBe('succeeded');
    expect(result.usage).toEqual({
      costUsd: 0.0421,
      inputTokens: 120,
      outputTokens: 45,
      // The priciest model of the session is the headline model.
      model: 'claude-sonnet-5',
    });
    expect(readFileSync(join(worktree, 'greeting.txt'), 'utf8')).toBe('hello\n');
    // The full rendered prompt reached the CLI over stdin.
    expect(readFileSync(join(worktree, 'prompt-received.txt'), 'utf8')).toContain('Add a greeting');
    // ...and is persisted next to the work for a human to inspect.
    expect(readFileSync(join(worktree, '.ai-system-prompt.md'), 'utf8')).toContain(
      'create greeting.txt',
    );
  });

  it('treats an agent-reported error as a model failure, not a sandbox failure', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-err-'));
    const binary = fakeCli(`cat > /dev/null
echo '{"result":"I could not complete this","is_error":true,"total_cost_usd":0.01}'`);

    const result = await new CliAgentExecutor({ preset: 'claude_code', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
    });

    expect(result).toMatchObject({ status: 'failed', failureReason: 'model_error' });
    expect(result.usage?.costUsd).toBe(0.01);
  });

  it('reports a non-zero exit as a sandbox failure', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-exit-'));
    const binary = fakeCli(`cat > /dev/null\necho "boom" >&2\nexit 3`);

    const result = await new CliAgentExecutor({ preset: 'claude_code', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
    });
    expect(result).toMatchObject({ status: 'failed', failureReason: 'sandbox_error' });
    expect(result.transcript).toContain('exit code 3');
  });

  it('captures a Codex session and classifies an interrupted turn as cancelled', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-interrupted-'));
    const binary = fakeCli(`cat > /dev/null
echo '{"type":"thread.started","thread_id":"session-123"}'
echo 'Turn interrupted' >&2
exit 1`);

    const result = await new CliAgentExecutor({ preset: 'codex', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failureReason: 'cancelled',
      sessionId: 'session-123',
    });
  });

  it('kills an active CLI process when the parent run is stopped', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-stopped-'));
    const binary = fakeCli(`cat > /dev/null\nsleep 10`);
    const controller = new AbortController();

    const execution = new CliAgentExecutor({ preset: 'claude_code', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 20_000 },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    await expect(execution).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'cancelled',
    });
  });

  it('streams CLI warnings while a successful Codex run is still active', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-warning-'));
    const binary = fakeCli(`cat > /dev/null
echo 'ERROR codex_models_manager::cache: missing field base_instructions' >&2
echo '{"type":"thread.started","thread_id":"session-warning"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"Implemented."}}'
echo '{"type":"turn.completed"}'`);
    const activity: string[] = [];

    const result = await new CliAgentExecutor({ preset: 'codex', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
      onActivity: async (event) => {
        activity.push(event.message);
      },
    });

    expect(result).toMatchObject({ status: 'succeeded', sessionId: 'session-warning' });
    expect(activity).toContain(
      'ERROR codex_models_manager::cache: missing field base_instructions',
    );
    expect(activity).toContain('Finishing the agent run');
  });

  it('continues a Codex session with a compact follow-up prompt', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-resume-'));
    const binary = fakeCli(`printf '%s\\n' "$@" > argv-received.txt
cat > prompt-received.txt
echo '{"type":"thread.started","thread_id":"session-123"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"Finished."}}'
echo '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}}'`);

    const result = await new CliAgentExecutor({ preset: 'codex', binary }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      resumeSessionId: 'session-123',
      limits: { timeoutMs: 10_000 },
    });

    expect(result).toMatchObject({ status: 'succeeded', sessionId: 'session-123' });
    expect(readFileSync(join(worktree, 'argv-received.txt'), 'utf8')).toContain('session-123\n-\n');
    const prompt = readFileSync(join(worktree, 'prompt-received.txt'), 'utf8');
    expect(prompt).toContain('Continue the existing task');
    expect(prompt).toContain('Do not repeat repository discovery');
    expect(prompt).not.toContain('# Task');
  });

  it('explains a missing binary instead of failing opaquely', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'cli-wt-missing-'));
    const result = await new CliAgentExecutor({
      preset: 'codex',
      binary: '/nonexistent/codex-binary',
    }).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 10_000 },
    });
    expect(result).toMatchObject({ status: 'failed', failureReason: 'sandbox_error' });
    expect(result.status === 'failed' && result.note).toContain('not installed');
  });

  it('reports availability of a real binary', async () => {
    const present = new CliAgentExecutor({ preset: 'claude_code', binary: 'bash' });
    const missing = new CliAgentExecutor({ preset: 'codex', binary: '/nonexistent/codex' });
    expect(await present.isAvailable()).toBe(true);
    expect(await missing.isAvailable()).toBe(false);
  });
});

describe('presets', () => {
  it('claude_code builds non-interactive JSON args and forwards a model', () => {
    expect(CLAUDE_CODE_PRESET.buildArgs({ model: 'claude-sonnet-5', effort: 'low' })).toEqual([
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'claude-sonnet-5',
      '--effort',
      'low',
    ]);
    expect(CLAUDE_CODE_PRESET.buildArgs({ model: undefined })).not.toContain('--model');
  });

  it('codex parses JSONL output and falls back to raw text', () => {
    const args = CODEX_PRESET.buildArgs({ model: undefined });
    expect(args).toContain('--json');
    expect(args).not.toContain('--full-auto');
    expect(args).toContain('workspace-write');
    expect(args).toContain('sandbox_workspace_write.network_access=true');
    expect(CODEX_PRESET.buildArgs({ model: 'codex-model', effort: 'high' })).toContain(
      'model_reasoning_effort="high"',
    );
    expect(CODEX_PRESET.buildResumeArgs?.({ sessionId: 'session-123', model: undefined })).toEqual(
      expect.arrayContaining([
        'exec',
        'resume',
        '--json',
        'sandbox_workspace_write.network_access=true',
        'session-123',
        '-',
      ]),
    );
    expect(
      CODEX_PRESET.sessionId?.(
        JSON.stringify({ type: 'thread.started', thread_id: 'session-123' }),
      ),
    ).toBe('session-123');
    const jsonl = CODEX_PRESET.parse(
      '{"type":"item"}\n{"type":"result","text":"done","usage":{"input_tokens":5}}',
      '',
    );
    expect(jsonl).toMatchObject({ text: 'done', usage: { inputTokens: 5 } });
    const currentJsonl = CODEX_PRESET.parse(
      [
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Implemented and verified.' },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 120, output_tokens: 45 },
        }),
      ].join('\n'),
      '',
    );
    expect(currentJsonl).toMatchObject({
      text: 'Implemented and verified.',
      usage: { inputTokens: 120, outputTokens: 45 },
    });
    const plain = CODEX_PRESET.parse('just some output', '');
    expect(plain).toMatchObject({ text: 'just some output', isError: false });

    expect(
      CODEX_PRESET.activity?.(
        JSON.stringify({
          type: 'item.started',
          item: { type: 'command_execution', command: 'API_TOKEN=secret pnpm test' },
        }),
      ),
    ).toEqual({ kind: 'tool', message: 'Running API_TOKEN=[redacted] pnpm test' });
    expect(
      CODEX_PRESET.activity?.(
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
      ),
    ).toEqual({ kind: 'message', message: 'Done.' });
  });

  it('never forwards repository credentials into the sandbox', () => {
    for (const preset of [CLAUDE_CODE_PRESET, CODEX_PRESET]) {
      expect(preset.envAllowlist).not.toContain('GITHUB_TOKEN');
      expect(preset.envAllowlist).not.toContain('DATABASE_URL');
      expect(preset.envAllowlist).not.toContain('ANTHROPIC_API_KEY');
      expect(preset.envAllowlist).not.toContain('OPENAI_API_KEY');
      expect(preset.envAllowlist).not.toContain('CODEX_API_KEY');
    }
  });
});
