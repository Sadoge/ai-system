import {
  addAzureDevOpsComment,
  addJiraComment,
  addLinearComment,
  azureDevOpsConfigFromEnv,
  jiraConfigFromEnv,
  linearConfigFromEnv,
  transitionJiraIssue,
} from '@ai-system/integrations';
import type { TicketSnapshot } from '@ai-system/domain';

/**
 * Tracker write-back after a change request exists: a link comment, plus a Jira
 * status transition when the workflow offers one.
 *
 * Nothing in here may fail the package stage — the pull request is already open,
 * and a tracker outage must not turn a delivered change into a failed run.
 * Every call is therefore swallowed, and the outcome is reported back for the
 * artifact instead.
 */
export async function notifyTracker(
  ticket: TicketSnapshot,
  prUrl: string,
): Promise<{ tracker: string; commented: boolean; transitioned?: boolean } | null> {
  const message = `ai-system opened a pull request: ${prUrl}`;

  if (ticket.source === 'jira' && ticket.externalKey) {
    const jira = jiraConfigFromEnv();
    if (!jira) return null;
    const commented = await addJiraComment(jira, ticket.externalKey, message).then(
      () => true,
      () => false,
    );
    const targetStatus = process.env.JIRA_PR_STATUS;
    const transitioned = targetStatus
      ? await transitionJiraIssue(jira, ticket.externalKey, targetStatus).catch(() => false)
      : false;
    return { tracker: 'jira', commented, transitioned };
  }

  if (ticket.source === 'linear') {
    const linear = linearConfigFromEnv();
    const issueId = (ticket.raw as { id?: string } | undefined)?.id;
    if (!linear || !issueId) return null;
    const commented = await addLinearComment(linear, issueId, message).then(
      () => true,
      () => false,
    );
    return { tracker: 'linear', commented };
  }

  if (ticket.source === 'azure_devops' && ticket.externalKey) {
    const azure = azureDevOpsConfigFromEnv();
    if (!azure) return null;
    const raw = (ticket.raw ?? {}) as { organization?: string; project?: string };
    const commented = await addAzureDevOpsComment(
      azure,
      {
        organization: raw.organization ?? azure.organization,
        project: raw.project ?? azure.project,
        id: ticket.externalKey,
      },
      message,
    ).then(
      () => true,
      () => false,
    );
    return { tracker: 'azure_devops', commented };
  }

  return null;
}
