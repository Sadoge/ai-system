'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunSummary } from '@/lib/api';
import {
  RUN_STATUS_FILTERS,
  filterRuns,
  parseStatusParam,
  type RunStatusFilter,
} from '@/lib/run-filters';
import { Stave, StatusMark } from '@/lib/ui';

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
  const statusRef = useRef(status);
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceFilterUrl = useCallback(
    (nextQuery: string, nextStatus: RunStatusFilter) => {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      if (nextStatus !== 'all') params.set('status', nextStatus);
      window.history.replaceState(null, '', `${pathname}${params.size ? `?${params}` : ''}`);
    },
    [pathname],
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    urlTimerRef.current = setTimeout(() => {
      replaceFilterUrl(query, statusRef.current);
      urlTimerRef.current = null;
    }, 250);

    return () => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    };
  }, [query, replaceFilterUrl]);

  const visible = useMemo(() => filterRuns(runs, { query, status }), [query, runs, status]);
  const hasFilters = query.trim().length > 0 || status !== 'all';

  function selectStatus(nextStatus: RunStatusFilter) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    replaceFilterUrl(query, nextStatus);
  }

  function clearFilters() {
    if (urlTimerRef.current) {
      clearTimeout(urlTimerRef.current);
      urlTimerRef.current = null;
    }
    statusRef.current = 'all';
    setQuery('');
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
        <ul className="border-t border-rule">
          {visible.map((run) => (
            <li key={run.id} className="border-b border-rule">
              <Link href={`/runs/${run.id}`} className="block hover:bg-ground-raised">
                <Stave className="px-3">
                  <span className="stave-clear shrink-0">
                    <StatusMark status={run.status} />
                  </span>
                  <span className="stave-clear min-w-0 flex-1 truncate text-sm text-ink">
                    {run.ticket.title}
                  </span>
                  <span className="stave-clear shrink-0 font-mono text-xs text-ink-muted tnum">
                    {run.policySnapshot.pipeline}
                    {run.complexity ? ` · ${run.complexity}` : ''}
                    {run.currentStage ? ` · ${run.currentStage}` : ''}
                  </span>
                  <span className="stave-clear hidden shrink-0 font-mono text-xs text-ink-faint tnum sm:inline">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </span>
                </Stave>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
