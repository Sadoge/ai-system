import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GitLabRepoRef {
  host: string;
  /** URL-encoded "group/project" path, the id GitLab's API wants. */
  projectPath: string;
}

/** Matches gitlab.com and self-managed hosts (anything with /group/project.git shape). */
export function parseGitLabRemote(remoteUrl: string, gitlabHost?: string): GitLabRepoRef | null {
  const m = /^(?:https?:\/\/|git@)([^/:]+)[:/](.+?)(?:\.git)?$/.exec(remoteUrl);
  if (!m) return null;
  const host = m[1]!;
  const knownHost = gitlabHost ?? process.env.GITLAB_HOST ?? 'gitlab.com';
  if (host !== knownHost) return null;
  return { host, projectPath: m[2]! };
}

/** Same credential rule as GitHub: token only in the push URL, never in config or the sandbox. */
export async function pushBranchGitLab(
  checkoutDir: string,
  branch: string,
  ref: GitLabRepoRef,
  token: string,
): Promise<void> {
  const url = `https://oauth2:${token}@${ref.host}/${ref.projectPath}.git`;
  await exec('git', ['push', url, `${branch}:${branch}`, '--force-with-lease'], {
    cwd: checkoutDir,
  });
}

export async function createMergeRequest(
  ref: GitLabRepoRef,
  token: string,
  input: { title: string; description: string; sourceBranch: string; targetBranch: string },
): Promise<{ url: string; iid: number }> {
  const response = await fetch(
    `https://${ref.host}/api/v4/projects/${encodeURIComponent(ref.projectPath)}/merge_requests`,
    {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        source_branch: input.sourceBranch,
        target_branch: input.targetBranch,
        remove_source_branch: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`GitLab MR creation failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { web_url: string; iid: number };
  return { url: data.web_url, iid: data.iid };
}
