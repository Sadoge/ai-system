import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isLocalGitRemote, pushBranchLocal } from '../src/local-git.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout.trim();
}

describe('local Git repositories', () => {
  it('distinguishes filesystem remotes from hosted and SSH remotes', () => {
    expect(isLocalGitRemote('/Users/example/project')).toBe(true);
    expect(isLocalGitRemote('../project')).toBe(true);
    expect(isLocalGitRemote('project.git')).toBe(true);
    expect(isLocalGitRemote('file:///tmp/project.git')).toBe(true);
    expect(isLocalGitRemote('https://github.com/example/project.git')).toBe(false);
    expect(isLocalGitRemote('git@github.com:example/project.git')).toBe(false);
  });

  it('publishes a run branch into the registered local repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-system-local-git-'));
    const target = join(root, 'target');
    const checkout = join(root, 'checkout');
    try {
      await exec('git', ['init', target]);
      await git(target, 'config', 'user.email', 'test@example.com');
      await git(target, 'config', 'user.name', 'Test');
      await writeFile(join(target, 'README.md'), 'base\n');
      await git(target, 'add', 'README.md');
      await git(target, 'commit', '-m', 'base');

      await exec('git', ['clone', target, checkout]);
      await git(checkout, 'config', 'user.email', 'test@example.com');
      await git(checkout, 'config', 'user.name', 'Test');
      await git(checkout, 'switch', '-c', 'ai/run-test');
      await writeFile(join(checkout, 'CHANGE.md'), 'published\n');
      await git(checkout, 'add', 'CHANGE.md');
      await git(checkout, 'commit', '-m', 'change');

      await pushBranchLocal(checkout, 'ai/run-test', target);

      expect(await git(target, 'show-ref', '--verify', 'refs/heads/ai/run-test')).toContain(
        'refs/heads/ai/run-test',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
