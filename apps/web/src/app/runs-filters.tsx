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
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const serializedSearchParams = searchParams.toString();
  const urlSyncReadyRef = useRef(false);

  const replaceFilterUrl = useCallback(
    (nextQuery: string, nextStatus: RunStatusFilter) => {
      const params = new URLSearchParams(window.location.search);
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      else params.delete('q');
      if (nextStatus !== 'all') params.set('status', nextStatus);
      else params.delete('status');

      const queryString = params.toString();
      const nextUrl = `${pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`;
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl);
    },
    [pathname],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!urlSyncReadyRef.current) {
      urlSyncReadyRef.current = true;
      return;
    }
    replaceFilterUrl(debouncedQuery, status);
  }, [debouncedQuery, replaceFilterUrl, status]);

  useEffect(() => {
    const currentParams = new URLSearchParams(serializedSearchParams);
    const urlQuery = currentParams.get('q') ?? '';
    const urlStatus = parseStatusParam(currentParams.get('status'));
    setQuery(urlQuery);
    setDebouncedQuery(urlQuery);
    setStatus(urlStatus);
  }, [serializedSearchParams]);

  const visible = useMemo(() => filterRuns(runs, { query, status }), [query, runs, status]);
  const hasFilters = query.trim().length > 0 || status !== 'all';

  function selectStatus(nextStatus: RunStatusFilter) {
    setStatus(nextStatus);
    replaceFilterUrl(debouncedQuery, nextStatus);
  }

  function clearFilters() {
    setQuery('');
    setDebouncedQuery('');
    setStatus('all');
    replaceFilterUrl('', 'all');
  }

  return (
    <>
      <div className="runs-filters mb-4">
        <label className="runs-filter-search">
          <span className="sr-only">Search runs by ticket title or key</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
