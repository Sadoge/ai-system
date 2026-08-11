import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** True when a repository remote points at the local filesystem. */
export function isLocalGitRemote(remoteUrl: string): boolean {
  const value = remoteUrl.trim();
  if (!value) return false;
  if (value.startsWith('file://') || isAbsolute(value)) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;

  // SCP-style SSH remotes contain a host separator (`git@host:path`). Other
  // scheme-based URLs are remote services. A remaining plain path is local.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^[^/]+@[^:]+:/.test(value)) return false;
  return true;
}

/** Publish a worker-owned run branch back into a registered local repository. */
export async function pushBranchLocal(
  checkoutDir: string,
  branch: string,
  remoteUrl: string,
): Promise<void> {
  await exec('git', ['push', remoteUrl, `${branch}:${branch}`, '--force-with-lease'], {
    cwd: checkoutDir,
  });
}
