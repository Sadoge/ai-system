import type { RunDetail } from '@/lib/api';
import { Notehead, StatusMark, readState } from '@/lib/ui';

/**
 * The system: the run's own voice on the top stave, and the task voices
 * braced beneath it, all crossing one shared set of stage barlines.
 *
 * The page is divided the way an engraved score is. A left margin carries
 * the part names and their annotations; everything right of the margin rule
 * is plotted space, and a mark's horizontal position there means something.
 * Nothing but notation is placed inside the plotted span, so a label can
 * never be misread as a time position.
 *
 * The axis is real. Stage columns come from the run's own stage list. A task
 * voice is placed by its **dependency depth** — the earliest beat it could
 * sound, since a task cannot begin before the tasks it depends on have
 * finished — and depths are laid across the span of the pipeline in which
 * the team pipeline actually runs tasks. Voices at the same depth are
 * genuinely parallel and align vertically; a dependent sits later and is
 * joined to what it waited for by a tie. The API reports no per-task
 * timings, so duration is deliberately not drawn.
 */

const VOICE_ROW = 58;
const STAGE_ROW = 62;
const TIE_VIEW_W = 1000;
/** The engraved left margin that holds part names, outside plotted space. */
const LABEL_W = '12rem';

/** Earliest beat a task can sound: one past the deepest thing it waits on. */
function depths(tasks: RunDetail['tasks']): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0; // defensive: a cycle sounds at the downbeat
    seen.add(id);
    const deps = byId.get(id)?.dependsOn.filter((d) => byId.has(d)) ?? [];
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => walk(x, seen)));
    seen.delete(id);
    memo.set(id, d);
    return d;
  };
  for (const t of tasks) walk(t.id, new Set());
  return memo;
}

/** Position within the plotted span, measured from the margin rule. */
const plotted = (frac: number) => `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${frac})`;

function toneClass(tone: ReturnType<typeof readState>['tone'], current: boolean) {
  if (tone === 'fault') return 'text-mark-bright';
  if (tone === 'hold') return 'text-hold-bright';
  if (tone === 'live' || current) return 'pulse-live text-cue-bright';
  if (tone === 'done') return 'text-ink-secondary';
  return 'text-ink-faint';
}

