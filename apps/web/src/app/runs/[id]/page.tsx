import Link from 'next/link';
import { apiGet, type RunDetail } from '@/lib/api';
import { resolveGateAction } from '@/lib/actions';
import {
  Caesura,
  Fermata,
  Notehead,
  SeverityMark,
  Stave,
  StatusMark,
  System,
  buttonCls,
  buttonDangerCls,
  inputCls,
  linkCls,
  readState,
} from '@/lib/ui';
import { LiveRefresh } from './live-refresh';

const TERMINAL = ['completed', 'failed', 'cancelled'];

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await apiGet<RunDetail>(`/runs/${id}`);
  const pendingGates = run.gates.filter((g) => g.status === 'pending');
  const doneTasks = run.tasks.filter((t) => t.status === 'completed').length;
  const terminal = TERMINAL.includes(run.status);

  return (
    <main>
      <LiveRefresh runId={id} active={!terminal} />

      {/* Programme head */}
      <div className="mb-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="min-w-0 flex-1 text-xl leading-snug text-ink">{run.ticket.title}</h1>
          <StatusMark status={run.status} />
        </div>
        <p className="mt-2 font-mono text-xs text-ink-faint tnum">
          {run.policySnapshot.pipeline} · {run.policySnapshot.automationLevel}
          {run.complexity ? ` · ${run.complexity}` : ''} · iteration {run.iterationCount} · $
          {run.costUsd.toFixed(4)}
        </p>
      </div>

      {run.error && (
        <p className="mb-8 border-l-2 border-mark py-1 pl-4 font-mono text-sm text-mark-bright">
          {run.error}
        </p>
      )}

      {/* The hold. Every voice waits here until a human marks it. */}
      {pendingGates.map((gate) => (
        <div key={gate.id} className="mb-8">
          <Caesura>
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Fermata className="shrink-0 text-mark" />
              <span className="annot text-base text-ink">Held for you</span>
              <span className="font-mono text-sm text-mark-bright">{gate.gate}</span>
              {typeof gate.payload.artifactId === 'string' && (
                <Link
                  href={`/runs/${run.id}/artifacts/${gate.payload.artifactId}`}
                  className={`${linkCls} text-sm`}
                >
                  read the {String(gate.payload.artifactKind ?? 'artifact')}
                </Link>
              )}
            </div>
            <form action={resolveGateAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="gateId" value={gate.id} />
              <label className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="annot text-xs text-ink-label">
                  Comment — required to reject
                </span>
                <input name="comment" className={inputCls} placeholder="Why" />
              </label>
              <button type="submit" name="decision" value="approved" className={buttonCls}>
                Approve
              </button>
              <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
                Reject
              </button>
            </form>
          </Caesura>
        </div>
      ))}

      {/* The score: stages crossing barlines, left to right. */}
      <System mark="A" title="The score" aside={terminal ? 'closed' : 'sounding'}>
        <div className="-mx-1 overflow-x-auto pb-1">
          <div className="stave flex min-w-max items-stretch">
            {run.stages.map((s, i) => {
              const { tone, head } = readState(s.status);
              const current = s.stage === run.currentStage;
              return (
                <div key={s.id} className="flex items-stretch">
                  {i > 0 && <span className={current ? 'barline-now' : 'barline'} aria-hidden />}
                  <div
                    className="flex flex-col items-center gap-2 px-4 py-3"
                    title={s.error ?? undefined}
                  >
                    <span
                      className={`stave-clear ${
                        tone === 'fault'
                          ? 'text-mark'
                          : tone === 'done'
                            ? 'text-ink-secondary'
                            : current
                              ? 'text-cue-bright pulse-live'
                              : 'text-ink-faint'
                      }`}
                    >
                      <Notehead head={head} />
                    </span>
                    <span
                      className={`font-mono text-[0.6875rem] whitespace-nowrap ${
                        current ? 'text-mark-bright' : 'text-ink-label'
                      }`}
                    >
                      {s.stage}
                    </span>
                  </div>
                </div>
              );
            })}
            {terminal && <span className="barline-final ml-1" aria-hidden />}
          </div>
        </div>
      </System>

      {/* Parallel voices: the team pipeline's concurrent agents. */}
      {run.tasks.length > 0 && (
        <System mark="B" title="Voices" aside={`${doneTasks}/${run.tasks.length} played`}>
          <ul className="border-t border-rule">
            {run.tasks.map((task) => {
              const deps = task.dependsOn
                .map((d) => run.tasks.find((t) => t.id === d)?.title ?? d.slice(-8))
                .join(', ');
              return (
                <li key={task.id} className="border-b border-rule">
                  <Stave className="px-3">
                    <span className="stave-clear shrink-0">
                      <StatusMark status={task.status} />
                    </span>
                    <span className="stave-clear min-w-0 flex-1 text-sm text-ink">
                      {task.title}
                      {deps && (
                        <span className="annot ml-2 text-xs text-ink-label">after {deps}</span>
                      )}
                      {task.error && (
                        <span className="ml-2 font-mono text-xs text-mark-bright">
                          {task.error}
                        </span>
                      )}
                    </span>
                    {task.origin === 'fix_iteration' && (
                      <span className="stave-clear annot shrink-0 text-xs text-hold-bright">
                        da capo
                      </span>
                    )}
                    {task.executorKind && (
                      <span className="stave-clear hidden shrink-0 font-mono text-xs text-ink-faint sm:inline">
                        {task.executorKind}
                      </span>
                    )}
                    <span className="stave-clear shrink-0 font-mono text-xs text-ink-faint tnum">
                      {task.attemptCount}/{task.maxAttempts}
                    </span>
                  </Stave>
                </li>
              );
            })}
          </ul>
        </System>
      )}

      {/* Editorial marks: what the reviewer wrote in the margin. */}
      {run.findings.length > 0 && (
        <System mark="C" title="Editorial marks" aside={`${run.findings.length}`}>
          <ul className="space-y-5">
            {run.findings.map((f) => (
              <li key={f.id} className="flex gap-4 border-l border-rule pl-4">
                <div className="w-28 shrink-0 pt-0.5">
                  <SeverityMark severity={f.severity} />
                  <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">{f.status}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{f.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </System>
      )}

      <System mark="D" title="Parts" aside={`${run.artifacts.length}`}>
        {run.artifacts.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            No parts written yet. They appear as the run produces them.
          </p>
        ) : (
          <ul className="border-t border-rule">
            {run.artifacts.map((a) => (
              <li key={a.id} className="border-b border-rule">
                <Link
                  href={`/runs/${run.id}/artifacts/${a.id}`}
                  className="flex items-center gap-4 px-3 py-2.5 text-sm hover:bg-ground-raised"
                >
                  <span className="font-mono text-cue-bright">{a.kind}</span>
                  <span className="ml-auto font-mono text-xs text-ink-faint tnum">
                    {new Date(a.createdAt).toLocaleTimeString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </System>
    </main>
  );
}
