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
  await excludePlatformFiles(worktreeDir);
}

/** Files the platform writes into the worktree for its own purposes. */
export const PLATFORM_WORKTREE_FILES = ['.ai-system-prompt.md'];

/**
 * Keep platform scaffolding out of the user's change. `info/exclude` is
 * local to this worktree and never committed, so the prompt file stays
 * available for a human to inspect without ever appearing in a diff or PR.
 */
async function excludePlatformFiles(worktreeDir: string): Promise<void> {
  const { appendFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const excludePath = (await git(worktreeDir, 'rev-parse', '--git-path', 'info/exclude')).trim();
  const absolute = excludePath.startsWith('/') ? excludePath : `${worktreeDir}/${excludePath}`;
  await mkdir(dirname(absolute), { recursive: true });
  await appendFile(absolute, `\n${PLATFORM_WORKTREE_FILES.join('\n')}\n`, 'utf8');
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

export type MergeResult =
  | { status: 'merged' }
  | { status: 'up_to_date' }
  | { status: 'conflict'; conflicts: string[] };

/**
 * Merge a completed task's branch into the run branch. Conflicts are never
 * force-resolved: the merge is aborted and the conflicting paths reported so
 * the stage fails with something a human can act on (docs/05 §6).
 * Idempotent — re-merging an already-merged branch is a no-op.
 */
export async function mergeBranch(
  runWorktreeDir: string,
  branch: string,
  message: string,
): Promise<MergeResult> {
  const before = (await git(runWorktreeDir, 'rev-parse', 'HEAD')).trim();
  try {
    await git(
      runWorktreeDir,
      '-c',
      'user.email=agent@ai-system.local',
      '-c',
      'user.name=ai-system integrator',
      'merge',
      '--no-ff',
      '-m',
      message,
      branch,
    );
  } catch {
    const conflicts = (await git(runWorktreeDir, 'diff', '--name-only', '--diff-filter=U'))
      .split('\n')
      .filter(Boolean);
    await git(runWorktreeDir, 'merge', '--abort').catch(() => {});
    return { status: 'conflict', conflicts };
  }
  const after = (await git(runWorktreeDir, 'rev-parse', 'HEAD')).trim();
  return { status: before === after ? 'up_to_date' : 'merged' };
}

/**
 * Start a merge and leave the conflicts in the working tree for an agent to
 * resolve. Returns the conflicted paths, or null when the merge was clean.
 */
export async function startMerge(
  worktreeDir: string,
  branch: string,
  message: string,
): Promise<string[] | null> {
  try {
    await git(
      worktreeDir,
      '-c',
      'user.email=agent@ai-system.local',
      '-c',
      'user.name=ai-system integrator',
      'merge',
      '--no-ff',
      '-m',
      message,
      branch,
    );
    return null;
  } catch {
    return (await git(worktreeDir, 'diff', '--name-only', '--diff-filter=U'))
      .split('\n')
      .filter(Boolean);
  }
}

export async function abortMerge(worktreeDir: string): Promise<void> {
  await git(worktreeDir, 'merge', '--abort').catch(() => {});
}

/** Commit a merge whose conflicts have been resolved in the working tree. */
export async function completeMerge(worktreeDir: string, message: string): Promise<void> {
  await git(worktreeDir, 'add', '-A');
  await git(
    worktreeDir,
    '-c',
    'user.email=agent@ai-system.local',
    '-c',
    'user.name=ai-system integrator',
    'commit',
    '-m',
    message,
  );
}

export async function conflictMarkersRemain(worktreeDir: string, paths: string[]): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  for (const path of paths) {
    try {
      const content = await readFile(join(worktreeDir, path), 'utf8');
      if (/^<{7} |^={7}$|^>{7} /m.test(content)) return true;
    } catch {
      // A resolution that deleted the file is a valid resolution.
    }
  }
  return false;
}

export async function branchExists(checkoutDir: string, branch: string): Promise<boolean> {
  const out = await git(checkoutDir, 'branch', '--list', branch);
  return out.trim().length > 0;
}
