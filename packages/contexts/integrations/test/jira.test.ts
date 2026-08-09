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
