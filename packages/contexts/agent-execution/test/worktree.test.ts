import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, diffAgainst, ensureCheckout, ensureWorktree } from '../src/git.js';
import { ScriptedAgentExecutor } from '../src/scripted-executor.js';
import type { CodingTaskSpec } from '../src/types.js';

function sh(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeOriginRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'origin-'));
  sh(dir, 'init', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@e.com');
  sh(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'README.md'), '# target\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-m', 'init');
  return dir;
}

const spec: CodingTaskSpec = {
  ticketTitle: 'Add feature',
  planSummary: 'Do the thing',
  steps: [{ title: 'step one', detail: 'do it', files: [] }],
  findings: [],
  rules: [],
};

describe('worktree lifecycle with scripted executor', () => {
  it('clones, cuts a worktree branch, executes, commits, and diffs', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-'));
    const checkout = join(base, 'checkout');
    const worktree = join(base, 'wt');

    await ensureCheckout(origin, checkout);
    await ensureWorktree(checkout, worktree, 'ai/test-run', 'main');

    const result = await new ScriptedAgentExecutor().execute({
      runId: 'r',
      agentRunId: 'a',
      worktreeDir: worktree,
      taskSpec: spec,
      limits: { timeoutMs: 5000 },
    });
    expect(result.status).toBe('succeeded');

    const committed = await commitAll(worktree, 'agent: add feature');
    expect(committed).toBe(true);
    const diff = await diffAgainst(worktree, 'main');
    expect(diff).toContain('IMPLEMENTATION_NOTES.md');
    expect(diff).toContain('+# Add feature');

    // Fix iteration reuses the same worktree and appends FIX lines.
    await ensureWorktree(checkout, worktree, 'ai/test-run', 'main');
    const fix = await new ScriptedAgentExecutor().execute({
      runId: 'r',
      agentRunId: 'a2',
      worktreeDir: worktree,
      taskSpec: {
        ...spec,
        findings: [{ severity: 'major', title: 'Missing FIX marker', detail: 'add it', filePath: null }],
      },
      limits: { timeoutMs: 5000 },
    });
    expect(fix.status).toBe('succeeded');
    await commitAll(worktree, 'agent: fix findings');
    const diff2 = await diffAgainst(worktree, 'main');
    expect(diff2).toContain('FIX: Missing FIX marker');
  });
});
