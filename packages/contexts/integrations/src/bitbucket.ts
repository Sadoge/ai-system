import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface BitbucketRepoRef {
  workspace: string;
  repoSlug: string;
}

/**
 * Bitbucket Cloud only. Server/Data Center speaks a different API entirely, so
 * silently accepting its remotes here would produce confident 404s later.
 */
export function parseBitbucketRemote(remoteUrl: string): BitbucketRepoRef | null {
  const m = /bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remoteUrl);
  if (!m) return null;
  return { workspace: m[1]!, repoSlug: m[2]! };
}

export interface BitbucketAuth {
  /** Repository/workspace access token — the modern credential. */
  token?: string | undefined;
  /** Legacy app password, which needs the account name alongside it. */
  username?: string | undefined;
  appPassword?: string | undefined;
}

export function bitbucketAuthFromEnv(env: NodeJS.ProcessEnv = process.env): BitbucketAuth | null {
  if (env.BITBUCKET_TOKEN) return { token: env.BITBUCKET_TOKEN };
  if (env.BITBUCKET_USERNAME && env.BITBUCKET_APP_PASSWORD) {
    return { username: env.BITBUCKET_USERNAME, appPassword: env.BITBUCKET_APP_PASSWORD };
  }
  return null;
}

/** The credential pair as it appears in a push URL — never written to git config. */
export function bitbucketPushCredentials(auth: BitbucketAuth): string {
  if (auth.token) return `x-token-auth:${auth.token}`;
  return `${encodeURIComponent(auth.username!)}:${encodeURIComponent(auth.appPassword!)}`;
}

function authHeader(auth: BitbucketAuth): string {
  if (auth.token) return `Bearer ${auth.token}`;
  const basic = Buffer.from(`${auth.username}:${auth.appPassword}`).toString('base64');
  return `Basic ${basic}`;
}

/** Same credential rule as GitHub and GitLab: token only in the push URL. */
export async function pushBranchBitbucket(
  checkoutDir: string,
  branch: string,
  ref: BitbucketRepoRef,
  auth: BitbucketAuth,
): Promise<void> {
  const url = `https://${bitbucketPushCredentials(auth)}@bitbucket.org/${ref.workspace}/${ref.repoSlug}.git`;
  await exec('git', ['push', url, `${branch}:${branch}`, '--force-with-lease'], {
    cwd: checkoutDir,
  });
}

export async function createBitbucketPullRequest(
  ref: BitbucketRepoRef,
  auth: BitbucketAuth,
  input: { title: string; description: string; sourceBranch: string; targetBranch: string },
): Promise<{ url: string; id: number }> {
  const response = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${ref.workspace}/${ref.repoSlug}/pullrequests`,
    {
      method: 'POST',
      headers: { authorization: authHeader(auth), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        source: { branch: { name: input.sourceBranch } },
        destination: { branch: { name: input.targetBranch } },
        close_source_branch: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Bitbucket PR creation failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { id: number; links?: { html?: { href?: string } } };
  const url =
    data.links?.html?.href ??
    `https://bitbucket.org/${ref.workspace}/${ref.repoSlug}/pull-requests/${data.id}`;
  return { url, id: data.id };
}
