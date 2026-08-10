/**
 * Conductor's Score — the shared notation vocabulary.
 *
 * State is read the way a score is read: a notehead says what a voice is
 * doing, and the conductor's vermilion pencil says where a human has to
 * act. Vermilion filled means "you decide"; vermilion stroked means
 * "this failed". Nothing else in the system is allowed to use that colour.
 */

export type Tone = 'await' | 'fault' | 'live' | 'done' | 'hold' | 'inert';

interface StateRead {
  tone: Tone;
  /** How the voice is drawn on the stave. */
  head: 'filled' | 'hollow' | 'cross' | 'rest';
}

export function readState(status: string): StateRead {
  if (status.startsWith('awaiting_') || status === 'pending') {
    return { tone: 'await', head: 'hollow' };
  }
  switch (status) {
    case 'completed':
    case 'approved':
    case 'active':
      return { tone: 'done', head: 'filled' };
    case 'failed':
    case 'rejected':
    case 'blocker':
    case 'major':
      return { tone: 'fault', head: 'cross' };
    case 'paused':
      return { tone: 'hold', head: 'hollow' };
    case 'cancelled':
    case 'superseded':
      return { tone: 'inert', head: 'rest' };
    case 'running':
    case 'in_progress':
      return { tone: 'live', head: 'hollow' };
    default:
      return { tone: 'inert', head: 'hollow' };
  }
}

const TONE_TEXT: Record<Tone, string> = {
  await: 'text-mark',
  fault: 'text-mark',
  live: 'text-cue-bright',
  done: 'text-ink-muted',
  hold: 'text-hold-bright',
  inert: 'text-ink-faint',
};

/** A notehead. Filled = played, hollow = sounding, cross = dead, rest = silent. */
export function Notehead({ head, className = '' }: { head: StateRead['head']; className?: string }) {
  const common = { width: 11, height: 11, viewBox: '0 0 11 11', 'aria-hidden': true } as const;
  if (head === 'rest') {
    return (
      <svg {...common} className={className}>
        <rect x="1.5" y="4" width="8" height="3" fill="currentColor" />
      </svg>
    );
  }
  if (head === 'cross') {
    return (
      <svg {...common} className={className}>
        <path d="M1.7 1.7 9.3 9.3M9.3 1.7 1.7 9.3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg {...common} className={className}>
      <ellipse
        cx="5.5"
        cy="5.5"
        rx="4.4"
        ry="3.4"
        transform="rotate(-20 5.5 5.5)"
        fill={head === 'filled' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={head === 'filled' ? 0 : 1.7}
      />
    </svg>
  );
}

/** The fermata: hold this until released. Marks anything waiting on a human. */
export function Fermata({ className = '' }: { className?: string }) {
  return (
    <svg width="18" height="11" viewBox="0 0 18 11" aria-hidden className={className}>
      <path d="M1 10a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="7.2" r="1.7" fill="currentColor" />
    </svg>
  );
}

/**
 * The state of a whole record, read at a glance: notehead plus the name the
 * platform uses. Awaiting-human is the only state drawn filled, because it
 * is the only one asking for something.
 */
export function StatusMark({ status, className = '' }: { status: string; className?: string }) {
  const { tone, head } = readState(status);
  if (tone === 'await') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-mark px-2 py-0.5 font-mono text-xs text-ground ${className}`}
      >
        <Fermata className="shrink-0" />
        {status}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs ${TONE_TEXT[tone]} ${className}`}
    >
      <Notehead head={head} className="shrink-0" />
      {status}
    </span>
  );
}

/** Severity of an editorial mark in the margin. */
export function SeverityMark({ severity }: { severity: string }) {
  const heavy = severity === 'blocker' || severity === 'major';
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs ${heavy ? 'text-mark' : 'text-ink-faint'}`}
    >
      <Notehead head={heavy ? 'cross' : 'filled'} className="shrink-0" />
      {severity}
    </span>
  );
}

/** The boxed letter a conductor calls out to restart from. */
export function RehearsalMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="rehearsal shrink-0 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-ink-label">
      {children}
    </span>
  );
}

/**
 * A system: one movement of the page, opened by its rehearsal mark. The
 * rule runs to the right edge so the eye is carried across, the way a
 * system brace carries across a score.
 */
export function System({
  mark,
  title,
  aside,
  children,
}: {
  mark: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <header className="mb-4 flex items-center gap-3">
        <RehearsalMark>{mark}</RehearsalMark>
        <h2 className="annot text-base text-ink-secondary">{title}</h2>
        <span className="h-px flex-1 bg-rule" />
        {aside && <span className="shrink-0 font-mono text-xs text-ink-faint tnum">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** Where the score holds for a human. The only element allowed to interrupt. */
export function Caesura({ children }: { children: React.ReactNode }) {
  return <div className="caesura px-4 py-4 sm:px-5">{children}</div>;
}

/** A voice laid on ruled staves. Content clears the rules so type stays crisp. */
export function Stave({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`stave flex items-center gap-3 py-2.5 ${className}`}>{children}</div>;
}

export const inputCls =
  'border-b border-rule-strong bg-transparent px-1 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-cue focus:outline-none';

/** The mark you make: the affirmative action, drawn as the conductor's stroke. */
export const buttonCls =
  'border border-cue-deep bg-cue-deep px-3 py-1.5 font-mono text-sm text-ink hover:bg-cue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';

export const buttonDangerCls =
  'border border-mark bg-transparent px-3 py-1.5 font-mono text-sm text-mark hover:bg-mark hover:text-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mark-bright';

export const linkCls = 'text-cue-bright underline decoration-rule-strong underline-offset-2 hover:decoration-cue';
