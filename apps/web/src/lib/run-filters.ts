export type RunStatusFilter = 'all' | 'running' | 'failed' | 'completed';
type RunStatusBucket = Exclude<RunStatusFilter, 'all'>;

export const RUN_STATUS_FILTERS = ['all', 'running', 'failed', 'completed'] as const;

const STATUS_BUCKETS: Readonly<Record<string, RunStatusBucket | null>> = {
  created: 'running',
  classifying: 'running',
  awaiting_split: 'running',
  researching: 'running',
  planning: 'running',
  awaiting_plan_approval: 'running',
  decomposing: 'running',
  executing: 'running',
  integrating: 'running',
  awaiting_pre_merge: 'running',
  reviewing: 'running',
  testing: 'running',
  awaiting_iteration_gate: 'running',
  documenting: 'running',
  packaging: 'running',
  awaiting_final_approval: 'running',
  paused: 'running',
  completed: 'completed',
  failed: 'failed',
  // Cancelled is rendered as inert elsewhere in the UI, not as a failure.
  cancelled: null,
};

export function statusBucket(status: string): RunStatusBucket | null {
  return STATUS_BUCKETS[status] ?? null;
}

interface FilterableRun {
  status: string;
  ticket: {
    title: string | null | undefined;
    externalKey: string | null | undefined;
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
