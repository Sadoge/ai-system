import Link from 'next/link';
import { apiGet, type RunDetail } from '@/lib/api';
import { resolveGateAction } from '@/lib/actions';
import { Section, SeverityBadge, StatusBadge, buttonCls, buttonDangerCls, inputCls } from '@/lib/ui';
import { LiveRefresh } from './live-refresh';

const TERMINAL = ['completed', 'failed', 'cancelled'];

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await apiGet<RunDetail>(`/runs/${id}`);
  const pendingGates = run.gates.filter((g) => g.status === 'pending');

  return (
    <main>
      <LiveRefresh runId={id} active={!TERMINAL.includes(run.status)} />

      <div className="mb-6 flex items-center gap-4">
        <StatusBadge status={run.status} />
        <h1 className="flex-1 text-lg font-semibold">{run.ticket.title}</h1>
        <span className="font-mono text-xs text-zinc-500">
          {run.policySnapshot.pipeline} · {run.policySnapshot.automationLevel}
          {run.complexity ? ` · ${run.complexity}` : ''} · iter {run.iterationCount} · $
          {run.costUsd.toFixed(4)}
        </span>
      </div>
      {run.error && (
        <p className="mb-6 rounded border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">
          {run.error}
        </p>
      )}

      {pendingGates.map((gate) => (
        <div key={gate.id} className="mb-6 rounded border border-sky-800 bg-sky-950 p-4">
          <p className="mb-3 text-sm font-medium text-sky-200">
            Human gate: <span className="font-mono">{gate.gate}</span>
            {typeof gate.payload.artifactId === 'string' && (
              <>
                {' — '}
                <Link
                  href={`/runs/${run.id}/artifacts/${gate.payload.artifactId}`}
                  className="underline"
                >
                  view {String(gate.payload.artifactKind ?? 'artifact')}
                </Link>
              </>
            )}
          </p>
          <form action={resolveGateAction} className="flex items-center gap-3">
            <input type="hidden" name="gateId" value={gate.id} />
            <input name="comment" className={`${inputCls} flex-1`} placeholder="Comment (required for reject)" />
            <button type="submit" name="decision" value="approved" className={buttonCls}>
              Approve
            </button>
            <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
              Reject
            </button>
          </form>
        </div>
      ))}

      <Section title="Stages">
        <div className="flex flex-wrap gap-2">
          {run.stages.map((s) => (
            <span
              key={s.id}
              title={s.error ?? undefined}
              className={`rounded px-2 py-1 font-mono text-xs ${
                s.status === 'completed'
                  ? 'bg-emerald-950 text-emerald-400'
                  : s.status === 'failed'
                    ? 'bg-red-950 text-red-400'
                    : 'bg-zinc-900 text-zinc-300'
              }`}
            >
              {s.stage} · {s.status}
            </span>
          ))}
        </div>
      </Section>

      {run.findings.length > 0 && (
        <Section title="Review findings">
          <ul className="space-y-2">
            {run.findings.map((f) => (
              <li key={f.id} className="rounded border border-zinc-800 px-4 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-medium">{f.title}</span>
                  <span className="ml-auto font-mono text-xs text-zinc-500">{f.status}</span>
                </div>
                <p className="mt-1 text-zinc-400">{f.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Artifacts">
        <div className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {run.artifacts.map((a) => (
            <Link
              key={a.id}
              href={`/runs/${run.id}/artifacts/${a.id}`}
              className="flex items-center gap-4 px-4 py-2 text-sm hover:bg-zinc-900"
            >
              <span className="font-mono text-emerald-400">{a.kind}</span>
              <span className="ml-auto text-xs text-zinc-600">
                {new Date(a.createdAt).toLocaleTimeString()}
              </span>
            </Link>
          ))}
        </div>
      </Section>
    </main>
  );
}
