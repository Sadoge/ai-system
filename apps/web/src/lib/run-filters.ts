export type RunStatusFilter = 'all' | 'running' | 'failed' | 'completed';
type RunStatusBucket = Exclude<RunStatusFilter, 'all'>;

export const RUN_STATUS_FILTERS = ['all', 'running', 'failed', 'completed'] as const;

export function statusBucket(status: string): RunStatusBucket | null {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  // Cancelled is rendered as inert elsewhere in the UI, not as a failure.
  if (status === 'cancelled') return null;

  // The domain has only three terminal statuses. Treat new statuses as
  // non-terminal so a future pipeline stage remains visible under Running.
  return 'running';
}

interface FilterableRun {
  status: string;
  ticket: {
    title?: string | null;
    externalKey?: string | null;
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
