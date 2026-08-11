import { Suspense } from 'react';
import { apiGet, type RunSummary } from '@/lib/api';
import { startRunAction } from '@/lib/actions';
import { System, buttonCls, inputCls, selectCls } from '@/lib/ui';
import { RunsFilters } from './runs-filters';
import { RunsList } from './runs-list';

function Field({
  label,
  children,
  grow = false,
}: {
  label: string;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${grow ? 'min-w-64 flex-1' : ''}`}>
      <span className="annot text-xs text-ink-label">{label}</span>
      {children}
    </label>
  );
}

export default async function RunsPage() {
  const runs = await apiGet<RunSummary[]>('/runs');

  return (
    <main>
      <System mark="A" title="Call a run">
        <form action={startRunAction} className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <Field label="Ticket title">
            <input name="title" className={inputCls} placeholder="Add a multiply function" />
          </Field>
          <Field label="Description" grow>
            <input name="description" className={inputCls} placeholder="What needs to happen" />
          </Field>
          <Field label="or Jira key">
            <input name="jiraKey" className={`${inputCls} w-32`} placeholder="PROJ-123" />
          </Field>
          <Field label="Pipeline">
            <select name="pipeline" className={selectCls} defaultValue="mvp">
              <option value="mvp">mvp</option>
              <option value="team">team</option>
              <option value="trivial">trivial</option>
            </select>
          </Field>
          <Field label="Automation">
            <select name="automation" className={selectCls} defaultValue="plan_gated">
              <option value="plan_gated">plan_gated</option>
              <option value="autonomous">autonomous</option>
            </select>
          </Field>
          <button type="submit" className={buttonCls}>
            Begin
          </button>
        </form>
      </System>

      <System
        mark="B"
        title="Repertoire"
        aside={`${runs.length} run${runs.length === 1 ? '' : 's'}`}
      >
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