export function RunSystem({ run }: { run: RunDetail }) {
  const stages = run.stages;
  const n = Math.max(stages.length, 1);
  const depth = depths(run.tasks);
  const beats = Math.max(1, Math.max(0, ...[...depth.values()]) + 1);

  const idxOf = (name: string) => stages.findIndex((s) => s.stage === name);
  const first = idxOf('decompose') >= 0 ? idxOf('decompose') : idxOf('code');
  const last = idxOf('integrate') >= 0 ? idxOf('integrate') : idxOf('code');
  const spanStart = first >= 0 ? first : 0;
  const spanEnd = last >= first && last >= 0 ? last + 1 : n;

  const stageFrac = (i: number) => (i + 0.5) / n;
  const beatFrac = (b: number) =>
    (spanStart + ((b + 0.5) / beats) * (spanEnd - spanStart)) / n;

  const ordered = [...run.tasks].sort(
    (a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0),
  );
  const rowOf = new Map(ordered.map((t, i) => [t.id, i]));
  const height = STAGE_ROW + ordered.length * VOICE_ROW;

  const ties = ordered.flatMap((task) =>
    task.dependsOn
      .filter((d) => rowOf.has(d))
      .map((d) => ({
        key: `${d}->${task.id}`,
        x1: beatFrac(depth.get(d) ?? 0) * TIE_VIEW_W,
        y1: STAGE_ROW + (rowOf.get(d)! + 0.5) * VOICE_ROW,
        x2: beatFrac(depth.get(task.id) ?? 0) * TIE_VIEW_W,
        y2: STAGE_ROW + (rowOf.get(task.id)! + 0.5) * VOICE_ROW,
      })),
  );

  return (
    <>
      {/* The engraved system. Decorative for assistive tech: the reading
          below carries the same facts in text. */}
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
                style={{ left: plotted(i / n), height }}
              />
            ),
          )}

          {/* The margin rule: left of it is the part list, right of it is
              plotted space where position carries meaning. */}
          <span
            className="absolute top-0 w-px bg-rule-strong"
            style={{ left: LABEL_W, height }}
          />

          {/* The run's own voice. */}
          <div className="absolute inset-x-0 top-0" style={{ height: STAGE_ROW }}>
            <div className="stave absolute inset-y-0" style={{ left: LABEL_W, right: 0 }} />
            <span
              className="annot absolute left-0 text-xs text-ink-label"
              style={{ top: STAGE_ROW / 2 - 8 }}
            >
              the run
            </span>
            {stages.map((s, i) => {
              const { tone, head } = readState(s.status);
              const current = s.stage === run.currentStage;
              return (
                <div
                  key={s.id}
                  className="absolute flex -translate-x-1/2 flex-col items-center gap-1.5"
                  style={{ left: plotted(stageFrac(i)), top: 10 }}
                  title={s.error ?? undefined}
                >
                  <span className={`stave-clear ${toneClass(tone, current)}`}>
                    <Notehead head={head} />
                  </span>
                  <span
                    className={`whitespace-nowrap font-mono text-micro ${
                      current ? 'text-mark-bright' : 'text-ink-label'
                    }`}
                  >
                    {s.stage}
                    {s.attempt > 1 ? ` #${s.attempt}` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* The brace joining the task voices into the system. */}
          {ordered.length > 0 && (
            <span
              className="absolute left-0 w-0.5 bg-rule-strong"
              style={{ top: STAGE_ROW, height: ordered.length * VOICE_ROW }}
            />
          )}

          {/* Task voices, one stave each. */}
          {ordered.map((task, row) => {
            const { tone, head } = readState(task.status);
            return (
              <div
                key={task.id}
                className="absolute inset-x-0"
                style={{ top: STAGE_ROW + row * VOICE_ROW, height: VOICE_ROW }}
              >
                <div className="stave absolute inset-y-0" style={{ left: LABEL_W, right: 0 }} />

                {/* Part name and its annotation, in the margin. */}
                <div
                  className="absolute left-2 top-1.5 pr-3"
                  style={{ width: `calc(${LABEL_W} - 0.5rem)` }}
                >
                  <p className="line-clamp-2 text-sm leading-tight text-ink" title={task.title}>
                    {task.title}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-micro text-ink-faint tnum">
                    {task.origin === 'fix_iteration' && (
                      <span className="annot mr-1.5 text-hold-bright">da capo</span>
                    )}
                    {task.executorKind ? `${task.executorKind} · ` : ''}
                    {task.attemptCount}/{task.maxAttempts}
                  </p>
                </div>

                <span
                  className={`stave-clear absolute -translate-x-1/2 ${toneClass(tone, false)}`}
                  style={{ left: plotted(beatFrac(depth.get(task.id) ?? 0)), top: VOICE_ROW / 2 - 6 }}
                >
                  <Notehead head={head} />
                </span>
              </div>
            );
          })}

          {/* Ties: a dependent is bound to what it waited for. Drawn inside
              plotted space only. */}
          {ties.length > 0 && (
            <svg
              className="pointer-events-none absolute top-0 text-rule-strong"
              style={{ left: LABEL_W, right: 0, height }}
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

      {/* The phone's reading: the same score, wrapped into successive systems
          the way a score breaks its lines at the margin. Also the accessible
          text equivalent of the engraved system at every width. */}
      <div className="sm:sr-only">
        {/* Each segment is its own fixed box so the ruling lands identically
            on every wrapped system and a barline can never outrun its own
            stave into the system below. */}
        <div className="flex flex-wrap items-start">
          {stages.map((s, i) => {
            const { tone, head } = readState(s.status);
            const current = s.stage === run.currentStage;
            return (
              <div key={s.id} className="stave-seg flex h-14 items-stretch">
                {/* A barline is bounded by the stave it crosses. Spanning the
                    whole box would close each wrapped system into a box. */}
                {i > 0 && (
                  <span
                    className={`${current ? 'barline-now' : 'barline'} h-[18px] self-center`}
                    aria-hidden
                  />
                )}
                <div className="flex min-w-[4.75rem] flex-col items-center justify-center gap-1.5 px-1.5">
                  <span className={`stave-clear ${toneClass(tone, current)}`} aria-hidden>
                    <Notehead head={head} />
                  </span>
                  {/* The label needs the same ground knockout the notehead
                      has, or the stave rules strike through it — and a struck
                      part name reads as cancelled. */}
                  <span
                    className={`stave-clear whitespace-nowrap font-mono text-micro ${
                      current ? 'text-mark-bright' : 'text-ink-label'
                    }`}
                  >
                    <span className="sr-only">{s.status} </span>
                    {s.stage}
                    {s.attempt > 1 ? ` #${s.attempt}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {ordered.length > 0 && (
          <ul className="mt-5 border-t border-rule">
            {ordered.map((task) => {
              const deps = task.dependsOn
                .map((d) => run.tasks.find((t) => t.id === d)?.title ?? d.slice(-8))
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
                  {deps && <p className="annot mt-0.5 text-xs text-ink-label">after {deps}</p>}
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
