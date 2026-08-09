import { describe, expect, it } from 'vitest';
import { adfToText, jiraConfigFromEnv } from '../src/jira.js';

describe('adfToText', () => {
  it('flattens paragraphs, lists, and hard breaks', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
          ],
        },
      ],
    };
    expect(adfToText(adf)).toBe('First line\n- one\n- two\n\n');
  });

  it('handles plain strings and null', () => {
    expect(adfToText('already text')).toBe('already text');
    expect(adfToText(null)).toBe('');
  });
});

describe('jiraConfigFromEnv', () => {
  it('returns null unless all three variables are set', () => {
    expect(jiraConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      jiraConfigFromEnv({
        JIRA_BASE_URL: 'https://x.atlassian.net/',
        JIRA_EMAIL: 'a@b.c',
        JIRA_API_TOKEN: 't',
      } as NodeJS.ProcessEnv),
    ).toEqual({ baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' });
  });
});

describe('parseGitLabRemote', () => {
  it('parses gitlab.com https and ssh remotes, including subgroups', async () => {
    const { parseGitLabRemote } = await import('../src/gitlab.js');
    expect(parseGitLabRemote('https://gitlab.com/group/project.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'group/project',
    });
    expect(parseGitLabRemote('git@gitlab.com:group/sub/project.git')).toEqual({
      host: 'gitlab.com',
      projectPath: 'group/sub/project',
    });
    // A GitHub remote must not be claimed by the GitLab parser.
    expect(parseGitLabRemote('https://github.com/owner/repo.git')).toBeNull();
  });

  it('accepts a self-managed host only when configured', async () => {
    const { parseGitLabRemote } = await import('../src/gitlab.js');
    expect(parseGitLabRemote('https://git.corp.example/team/app.git')).toBeNull();
    expect(parseGitLabRemote('https://git.corp.example/team/app.git', 'git.corp.example')).toEqual({
      host: 'git.corp.example',
      projectPath: 'team/app',
    });
  });
});

describe('linearConfigFromEnv', () => {
  it('requires the API key', async () => {
    const { linearConfigFromEnv } = await import('../src/linear.js');
    expect(linearConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(linearConfigFromEnv({ LINEAR_API_KEY: 'lin_x' } as NodeJS.ProcessEnv)).toEqual({
      apiKey: 'lin_x',
    });
  });
});

describe('parseBitbucketRemote', () => {
  it('parses Bitbucket Cloud https and ssh remotes only', async () => {
    const { parseBitbucketRemote } = await import('../src/bitbucket.js');
    expect(parseBitbucketRemote('https://bitbucket.org/team/app.git')).toEqual({
      workspace: 'team',
      repoSlug: 'app',
    });
    expect(parseBitbucketRemote('git@bitbucket.org:team/app.git')).toEqual({
      workspace: 'team',
      repoSlug: 'app',
    });
    // Server/Data Center speaks a different API; claiming it here would 404 later.
    expect(parseBitbucketRemote('https://bitbucket.mycorp.com/scm/team/app.git')).toBeNull();
    expect(parseBitbucketRemote('https://github.com/owner/repo.git')).toBeNull();
  });

  it('builds push credentials without leaking them into git config', async () => {
    const { bitbucketAuthFromEnv, bitbucketPushCredentials } = await import('../src/bitbucket.js');
    expect(bitbucketAuthFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    const tokenAuth = bitbucketAuthFromEnv({ BITBUCKET_TOKEN: 't' } as NodeJS.ProcessEnv)!;
    expect(bitbucketPushCredentials(tokenAuth)).toBe('x-token-auth:t');
    const appAuth = bitbucketAuthFromEnv({
      BITBUCKET_USERNAME: 'a b',
      BITBUCKET_APP_PASSWORD: 'p/w',
    } as NodeJS.ProcessEnv)!;
    expect(bitbucketPushCredentials(appAuth)).toBe('a%20b:p%2Fw');
  });
});

describe('azure devops intake', () => {
  it('flattens work-item HTML into readable text', async () => {
    const { htmlToText } = await import('../src/azure-devops.js');
    expect(htmlToText('<p>First line</p><ul><li>one</li><li>two</li></ul>')).toBe(
      'First line\n- one\n- two',
    );
    expect(htmlToText('a &amp; b<br>c')).toBe('a & b\nc');
    expect(htmlToText('')).toBe('');
  });

  it('accepts a bare id or a fully qualified reference', async () => {
    const { parseWorkItemRef } = await import('../src/azure-devops.js');
    const config = { organization: 'envOrg', project: 'envProject', pat: 'x' };
    expect(parseWorkItemRef('1234', config)).toEqual({
      organization: 'envOrg',
      project: 'envProject',
      id: '1234',
    });
    expect(parseWorkItemRef('otherOrg/otherProject/99', config)).toEqual({
      organization: 'otherOrg',
      project: 'otherProject',
      id: '99',
    });
  });

  it('requires all three environment variables', async () => {
    const { azureDevOpsConfigFromEnv } = await import('../src/azure-devops.js');
    expect(azureDevOpsConfigFromEnv({ AZURE_DEVOPS_ORG: 'o' } as NodeJS.ProcessEnv)).toBeNull();
    expect(
      azureDevOpsConfigFromEnv({
        AZURE_DEVOPS_ORG: 'o',
        AZURE_DEVOPS_PROJECT: 'p',
        AZURE_DEVOPS_PAT: 't',
      } as NodeJS.ProcessEnv),
    ).toEqual({ organization: 'o', project: 'p', pat: 't' });
  });
});
