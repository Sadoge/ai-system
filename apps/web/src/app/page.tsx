import Link from 'next/link';
import { apiGet, type RunSummary } from '@/lib/api';
import { startRunAction } from '@/lib/actions';
import { Section, StatusBadge, buttonCls, inputCls } from '@/lib/ui';

export default async function RunsPage() {
  const runs = await apiGet<RunSummary[]>('/runs');
  return (
    <main>
      <Section title="Start a run">
        <form action={startRunAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Ticket title</label>
            <input name="title" className={inputCls} placeholder="Add a multiply function" />
          </div>
          <div className="flex min-w-72 flex-1 flex-col gap-1">
            <label className="text-xs text-zinc-500">Description</label>
            <input name="description" className={inputCls} placeholder="What needs to happen" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">or Jira key</label>
            <input name="jiraKey" className={inputCls} placeholder="PROJ-123" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Pipeline</label>
            <select name="pipeline" className={inputCls} defaultValue="mvp">
              <option value="mvp">mvp</option>
              <option value="trivial">trivial</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Automation</label>
            <select name="automation" className={inputCls} defaultValue="plan_gated">
              <option value="plan_gated">plan_gated</option>
              <option value="autonomous">autonomous</option>
            </select>
          </div>
          <button type="submit" className={buttonCls}>
            Start
          </button>
        </form>
      </Section>

      <Section title={`Runs (${runs.length})`}>
        <div className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-900"
            >
              <StatusBadge status={run.status} />
              <span className="flex-1 truncate text-sm">{run.ticket.title}</span>
              <span className="font-mono text-xs text-zinc-500">
                {run.policySnapshot.pipeline}
                {run.complexity ? ` · ${run.complexity}` : ''}
                {run.currentStage ? ` · ${run.currentStage}` : ''}
              </span>
              <span className="text-xs text-zinc-600">
                {new Date(run.createdAt).toLocaleString()}
              </span>
            </Link>
          ))}
          {runs.length === 0 && (
            <p className="px-4 py-6 text-sm text-zinc-500">No runs yet — start one above.</p>
          )}
        </div>
      </Section>
    </main>
  );
}
