import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPaths, taskWorktreeDir } from '../src/mvp-stages.js';
import type { StageServices } from '../src/services.js';

describe('worker repository paths', () => {
  it('normalizes a relative data directory before building Git worktree paths', () => {
    const services = { dataDir: './data' } as StageServices;
    const root = resolve('data');

    expect(repoPaths(services, 'repo-1', 'run-1')).toEqual({
      checkoutDir: join(root, 'repos', 'repo-1'),
      worktreeDir: join(root, 'worktrees', 'run-1', 'run'),
    });
    expect(taskWorktreeDir(services, 'run-1', 'task-12345678')).toBe(
      join(root, 'worktrees', 'run-1', 'task-12345678'),
    );
  });
});
