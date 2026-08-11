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

      <System mark="B" title="Repertoire">
        {runs.length === 0 ? (
          <p className="annot py-6 text-sm text-ink-label">
            Nothing has been called yet. Start one above and it appears here as a voice.
          </p>
        ) : (
          <ul className="border-t border-rule">
            {runs.map((run) => (
              <li key={run.id} className="border-b border-rule">
                <Link href={`/runs/${run.id}`} className="score-row block">
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
