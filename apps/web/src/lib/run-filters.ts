import type { RunSummary } from './api';

export type RunStatusFilter = 'all' | 'running' | 'failed' | 'completed';
type RunStatusBucket = Exclude<RunStatusFilter, 'all'>;

export const RUN_STATUS_FILTERS = ['all', 'running', 'failed', 'completed'] as const;

const RUNNING_RUN_STATUSES = new Set([
  'created',
  'classifying',
  'awaiting_split',
  'researching',
  'planning',
  'awaiting_plan_approval',
  'decomposing',
  'executing',
  'integrating',
  'awaiting_pre_merge',
  'reviewing',
  'testing',
  'awaiting_iteration_gate',
  'documenting',
  'packaging',
  'awaiting_final_approval',
  'paused',
]);

export function statusBucket(status: string): RunStatusBucket | null {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  // Cancelled is rendered as inert elsewhere in the UI, not as a failure.
  if (status === 'cancelled') return null;
  return RUNNING_RUN_STATUSES.has(status) ? 'running' : null;
}

interface FilterableRun {
  status: string;
  ticket: {
    title: RunSummary['ticket']['title'] | null;
    externalKey?: RunSummary['ticket']['externalKey'] | null;
  };
}

export function filterRuns<T extends FilterableRun>(
  runs: T[],
  filters: { query: string; status: RunStatusFilter },
): T[] {
  const query = filters.query.trim().toLowerCase();

  return runs.filter((run) => {
    const matchesQuery =
      query.length === 0 ||
      (run.ticket.title ?? '').toLowerCase().includes(query) ||
      (run.ticket.externalKey ?? '').toLowerCase().includes(query);
    const matchesStatus = filters.status === 'all' || statusBucket(run.status) === filters.status;

    return matchesQuery && matchesStatus;
  });
}

export function parseStatusParam(value: string | null): RunStatusFilter {
  return RUN_STATUS_FILTERS.find((status) => status === value) ?? 'all';
}
