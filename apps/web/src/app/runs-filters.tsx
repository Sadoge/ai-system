'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunSummary } from '@/lib/api';
import {
  RUN_STATUS_FILTERS,
  filterRuns,
  parseStatusParam,
  type RunStatusFilter,
} from '@/lib/run-filters';
import { RunsList } from './runs-list';

const STATUS_LABELS: Record<RunStatusFilter, string> = {
  all: 'All',
  running: 'Running',
  failed: 'Failed',
  completed: 'Completed',
};

export function RunsFilters({ runs }: { runs: RunSummary[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [status, setStatus] = useState<RunStatusFilter>(() =>
    parseStatusParam(searchParams.get('status')),
  );
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceFilterUrl = useCallback(
    (nextQuery: string, nextStatus: RunStatusFilter) => {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      if (nextStatus !== 'all') params.set('status', nextStatus);

      const queryString = params.toString();
      const nextUrl = `${pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl);
    },
    [pathname],
  );

  const scheduleUrlSync = useCallback(
    (nextQuery: string, nextStatus: RunStatusFilter, delay: number) => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);

      if (delay === 0) {
        urlTimerRef.current = null;
        replaceFilterUrl(nextQuery, nextStatus);
        return;
      }

      urlTimerRef.current = setTimeout(() => {
        urlTimerRef.current = null;
        replaceFilterUrl(nextQuery, nextStatus);
      }, delay);
    },
    [replaceFilterUrl],
  );

  useEffect(
    () => () => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    },
    [],
  );

  const visible = useMemo(() => filterRuns(runs, { query, status }), [query, runs, status]);
  const hasFilters = query.trim().length > 0 || status !== 'all';

  function selectStatus(nextStatus: RunStatusFilter) {
    setStatus(nextStatus);
    scheduleUrlSync(query, nextStatus, 0);
  }

  function clearFilters() {
    setQuery('');
    setStatus('all');
    scheduleUrlSync('', 'all', 0);
  }

  return (
    <>
      <div className="runs-filters mb-4">
        <label className="runs-filter-search">
          <span className="sr-only">Search runs by ticket title or key</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              scheduleUrlSync(nextQuery, status, 250);
            }}
            className="runs-search-input"
            placeholder="Search by ticket title or key…"
          />
        </label>

        <div className="runs-status-group" role="group" aria-label="Filter by status">
          {RUN_STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className="runs-status-button"
              aria-pressed={status === filter}
              onClick={() => selectStatus(filter)}
            >
              {STATUS_LABELS[filter]}
            </button>
          ))}
        </div>

        {hasFilters && (
          <button type="button" className="runs-clear-button" onClick={clearFilters}>
            Clear filters
          </button>
        )}

        <span className="runs-filter-count" role="status" aria-live="polite" aria-atomic="true">
          {hasFilters ? `${visible.length} of ${runs.length}` : runs.length}{' '}
          {runs.length === 1 ? 'run' : 'runs'}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-wrap items-center gap-4 border-y border-rule py-6">
          <p className="annot flex-1 text-sm text-ink-label">No runs match your filters.</p>
          <button type="button" className="runs-clear-button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <RunsList runs={visible} />
      )}
    </>
  );
}
