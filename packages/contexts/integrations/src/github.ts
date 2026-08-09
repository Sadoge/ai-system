import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  const m =
    /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl) ?? null;
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

/**
 * Push the run branch from the platform's cached checkout — credentials are
 * injected into the push URL only, never written to git config, never visible
 * inside the agent sandbox (docs/06 §4).
 */
export async function pushBranch(
  checkoutDir: string,
  branch: string,
  ref: GitHubRepoRef,
  token: string,
): Promise<void> {
  const url = `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`;
  await exec('git', ['push', url, `${branch}:${branch}`, '--force-with-lease'], {
    cwd: checkoutDir,
  });
}

export async function createPullRequest(
  ref: GitHubRepoRef,
  token: string,
  input: { title: string; body: string; head: string; base: string },
): Promise<{ url: string; number: number }> {
  const response = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`GitHub PR creation failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}
