const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-900 text-emerald-300',
  failed: 'bg-red-900 text-red-300',
  cancelled: 'bg-zinc-800 text-zinc-400',
  paused: 'bg-amber-900 text-amber-300',
};

export function StatusBadge({ status }: { status: string }) {
  const color = status.startsWith('awaiting_')
    ? 'bg-sky-900 text-sky-300'
    : (STATUS_COLORS[status] ?? 'bg-indigo-900 text-indigo-300');
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-xs ${color}`}>{status}</span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const color =
    severity === 'blocker' || severity === 'major'
      ? 'bg-red-900 text-red-300'
      : 'bg-zinc-800 text-zinc-400';
  return <span className={`rounded px-2 py-0.5 font-mono text-xs ${color}`}>{severity}</span>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

export const inputCls =
  'rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500';
export const buttonCls =
  'rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600';
export const buttonDangerCls =
  'rounded bg-red-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700';
