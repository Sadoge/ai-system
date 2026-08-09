import { TicketSnapshot } from '@ai-system/domain';

export interface AzureDevOpsConfig {
  /** Azure DevOps Services organization (dev.azure.com/<org>). */
  organization: string;
  project: string;
  pat: string;
}

export function azureDevOpsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AzureDevOpsConfig | null {
  const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_PAT } = env;
  if (!AZURE_DEVOPS_ORG || !AZURE_DEVOPS_PROJECT || !AZURE_DEVOPS_PAT) return null;
  return { organization: AZURE_DEVOPS_ORG, project: AZURE_DEVOPS_PROJECT, pat: AZURE_DEVOPS_PAT };
}

const API_VERSION = '7.0';

function authHeader(config: AzureDevOpsConfig): string {
  // Azure DevOps PATs are used as the password of an empty-username basic pair.
  return `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`;
}

/**
 * Work-item fields are HTML, not markdown or ADF. Flatten to text the same way
 * `adfToText` does for Jira: block boundaries become newlines, list items get a
 * bullet, everything else is dropped rather than half-rendered.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|BR)\s*\/?>/g, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Accepts a bare work-item id ("1234") or a fully qualified "org/project/1234",
 * so a ticket reference copied out of a URL still resolves without reconfiguring
 * the environment.
 */
export function parseWorkItemRef(
  identifier: string,
  config: AzureDevOpsConfig,
): { organization: string; project: string; id: string } {
  const parts = identifier.split('/').filter(Boolean);
  if (parts.length >= 3) {
    return {
      organization: parts[parts.length - 3]!,
      project: parts[parts.length - 2]!,
      id: parts[parts.length - 1]!,
    };
  }
  return { organization: config.organization, project: config.project, id: parts[0] ?? identifier };
}

interface WorkItemResponse {
  id: number;
  fields: Record<string, unknown>;
}

export async function fetchAzureDevOpsTicket(
  config: AzureDevOpsConfig,
  identifier: string,
): Promise<TicketSnapshot> {
  const ref = parseWorkItemRef(identifier, config);
  const url = `https://dev.azure.com/${encodeURIComponent(ref.organization)}/${encodeURIComponent(
    ref.project,
  )}/_apis/wit/workitems/${encodeURIComponent(ref.id)}?api-version=${API_VERSION}`;
  const response = await fetch(url, { headers: { authorization: authHeader(config) } });
  if (!response.ok) {
    throw new Error(`Azure DevOps work item ${ref.id} failed (${response.status})`);
  }
  const data = (await response.json()) as WorkItemResponse;
  const field = (name: string): string => {
    const value = data.fields[name];
    return typeof value === 'string' ? value : '';
  };
  const acceptance = htmlToText(field('Microsoft.VSTS.Common.AcceptanceCriteria'))
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  const tags = field('System.Tags')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  return TicketSnapshot.parse({
    source: 'azure_devops',
    externalKey: String(data.id),
    title: field('System.Title') || `Work item ${data.id}`,
    description: htmlToText(field('System.Description')),
    acceptanceCriteria: acceptance,
    labels: tags,
    raw: {
      id: data.id,
      organization: ref.organization,
      project: ref.project,
      workItemType: field('System.WorkItemType'),
    },
  });
}

/** Write-back mirror of the Jira and Linear rule: a PR-link comment, nothing more. */
export async function addAzureDevOpsComment(
  config: AzureDevOpsConfig,
  ref: { organization: string; project: string; id: string },
  text: string,
): Promise<void> {
  const url = `https://dev.azure.com/${encodeURIComponent(ref.organization)}/${encodeURIComponent(
    ref.project,
  )}/_apis/wit/workItems/${encodeURIComponent(ref.id)}/comments?api-version=7.0-preview.3`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: authHeader(config), 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Azure DevOps comment failed (${response.status})`);
  }
}
