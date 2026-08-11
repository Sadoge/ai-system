import Link from 'next/link';
import { apiGet, type RunSummary } from '@/lib/api';
import type { RunFormProject } from '@/lib/run-form';
import { Stave, StatusMark, System } from '@/lib/ui';
import { StartRunForm } from './start-run-form';

export default async function RunsPage() {
  const [runs, projects] = await Promise.all([
    apiGet<RunSummary[]>('/runs'),
    apiGet<RunFormProject[]>('/projects').catch(() => []),
  ]);

  return (
    <main>
      <System mark="A" title="Call a run">
        <StartRunForm projects={projects} />
      </System>

      <System mark="B" title="Repertoire" aside={`${runs.length} run${runs.length === 1 ? '' : 's'}`}>
        {runs.length === 0 ? (
          <p className="annot py-6 text-sm text-ink-label">
            Nothing has been called yet. Start one above and it appears here as a voice.
          </p>
        ) : (
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
        )}
      </System>
    </main>
  );
}
