import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  steps: [{ title: 'step one', detail: 'do it', files: ['IMPLEMENTATION_NOTES.md'] }],
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
        findings: [
          { severity: 'major', title: 'Missing FIX marker', detail: 'add it', filePath: null },
        ],
      },
      limits: { timeoutMs: 5000 },
    });
    expect(fix.status).toBe('succeeded');
    await commitAll(worktree, 'agent: fix findings');
    const diff2 = await diffAgainst(worktree, 'main');
    expect(diff2).toContain('FIX: Missing FIX marker');
  });

  it('keeps the platform prompt file out of the committed change', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-exclude-'));
    const checkout = join(base, 'checkout');
    const worktree = join(base, 'wt');
    await ensureCheckout(origin, checkout);
    await ensureWorktree(checkout, worktree, 'ai/run-exclude', 'main');

    // The CLI executor writes this next to the work so a human can inspect it;
    // it must never reach the user's diff or PR.
    writeFileSync(join(worktree, '.ai-system-prompt.md'), '# prompt');
    writeFileSync(join(worktree, 'real-change.txt'), 'the actual work');
    await commitAll(worktree, 'agent: work');

    const diff = await diffAgainst(worktree, 'main');
    expect(diff).toContain('real-change.txt');
    expect(diff).not.toContain('.ai-system-prompt.md');
  });

  it('keeps package-manager caches out even when an agent explicitly stages them', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-cache-exclude-'));
    const checkout = join(base, 'checkout');
    const worktree = join(base, 'wt');
    await ensureCheckout(origin, checkout);
    await ensureWorktree(checkout, worktree, 'ai/run-cache-exclude', 'main');

    mkdirSync(join(worktree, '.pnpm-store', 'v11', 'files'), { recursive: true });
    writeFileSync(join(worktree, '.pnpm-store', 'v11', 'index.db'), 'large local cache');
    writeFileSync(join(worktree, '.pnpm-store', 'v11', 'files', 'blob'), 'generated dependency');
    writeFileSync(join(worktree, 'real-change.txt'), 'the actual work');
    // Simulate a tool or agent overriding the worktree-local ignore rule.
    sh(worktree, 'add', '-f', '.pnpm-store');

    await commitAll(worktree, 'agent: cache-safe work');

    const diff = await diffAgainst(worktree, 'main');
    expect(diff).toContain('real-change.txt');
    expect(diff).not.toContain('.pnpm-store');
  });

  it('cleans generated caches that a previous attempt already committed', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-cache-recovery-'));
    const checkout = join(base, 'checkout');
    const worktree = join(base, 'wt');
    await ensureCheckout(origin, checkout);
    await ensureWorktree(checkout, worktree, 'ai/run-cache-recovery', 'main');

    mkdirSync(join(worktree, '.pnpm-store', 'v11'), { recursive: true });
    writeFileSync(join(worktree, '.pnpm-store', 'v11', 'index.db'), 'old accidental cache');
    writeFileSync(join(worktree, 'real-change.txt'), 'completed agent work');
    sh(worktree, 'add', '-f', '.pnpm-store', 'real-change.txt');
    sh(worktree, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-m', 'bad attempt');

    expect(await diffAgainst(worktree, 'main')).toContain('.pnpm-store');
    expect(await commitAll(worktree, 'agent: remove generated cache', 'main')).toBe(true);

    const recoveredDiff = await diffAgainst(worktree, 'main');
    expect(recoveredDiff).toContain('real-change.txt');
    expect(recoveredDiff).not.toContain('.pnpm-store');
    expect(existsSync(join(worktree, '.pnpm-store', 'v11', 'index.db'))).toBe(true);
  });

  it('moves a branch registered at an old worktree path to the canonical path', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-move-'));
    const checkout = join(base, 'checkout');
    const oldWorktree = join(checkout, 'data', 'worktrees', 'run');
    const canonicalWorktree = join(base, 'worktrees', 'run');
    await ensureCheckout(origin, checkout);
    await ensureWorktree(checkout, oldWorktree, 'ai/run-moved', 'main');
    writeFileSync(join(oldWorktree, 'partial.txt'), 'preserve me');

    await ensureWorktree(checkout, canonicalWorktree, 'ai/run-moved', 'main');

    expect(existsSync(oldWorktree)).toBe(false);
    expect(existsSync(join(canonicalWorktree, 'partial.txt'))).toBe(true);
  });

  it('writes each task to its own file so parallel task branches do not collide', async () => {
    const origin = makeOriginRepo();
    const base = mkdtempSync(join(tmpdir(), 'exec-parallel-'));
    const checkout = join(base, 'checkout');
    await ensureCheckout(origin, checkout);

    const worktrees = [join(base, 'wt-1'), join(base, 'wt-2')];
    await ensureWorktree(checkout, worktrees[0]!, 'ai/run/t-1', 'main');
    await ensureWorktree(checkout, worktrees[1]!, 'ai/run/t-2', 'main');

    // Task 1 declares its file; task 2 declares none, so the name comes from its title.
    await new ScriptedAgentExecutor().execute({
      runId: 'r',
      agentRunId: 'a1',
      worktreeDir: worktrees[0]!,
      taskSpec: { ...spec, taskTitle: 'Task one' },
      limits: { timeoutMs: 5000 },
    });
    await new ScriptedAgentExecutor().execute({
      runId: 'r',
      agentRunId: 'a2',
      worktreeDir: worktrees[1]!,
      taskSpec: {
        ...spec,
        taskTitle: 'Design notes',
        steps: [{ title: 'step', detail: 'd', files: [] }],
      },
      limits: { timeoutMs: 5000 },
    });
    await commitAll(worktrees[0]!, 'task one');
    await commitAll(worktrees[1]!, 'task two');

    expect(await diffAgainst(worktrees[0]!, 'main')).toContain('IMPLEMENTATION_NOTES.md');
    expect(await diffAgainst(worktrees[1]!, 'main')).toContain('design-notes.md');
  });
});
