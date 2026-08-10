import type { RunDetail } from '@/lib/api';
import { Notehead, StatusMark, readState } from '@/lib/ui';

/**
 * The system: the run's own voice on the top stave, and the task voices
 * braced beneath it, all crossing one shared set of stage barlines.
 *
 * The horizontal axis is real. Stage columns come from the run's own stage
 * list. A task voice is placed by its **dependency depth** — the earliest
 * beat it could sound, since a task cannot begin before the tasks it depends
 * on have finished — and depths are laid across the span of the pipeline in
 * which the team pipeline actually runs tasks. Voices at the same depth are
 * genuinely parallel and align vertically; a dependent sits later and is
 * joined to what it waited for by a tie.
 *
 * Nothing here is positioned by anything the API does not report: the API
 * gives no per-task timings, so duration is deliberately not drawn.
 */

const VOICE_ROW = 46;
const STAGE_ROW = 62;
const TIE_VIEW_W = 1000;

/** Earliest beat a task can sound: one past the deepest thing it waits on. */
function depths(tasks: RunDetail['tasks']): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0; // defensive: a cycle sounds at the downbeat
    seen.add(id);
    const task = byId.get(id);
    const deps = task?.dependsOn.filter((d) => byId.has(d)) ?? [];
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => walk(x, seen)));
    seen.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const t of tasks) walk(t.id, new Set());
  return memo;
}

