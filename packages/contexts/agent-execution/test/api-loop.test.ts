import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiLoopAgentExecutor, type ToolLoopRunner } from '../src/api-loop-executor.js';
import type { CodingTaskSpec } from '../src/types.js';

const spec: CodingTaskSpec = {
  ticketTitle: 'Add a greeting',
  planSummary: 'write greeting.txt',
  steps: [{ title: 'write it', detail: 'create greeting.txt', files: ['greeting.txt'] }],
  findings: [],
  rules: [],
};

/** Drives the executor's tool handler with a scripted sequence of tool calls. */
function runnerFor(calls: { name: string; arguments: Record<string, unknown> }[]): ToolLoopRunner & {
  results: { content: string; isError?: boolean }[];
} {
  const results: { content: string; isError?: boolean }[] = [];
  return {
    results,
    async toolLoop(_profile, req) {
      for (const [i, call] of calls.entries()) {
        results.push(await req.executeTool({ id: `c${i}`, ...call }));
      }
      return { text: 'done', toolCallCount: calls.length, costUsd: 0 };
    },
  };
}

describe('ApiLoopAgentExecutor', () => {
  it('writes, reads, and lists files inside the worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiloop-'));
    writeFileSync(join(dir, 'existing.txt'), 'hello');
    const runner = runnerFor([
      { name: 'write_file', arguments: { path: 'greeting.txt', content: 'hi there' } },
      { name: 'read_file', arguments: { path: 'existing.txt' } },
      { name: 'list_files', arguments: { path: '.' } },
    ]);

    const result = await new ApiLoopAgentExecutor(runner, {}).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: dir,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
    });

    expect(result.status).toBe('succeeded');
    expect(readFileSync(join(dir, 'greeting.txt'), 'utf8')).toBe('hi there');
    expect(runner.results[1]!.content).toBe('hello');
    expect(runner.results[2]!.content).toContain('greeting.txt');
  });

  it('refuses to escape the worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiloop-escape-'));
    const runner = runnerFor([
      { name: 'read_file', arguments: { path: '../../etc/passwd' } },
      { name: 'write_file', arguments: { path: '/tmp/evil.txt', content: 'nope' } },
    ]);

    await new ApiLoopAgentExecutor(runner, {}).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: dir,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
    });

    // Both are surfaced to the model as tool errors, not silently redirected.
    expect(runner.results[0]).toMatchObject({ isError: true });
    expect(runner.results[0]!.content).toContain('escapes the workspace');
    expect(runner.results[1]).toMatchObject({ isError: true });
  });

  it('edits an exact unique string and refuses ambiguity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiloop-edit-'));
    writeFileSync(join(dir, 'calc.ts'), 'const a = 1;\nconst b = 1;\nexport const c = a + b;\n');
    const runner = runnerFor([
      { name: 'edit_file', arguments: { path: 'calc.ts', old_string: 'export const c = a + b;', new_string: 'export const c = a * b;' } },
      // "const a = 1;" is a substring of one line only, but "= 1;" occurs twice:
      { name: 'edit_file', arguments: { path: 'calc.ts', old_string: '= 1;', new_string: '= 2;' } },
      { name: 'edit_file', arguments: { path: 'calc.ts', old_string: 'not present', new_string: 'x' } },
    ]);

    await new ApiLoopAgentExecutor(runner, {}).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: dir,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
    });

    expect(readFileSync(join(dir, 'calc.ts'), 'utf8')).toContain('a * b');
    expect(runner.results[0]).toMatchObject({ content: 'edited calc.ts' });
    // Ambiguity is an error, never a guess at which occurrence was meant.
    expect(runner.results[1]).toMatchObject({ isError: true });
    expect(runner.results[1]!.content).toContain('more than once');
    expect(runner.results[2]).toMatchObject({ isError: true });
  });

  it('runs only allowlisted commands, verbatim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiloop-cmd-'));
    writeFileSync(join(dir, 'hello.txt'), 'hi');
    const runner = runnerFor([
      { name: 'run_command', arguments: { command: 'cat hello.txt' } },
      // Prefix-matching or shell composition must not slip through:
      { name: 'run_command', arguments: { command: 'cat hello.txt; rm -rf /' } },
      { name: 'run_command', arguments: { command: 'echo pwned' } },
    ]);

    await new ApiLoopAgentExecutor(runner, {}).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: dir,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
      allowedCommands: ['cat hello.txt'],
    });

    expect(runner.results[0]).toMatchObject({ content: 'hi' });
    expect(runner.results[1]).toMatchObject({ isError: true });
    expect(runner.results[1]!.content).toContain('not in the repository allowlist');
    expect(runner.results[2]).toMatchObject({ isError: true });
  });

  it('reports a typed failure when the loop throws', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiloop-fail-'));
    const result = await new ApiLoopAgentExecutor(
      {
        async toolLoop() {
          throw new Error('run budget exhausted');
        },
      },
      {},
    ).execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: dir,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
    });
    expect(result).toMatchObject({ status: 'failed', failureReason: 'budget_denied' });
  });
});
