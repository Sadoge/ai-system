import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClaudeSubscriptionAdapter,
  CodexSubscriptionAdapter,
} from '../src/adapters/subscription-cli.js';

function executable(dir: string, body: string): string {
  const path = join(dir, 'fake-cli');
  writeFileSync(path, `#!/bin/bash\nset -e\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

const request = {
  system: 'Return a JSON object.',
  messages: [{ role: 'user' as const, content: 'Classify this ticket.' }],
  maxTokens: 100,
};

describe('CodexSubscriptionAdapter', () => {
  it('detects ChatGPT login and runs an isolated JSONL completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-subscription-'));
    const promptPath = join(dir, 'prompt.txt');
    const argsPath = join(dir, 'args.txt');
    const keyPath = join(dir, 'key.txt');
    const binary = executable(
      dir,
      `if [ "$1" = "login" ]; then
  echo "Logged in using ChatGPT"
  exit 0
fi
printf '%s' "$*" > '${argsPath}'
printf '%s' "\${OPENAI_API_KEY:-}" > '${keyPath}'
cat > '${promptPath}'
echo '{"type":"thread.started","thread_id":"t"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"complexity\\":\\"small\\"}"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":42,"output_tokens":7}}'`,
    );
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-be-forwarded';
    try {
      const adapter = new CodexSubscriptionAdapter({ binary, cwd: dir });
      expect(await adapter.status()).toMatchObject({ available: true, authenticated: true });
      expect(await adapter.complete('default', { ...request, reasoningEffort: 'low' })).toEqual({
        text: '{"complexity":"small"}',
        inputTokens: 42,
        outputTokens: 7,
      });
      expect(readFileSync(argsPath, 'utf8')).toContain('exec --ephemeral --sandbox read-only');
      expect(readFileSync(argsPath, 'utf8')).not.toContain('--model');
      expect(readFileSync(argsPath, 'utf8')).toContain('--config model_reasoning_effort="low"');
      expect(readFileSync(promptPath, 'utf8')).toContain('Classify this ticket.');
      expect(readFileSync(keyPath, 'utf8')).toBe('');
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });

  it('reports an actionable error when the binary is unavailable', async () => {
    const adapter = new CodexSubscriptionAdapter({ binary: '/missing/codex' });
    await expect(adapter.complete('default', request)).rejects.toThrow(/codex login/i);
    expect(await adapter.status()).toMatchObject({ available: false, authenticated: false });
  });

  it('rejects rather than throwing EPIPE when the CLI exits without reading stdin', async () => {
    // The prompt is written to the child's stdin. A CLI that exits first — a
    // crash, an expired login — closes the pipe mid-write, and an unhandled
    // stream error would take the worker down instead of failing the call.
    const dir = mkdtempSync(join(tmpdir(), 'codex-epipe-'));
    const binary = executable(
      dir,
      `if [ "$1" = "login" ]; then
  echo "Logged in using ChatGPT"
  exit 0
fi
echo "boom" >&2
exit 3`,
    );
    const adapter = new CodexSubscriptionAdapter({ binary, cwd: dir });
    // Large enough that the write cannot complete before the child is gone.
    const big = 'x'.repeat(2_000_000);

    await expect(
      adapter.complete('default', {
        ...request,
        messages: [{ role: 'user' as const, content: big }],
      }),
    ).rejects.toThrow(/exited with code 3/);
  });
});

describe('ClaudeSubscriptionAdapter', () => {
  it('detects a saved login and parses print-mode JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-subscription-'));
    const promptPath = join(dir, 'prompt.txt');
    const argsPath = join(dir, 'args.txt');
    const keyPath = join(dir, 'key.txt');
    const binary = executable(
      dir,
      `if [ "$1" = "auth" ]; then
  echo '{"loggedIn":true,"authMethod":"oauth"}'
  exit 0
fi
printf '%s' "$*" > '${argsPath}'
printf '%s' "\${ANTHROPIC_API_KEY:-}" > '${keyPath}'
cat > '${promptPath}'
echo '{"result":"{\\"complexity\\":\\"medium\\"}","is_error":false,"usage":{"input_tokens":21,"output_tokens":5}}'`,
    );
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'must-not-be-forwarded';
    try {
      const adapter = new ClaudeSubscriptionAdapter({ binary, cwd: dir });
      expect(await adapter.status()).toMatchObject({ available: true, authenticated: true });
      expect(await adapter.complete('haiku', { ...request, reasoningEffort: 'medium' })).toEqual({
        text: '{"complexity":"medium"}',
        inputTokens: 21,
        outputTokens: 5,
      });
      expect(readFileSync(argsPath, 'utf8')).toContain('-p --output-format json');
      expect(readFileSync(argsPath, 'utf8')).toContain(
        '--tools  --no-session-persistence --safe-mode',
      );
      expect(readFileSync(argsPath, 'utf8')).toContain('--model haiku --effort medium');
      expect(readFileSync(promptPath, 'utf8')).toContain('Return a JSON object.');
      expect(readFileSync(keyPath, 'utf8')).toBe('');
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });
});
