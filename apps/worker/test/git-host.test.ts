import { describe, expect, it } from 'vitest';
import { detectGitHost, gitHostFor } from '../src/git-host.js';

const GITHUB = 'https://github.com/owner/repo.git';
const GITLAB = 'https://gitlab.com/group/sub/project.git';
const BITBUCKET = 'git@bitbucket.org:team/app.git';

describe('detectGitHost', () => {
  it('identifies each supported forge from the remote alone', () => {
    expect(detectGitHost(GITHUB, {} as NodeJS.ProcessEnv)).toBe('github');
    expect(detectGitHost(GITLAB, {} as NodeJS.ProcessEnv)).toBe('gitlab');
    expect(detectGitHost(BITBUCKET, {} as NodeJS.ProcessEnv)).toBe('bitbucket');
    expect(detectGitHost('https://example.com/x/y.git', {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('recognizes a self-managed GitLab only when configured', () => {
    const remote = 'https://git.corp.example/team/app.git';
    expect(detectGitHost(remote, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(detectGitHost(remote, { GITLAB_HOST: 'git.corp.example' } as NodeJS.ProcessEnv)).toBe(
      'gitlab',
    );
  });
});

describe('gitHostFor', () => {
  it('returns a port only when that forge has credentials', () => {
    expect(gitHostFor(GITHUB, { env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(gitHostFor(GITHUB, { githubToken: 'ghp', env: {} as NodeJS.ProcessEnv })?.name).toBe(
      'github',
    );
    expect(gitHostFor(GITLAB, { env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(gitHostFor(GITLAB, { env: { GITLAB_TOKEN: 'glpat' } as NodeJS.ProcessEnv })?.name).toBe(
      'gitlab',
    );
    expect(gitHostFor(BITBUCKET, { env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(
      gitHostFor(BITBUCKET, { env: { BITBUCKET_TOKEN: 'bb' } as NodeJS.ProcessEnv })?.name,
    ).toBe('bitbucket');
  });

  it('does not let one forge’s credentials authenticate another', () => {
    // A GitHub token present in the environment must not make a Bitbucket
    // remote look publishable.
    expect(gitHostFor(BITBUCKET, { githubToken: 'ghp', env: {} as NodeJS.ProcessEnv })).toBeNull();
  });
});
