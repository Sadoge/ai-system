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
    expect(CODEX_PRESET.buildArgs({ model: 'codex-model', effort: 'high' })).toContain(
      'model_reasoning_effort="high"',
    );
    const jsonl = CODEX_PRESET.parse(
      '{"type":"item"}\n{"type":"result","text":"done","usage":{"input_tokens":5}}',
      '',
    );
    expect(jsonl).toMatchObject({ text: 'done', usage: { inputTokens: 5 } });
    const plain = CODEX_PRESET.parse('just some output', '');
    expect(plain).toMatchObject({ text: 'just some output', isError: false });
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
