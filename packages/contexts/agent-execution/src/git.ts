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
  if (existsSync(worktreeDir)) {
    // A worker upgrade can add new platform exclusions while a run is paused.
    // Refresh them for reused fix-iteration worktrees as well as new ones.
    await excludePlatformFiles(worktreeDir);
    return;
  }

  const branches = await git(checkoutDir, 'branch', '--list', branch);
  if (branches.trim()) {
    const registered = await registeredWorktreeForBranch(checkoutDir, branch);
    if (registered) {
      const { existsSync } = await import('node:fs');
      const { mkdir } = await import('node:fs/promises');
      const { dirname, resolve } = await import('node:path');
      const destination = resolve(worktreeDir);
      if (resolve(registered) !== destination) {
        await mkdir(dirname(destination), { recursive: true });
        if (existsSync(registered)) {
          // Preserve any partial agent work while repairing paths produced by
          // an older relative-AI_DATA_DIR worker.
          await git(checkoutDir, 'worktree', 'move', registered, destination);
        } else {
          await git(checkoutDir, 'worktree', 'prune');
          await git(checkoutDir, 'worktree', 'add', destination, branch);
        }
      }
    } else {
      await git(checkoutDir, 'worktree', 'add', worktreeDir, branch);
    }
  } else {
    await git(checkoutDir, 'worktree', 'add', '-b', branch, worktreeDir, baseBranch);
  }
  await excludePlatformFiles(worktreeDir);
}

async function registeredWorktreeForBranch(
  checkoutDir: string,
  branch: string,
): Promise<string | null> {
  const output = await git(checkoutDir, 'worktree', 'list', '--porcelain');
  const wanted = `refs/heads/${branch}`;
  let path: string | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    if (line === `branch ${wanted}` && path) return path;
    if (line === '') path = null;
  }
  return null;
}

/**
 * Files created by the execution harness or dependency tooling that are never
 * part of an agent's source change. These patterns live in the worktree-local
 * exclude file so a repository's own .gitignore does not need to know how the
 * platform provisions coding agents.
 */
export const PLATFORM_WORKTREE_FILES = [
  '.ai-system-prompt.md',
  '.pnpm-store/',
  '.npm/',
  '.yarn/cache/',
];

/**
 * Keep platform scaffolding out of the user's change. `info/exclude` is
 * local to this worktree and never committed, so the prompt file stays
 * available for a human to inspect without ever appearing in a diff or PR.
 */
async function excludePlatformFiles(worktreeDir: string): Promise<void> {
  const { appendFile, mkdir, readFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const excludePath = (await git(worktreeDir, 'rev-parse', '--git-path', 'info/exclude')).trim();
  const absolute = excludePath.startsWith('/') ? excludePath : `${worktreeDir}/${excludePath}`;
  await mkdir(dirname(absolute), { recursive: true });
  const existing = await readFile(absolute, 'utf8').catch(() => '');
  const missing = PLATFORM_WORKTREE_FILES.filter(
    (pattern) => !existing.split('\n').includes(pattern),
  );
  if (missing.length > 0) await appendFile(absolute, `\n${missing.join('\n')}\n`, 'utf8');
}

export async function commitAll(
  worktreeDir: string,
  message: string,
  baseRef?: string,
): Promise<boolean> {
  await git(worktreeDir, 'add', '-A');
  // An agent can explicitly stage an ignored file (`git add -f`) or a cache
  // can already be tracked by a repository snapshot. Unstage platform files
  // defensively before the host creates its commit; their working copies are
  // preserved for subsequent commands and troubleshooting.
  await git(
    worktreeDir,
    'reset',
    '--quiet',
    '--',
    ...PLATFORM_WORKTREE_FILES.map((pattern) => pattern.replace(/\/$/, '')),
  );
  if (baseRef) {
    for (const pattern of PLATFORM_WORKTREE_FILES) {
      const path = pattern.replace(/\/$/, '');
      // A previous attempt may already have committed generated files before
      // the worker was upgraded. Stage their removal, then restore only the
      // version (if any) that genuinely existed on the base branch. `--cached`
      // keeps the local cache available to subsequent validation commands.
      await git(
        worktreeDir,
        'rm',
        '-r',
        '-q',
        '--cached',
        '--ignore-unmatch',
        '--',
        path,
      );
      await git(worktreeDir, 'restore', `--source=${baseRef}`, '--staged', '--', path).catch(
        () => {},
      );
    }
  }
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
  // A diff artifact describes the source change, never platform/runtime
  // caches. Keep this final guard even though commitAll also sanitizes the
  // branch: it bounds output if an older attempt committed a large cache and
  // lets the recovery attempt reach the cleanup commit instead of overflowing
  // Node's child-process buffer first.
  return git(
    worktreeDir,
    'diff',
    `${baseRef}...HEAD`,
    '--',
    '.',
    ...PLATFORM_WORKTREE_FILES.map(
      (pattern) => `:(exclude)${pattern.replace(/\/$/, '')}`,
    ),
  );
}

export async function removeWorktree(checkoutDir: string, worktreeDir: string): Promise<void> {
  await git(checkoutDir, 'worktree', 'remove', '--force', worktreeDir).catch(() => {});
}

export type MergeResult =
  { status: 'merged' } | { status: 'up_to_date' } | { status: 'conflict'; conflicts: string[] };

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

export async function conflictMarkersRemain(
  worktreeDir: string,
  paths: string[],
): Promise<boolean> {
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
