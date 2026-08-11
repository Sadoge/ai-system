export type RunStatusFilter = 'all' | 'running' | 'failed' | 'completed';

export const RUN_STATUS_FILTERS = ['all', 'running', 'failed', 'completed'] as const;

const RUNNING_STATUSES = new Set([
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

export function statusBucket(status: string): RunStatusFilter | null {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (RUNNING_STATUSES.has(status)) return 'running';
  return null;
}

interface FilterableRun {
  status: string;
  ticket?: {
    title?: string | null;
    externalKey?: string | null;
  } | null;
}

export function filterRuns<T extends FilterableRun>(
  runs: T[],
  filters: { query: string; status: RunStatusFilter },
): T[] {
  const query = filters.query.trim().toLowerCase();

  return runs.filter((run) => {
    const matchesQuery =
      query.length === 0 ||
      (run.ticket?.title ?? '').toLowerCase().includes(query) ||
      (run.ticket?.externalKey ?? '').toLowerCase().includes(query);
    const matchesStatus = filters.status === 'all' || statusBucket(run.status) === filters.status;

    return matchesQuery && matchesStatus;
  });
}

export function parseStatusParam(value: string | null): RunStatusFilter {
  return RUN_STATUS_FILTERS.find((status) => status === value) ?? 'all';
}
