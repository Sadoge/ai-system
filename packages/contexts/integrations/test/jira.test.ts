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
