export function stageFailureDetail(reason: string): string {
  if (/stdout maxBuffer length exceeded/i.test(reason)) {
    return 'Git output exceeded the worker buffer';
  }
  return reason;
}

export function displayedAgentStatus(runStatus: string, agentStatus: string): string {
  return TERMINAL_RUN_STATUSES.has(runStatus) && agentStatus === 'running'
    ? 'stale record'
    : agentStatus;
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
