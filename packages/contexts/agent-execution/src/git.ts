import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Clone (or refresh) the platform's cached checkout of a repository. */
export async function ensureCheckout(remoteUrl: string, checkoutDir: string): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (!existsSync(checkoutDir)) {
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(checkoutDir), { recursive: true });
    await exec('git', ['clone', remoteUrl, checkoutDir], { maxBuffer: 64 * 1024 * 1024 });
  } else {
    await git(checkoutDir, 'fetch', '--all', '--prune');
  }
}

/**
 * Cut an isolated worktree on a fresh run branch (docs/06 §4): coding agents
 * never work in the cached checkout, and never see credentials — remotes are
 * handled by the host, not inside the sandbox.
 */
export async function ensureWorktree(
  checkoutDir: string,
  worktreeDir: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (existsSync(worktreeDir)) return; // reused across fix iterations of the same run

  const branches = await git(checkoutDir, 'branch', '--list', branch);
  if (branches.trim()) {
    await git(checkoutDir, 'worktree', 'add', worktreeDir, branch);
  } else {
    await git(checkoutDir, 'worktree', 'add', '-b', branch, worktreeDir, baseBranch);
  }
}

export async function commitAll(worktreeDir: string, message: string): Promise<boolean> {
  await git(worktreeDir, 'add', '-A');
  const status = await git(worktreeDir, 'status', '--porcelain');
  if (!status.trim()) return false;
  await git(
    worktreeDir,
    '-c',
    'user.email=agent@ai-system.local',
    '-c',
    'user.name=ai-system agent',
    'commit',
    '-m',
    message,
  );
  return true;
}

export async function diffAgainst(worktreeDir: string, baseRef: string): Promise<string> {
  return git(worktreeDir, 'diff', `${baseRef}...HEAD`);
}

export async function removeWorktree(checkoutDir: string, worktreeDir: string): Promise<void> {
  await git(checkoutDir, 'worktree', 'remove', '--force', worktreeDir).catch(() => {});
}