export function RunSystem({ run }: { run: RunDetail }) {
  const stages = run.stages;
  const n = Math.max(stages.length, 1);
  const tasks = run.tasks;
  const depth = depths(tasks);
  const beats = Math.max(1, Math.max(0, ...[...depth.values()]) + 1);

  // The span of the pipeline in which task voices actually sound. Falls back
  // to the whole width when the pipeline has no decompose/integrate pair.
  const idxOf = (name: string) => stages.findIndex((s) => s.stage === name);
  const first = idxOf('decompose') >= 0 ? idxOf('decompose') : idxOf('code');
  const last = idxOf('integrate') >= 0 ? idxOf('integrate') : idxOf('code');
  const spanStart = first >= 0 ? first : 0;
  const spanEnd = last >= first && last >= 0 ? last + 1 : n;

  const stageX = (i: number) => ((i + 0.5) / n) * 100;
  const beatX = (b: number) =>
    ((spanStart + ((b + 0.5) / beats) * (spanEnd - spanStart)) / n) * 100;

  const ordered = [...tasks].sort(
    (a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0),
  );
  const rowOf = new Map(ordered.map((t, i) => [t.id, i]));
  const height = STAGE_ROW + ordered.length * VOICE_ROW;

  const ties = ordered.flatMap((task) =>
    task.dependsOn
      .filter((d) => rowOf.has(d))
      .map((d) => ({
        key: `${d}->${task.id}`,
        x1: (beatX(depth.get(d) ?? 0) / 100) * TIE_VIEW_W,
        y1: STAGE_ROW + (rowOf.get(d)! + 0.5) * VOICE_ROW,
        x2: (beatX(depth.get(task.id) ?? 0) / 100) * TIE_VIEW_W,
        y2: STAGE_ROW + (rowOf.get(task.id)! + 0.5) * VOICE_ROW,
      })),
  );

  return (
    <>
      {/* The engraved system. Decorative for assistive tech: the compact
          reading below carries the same facts in text. */}
      <div className="hidden sm:block" aria-hidden>
        <div className="relative w-full" style={{ height }}>
          {/* Barlines cross every voice, which is what makes this one system. */}
          {stages.map((s, i) =>
            i === 0 ? null : (
              <span
                key={`bar-${s.id}`}
                className={`absolute top-0 ${
                  s.stage === run.currentStage ? 'barline-now' : 'barline'
                }`}
                style={{ left: `${(i / n) * 100}%`, height }}
              />
            ),
          )}

          {/* The run's own voice. */}
          <div className="absolute inset-x-0 top-0" style={{ height: STAGE_ROW }}>
            <div className="stave absolute inset-0" />
            {stages.map((s, i) => {
              const { tone, head } = readState(s.status);
              const current = s.stage === run.currentStage;
              return (
                <div
                  key={s.id}
                  className="absolute flex -translate-x-1/2 flex-col items-center gap-1.5"
                  style={{ left: `${stageX(i)}%`, top: 10 }}
                >
                  <span
                    className={`stave-clear ${
                      tone === 'fault'
                        ? 'text-mark-bright'
                        : tone === 'done'
                          ? 'text-ink-secondary'
                          : current
                            ? 'pulse-live text-cue-bright'
                            : 'text-ink-faint'
                    }`}
                  >
                    <Notehead head={head} />
                  </span>
                  <span
                    className={`whitespace-nowrap font-mono text-micro ${
                      current ? 'text-mark-bright' : 'text-ink-label'
                    }`}
                  >
                    {s.stage}
                  </span>
                </div>
              );
            })}
          </div>

          {/* The brace joining the task voices into the system. */}
          {ordered.length > 0 && (
            <span
              className="absolute left-0 w-px bg-rule-strong"
              style={{ top: STAGE_ROW, height: ordered.length * VOICE_ROW }}
            />
          )}

          {/* Task voices, one stave each. */}
          {ordered.map((task, row) => {
            const { tone, head } = readState(task.status);
            const b = depth.get(task.id) ?? 0;
            return (
              <div
                key={task.id}
                className="absolute inset-x-0"
                style={{ top: STAGE_ROW + row * VOICE_ROW, height: VOICE_ROW }}
              >
                <div className="stave absolute inset-0" />
                <span
                  className={`stave-clear absolute -translate-x-1/2 ${
                    tone === 'fault'
                      ? 'text-mark-bright'
                      : tone === 'live'
                        ? 'pulse-live text-cue-bright'
                        : tone === 'hold'
                          ? 'text-hold-bright'
                          : tone === 'done'
                            ? 'text-ink-secondary'
                            : 'text-ink-faint'
                  }`}
                  style={{ left: `${beatX(b)}%`, top: VOICE_ROW / 2 - 6 }}
                >
                  <Notehead head={head} />
                </span>
                {/* The part name, at the left margin where a score puts it. */}
                <span
                  className="stave-clear absolute left-2 max-w-[46%] truncate text-sm text-ink"
                  style={{ top: VOICE_ROW / 2 - 10 }}
                  title={task.title}
                >
                  {task.title}
                </span>
                <span
                  className="stave-clear absolute right-2 font-mono text-micro text-ink-faint tnum"
                  style={{ top: VOICE_ROW / 2 - 7 }}
                >
                  {task.origin === 'fix_iteration' && (
                    <span className="annot mr-2 text-hold-bright">da capo</span>
                  )}
                  {task.executorKind ? `${task.executorKind} · ` : ''}
                  {task.attemptCount}/{task.maxAttempts}
                </span>
              </div>
            );
          })}

          {/* Ties: a dependent is bound to what it waited for. */}
          {ties.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full text-rule-strong"
              viewBox={`0 0 ${TIE_VIEW_W} ${height}`}
              preserveAspectRatio="none"
            >
              {ties.map((t) => (
                <path
                  key={t.key}
                  d={`M ${t.x1} ${t.y1} Q ${(t.x1 + t.x2) / 2} ${(t.y1 + t.y2) / 2 + 14} ${t.x2} ${t.y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      {/* The compact reading. Visible on phones, and the accessible text
          equivalent of the engraved system at every width. */}
      <div className="sm:sr-only">
        <ul className="border-t border-rule">
          {stages.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 border-b border-rule px-1 py-1.5"
            >
              <StatusMark status={s.status} />
              <span className="font-mono text-xs text-ink-secondary">{s.stage}</span>
              {s.stage === run.currentStage && (
                <span className="annot ml-auto text-xs text-mark-bright">now</span>
              )}
            </li>
          ))}
        </ul>
        {ordered.length > 0 && (
          <ul className="mt-4 border-t border-rule">
            {ordered.map((task) => {
              const deps = task.dependsOn
                .map((d) => tasks.find((t) => t.id === d)?.title ?? d.slice(-8))
                .join(', ');
              return (
                <li key={task.id} className="border-b border-rule px-1 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusMark status={task.status} />
                    <span className="annot text-xs text-ink-label">
                      beat {(depth.get(task.id) ?? 0) + 1}
                    </span>
                    <span className="ml-auto font-mono text-micro text-ink-faint tnum">
                      {task.executorKind ? `${task.executorKind} · ` : ''}
                      {task.attemptCount}/{task.maxAttempts}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink">{task.title}</p>
                  {deps && (
                    <p className="annot mt-0.5 text-xs text-ink-label">after {deps}</p>
                  )}
                  {task.error && (
                    <p className="mt-0.5 font-mono text-xs text-mark-bright">{task.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
