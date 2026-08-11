import { Suspense } from 'react';
import { apiGet, type RunSummary } from '@/lib/api';
import type { RunFormProject } from '@/lib/run-form';
import { System } from '@/lib/ui';
import { StartRunForm } from './start-run-form';
import { RunsFilters } from './runs-filters';
import { RunsList } from './runs-list';

export default async function RunsPage() {
  const [runs, projectsResult] = await Promise.all([
    apiGet<RunSummary[]>('/runs'),
    apiGet<RunFormProject[]>('/projects')
      .then((projects) => ({ projects, error: undefined }))
      .catch((error: unknown) => ({
        projects: [],
        error:
          error instanceof Error
            ? `Projects could not be loaded: ${error.message}`
            : 'Projects could not be loaded. Check the API connection and reload the page.',
      })),
  ]);

  return (
    <main>
      <System mark="A" title="Call a run">
        <StartRunForm projects={projectsResult.projects} projectsError={projectsResult.error} />
      </System>

      <System mark="B" title="Repertoire" aside={`${runs.length} run${runs.length === 1 ? '' : 's'}`}>
        {runs.length === 0 ? (
          <p className="annot py-6 text-sm text-ink-label">
            Nothing has been called yet. Start one above and it appears here as a voice.
          </p>
        ) : (
          <Suspense fallback={<RunsList runs={runs} />}>
            <RunsFilters runs={runs} />
          </Suspense>
        )}
      </System>
    </main>
  );
}
