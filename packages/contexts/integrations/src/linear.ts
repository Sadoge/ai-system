import { TicketSnapshot } from '@ai-system/domain';

export interface LinearConfig {
  apiKey: string;
}

export function linearConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LinearConfig | null {
  return env.LINEAR_API_KEY ? { apiKey: env.LINEAR_API_KEY } : null;
}

const LINEAR_API = 'https://api.linear.app/graphql';

async function linearQuery<T>(
  config: LinearConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { authorization: config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Linear API error ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Linear: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data) throw new Error('Linear: empty response');
  return body.data;
}

/**
 * Fetch an issue by identifier (e.g. ENG-123) into the platform's normalized
 * ticket shape. Linear descriptions are markdown already — no ADF flattening.
 */
export async function fetchLinearTicket(
  config: LinearConfig,
  identifier: string,
): Promise<TicketSnapshot> {
  const data = await linearQuery<{
    issue: { id: string; identifier: string; title: string; description?: string | null; labels?: { nodes: { name: string }[] } };
  }>(
    config,
    `query Issue($id: String!) {
      issue(id: $id) { id identifier title description labels { nodes { name } } }
    }`,
    { id: identifier },
  );
  return TicketSnapshot.parse({
    source: 'linear',
    externalKey: data.issue.identifier,
    title: data.issue.title,
    description: data.issue.description ?? '',
    labels: data.issue.labels?.nodes.map((n) => n.name) ?? [],
    raw: { id: data.issue.id },
  });
}

/** Write-back mirror of the Jira rule: a PR-link comment, nothing more. */
export async function addLinearComment(
  config: LinearConfig,
  issueId: string,
  body: string,
): Promise<void> {
  await linearQuery(
    config,
    `mutation Comment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body },
  );
}
