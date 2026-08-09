import {
  bitbucketAuthFromEnv,
  createBitbucketPullRequest,
  createMergeRequest,
  createPullRequest,
  parseBitbucketRemote,
  parseGitHubRemote,
  parseGitLabRemote,
  pushBranch,
  pushBranchBitbucket,
  pushBranchGitLab,
} from '@ai-system/integrations';

export type GitHostName = 'github' | 'gitlab' | 'bitbucket';

/**
 * The git-host port. The package stage only knows how to say "push this branch,
 * then open a change request"; which forge answers is a detail of the remote URL
 * and the credentials present (docs/02 — Integrations context).
 */
export interface GitHostPort {
  name: GitHostName;
  push(checkoutDir: string, branch: string): Promise<void>;
  openChangeRequest(input: {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
  }): Promise<{ url: string }>;
}

/** Which forge a remote belongs to, regardless of whether we can authenticate. */
export function detectGitHost(
  remoteUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): GitHostName | null {
  if (parseGitHubRemote(remoteUrl)) return 'github';
  if (parseGitLabRemote(remoteUrl, env.GITLAB_HOST)) return 'gitlab';
  if (parseBitbucketRemote(remoteUrl)) return 'bitbucket';
  return null;
}

/**
 * Resolves a usable port, or null when the host is unknown *or* its credentials
 * are missing. Callers report the difference using `detectGitHost`, because
 * "no token" and "unsupported forge" need different fixes from a human.
 */
export function gitHostFor(
  remoteUrl: string,
  options: { githubToken?: string | undefined; env?: NodeJS.ProcessEnv } = {},
): GitHostPort | null {
  const env = options.env ?? process.env;

  const githubRef = parseGitHubRemote(remoteUrl);
  if (githubRef) {
    const token = options.githubToken ?? env.GITHUB_TOKEN;
    if (!token) return null;
    return {
      name: 'github',
      push: (checkoutDir, branch) => pushBranch(checkoutDir, branch, githubRef, token),
      openChangeRequest: async (input) =>
        createPullRequest(githubRef, token, {
          title: input.title,
          body: input.body,
          head: input.sourceBranch,
          base: input.targetBranch,
        }),
    };
  }

  const gitlabRef = parseGitLabRemote(remoteUrl, env.GITLAB_HOST);
  if (gitlabRef) {
    const token = env.GITLAB_TOKEN;
    if (!token) return null;
    return {
      name: 'gitlab',
      push: (checkoutDir, branch) => pushBranchGitLab(checkoutDir, branch, gitlabRef, token),
      openChangeRequest: async (input) =>
        createMergeRequest(gitlabRef, token, {
          title: input.title,
          description: input.body,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
        }),
    };
  }

  const bitbucketRef = parseBitbucketRemote(remoteUrl);
  if (bitbucketRef) {
    const auth = bitbucketAuthFromEnv(env);
    if (!auth) return null;
    return {
      name: 'bitbucket',
      push: (checkoutDir, branch) => pushBranchBitbucket(checkoutDir, branch, bitbucketRef, auth),
      openChangeRequest: async (input) =>
        createBitbucketPullRequest(bitbucketRef, auth, {
          title: input.title,
          description: input.body,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
        }),
    };
  }

  return null;
}
