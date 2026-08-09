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
