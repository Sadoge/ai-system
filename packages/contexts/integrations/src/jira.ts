import { TicketSnapshot } from '@ai-system/domain';

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export function jiraConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JiraConfig | null {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) return null;
  return { baseUrl: JIRA_BASE_URL.replace(/\/$/, ''), email: JIRA_EMAIL, apiToken: JIRA_API_TOKEN };
}

function authHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
}

interface JiraIssueResponse {
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    labels?: string[];
  };
}

/** Fetch a Jira issue and normalize it to the platform's TicketSnapshot. */
export async function fetchJiraTicket(config: JiraConfig, issueKey: string): Promise<TicketSnapshot> {
  const response = await fetch(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,labels`,
    { headers: { authorization: authHeader(config), accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(`Jira fetch failed for ${issueKey} (${response.status}): ${await response.text()}`);
  }
  const issue = (await response.json()) as JiraIssueResponse;
  return TicketSnapshot.parse({
    source: 'jira',
    externalKey: issue.key,
    title: issue.fields.summary,
    description: adfToText(issue.fields.description),
    labels: issue.fields.labels ?? [],
    raw: { key: issue.key },
  });
}

/** Post the PR link back to the ticket (the only Jira write-back in MVP scope, docs/10). */
export async function addJiraComment(
  config: JiraConfig,
  issueKey: string,
  text: string,
): Promise<void> {
  const response = await fetch(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    {
      method: 'POST',
      headers: {
        authorization: authHeader(config),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Jira comment failed for ${issueKey} (${response.status}): ${await response.text()}`);
  }
}

/**
 * Move the issue to a named status, matching case-insensitively against the
 * transitions Jira currently offers. Returns false when no such transition is
 * available — workflows differ per project, and a missing transition is a
 * configuration fact, not an error worth failing a run over.
 */
export async function transitionJiraIssue(
  config: JiraConfig,
  issueKey: string,
  statusName: string,
): Promise<boolean> {
  const listResponse = await fetch(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    { headers: { authorization: authHeader(config), accept: 'application/json' } },
  );
  if (!listResponse.ok) {
    throw new Error(`Jira transitions lookup failed for ${issueKey} (${listResponse.status})`);
  }
  const { transitions } = (await listResponse.json()) as {
    transitions: { id: string; name: string; to?: { name?: string } }[];
  };
  const wanted = statusName.trim().toLowerCase();
  const match = transitions.find(
    (t) => t.name.toLowerCase() === wanted || t.to?.name?.toLowerCase() === wanted,
  );
  if (!match) return false;

  const applyResponse = await fetch(
    `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: 'POST',
      headers: {
        authorization: authHeader(config),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: match.id } }),
    },
  );
  if (!applyResponse.ok) {
    throw new Error(
      `Jira transition to "${statusName}" failed for ${issueKey} (${applyResponse.status})`,
    );
  }
  return true;
}

/**
 * Flatten Atlassian Document Format to plain text — agents consume text, not
 * ADF. Handles the node types tickets actually contain; unknown nodes
 * contribute their children.
 */
export function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  if (typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content ?? []).map(adfToText).join('');
  switch (n.type) {
    case 'paragraph':
    case 'heading':
      return `${inner}\n`;
    case 'listItem':
      return `- ${inner}`;
    case 'bulletList':
    case 'orderedList':
    case 'codeBlock':
    case 'blockquote':
      return `${inner}\n`;
    default:
      return inner;
  }
}
