import Link from 'next/link';
import type { RunSummary } from '@/lib/api';
import { Stave, StatusMark } from '@/lib/ui';

export function RunsList({ runs }: { runs: RunSummary[] }) {
  return (
    <ul className="border-t border-rule">
      {runs.map((run) => (
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
  );
}
