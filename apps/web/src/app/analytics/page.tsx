import { apiGet } from '@/lib/api';
import { Section } from '@/lib/ui';

interface CostPoint {
  day: string;
  provider: string;
  costUsd: number;
  calls: number;
}
interface PurposeCost {
  purpose: string;
  costUsd: number;
}
interface RunAnalytics {
  byStatus: {
    status: string;
    pipeline: string;
    count: number;
    avgIterations: number;
    avgMinutes: number;
  }[];
  successRate: number | null;
  finishedRuns: number;
}

/** Minimal inline bar — a chart library is not worth a dependency for this. */
function Bar({ value, max, label, right }: { value: number; max: number; label: string; right: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 truncate font-mono text-xs text-zinc-400">{label}</span>
      <span className="h-3 flex-1 rounded bg-zinc-900">
        <span className="block h-3 rounded bg-emerald-700" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-xs text-zinc-400">{right}</span>
    </div>
  );
}

export default async function AnalyticsPage() {
  const [cost, purposes, runs] = await Promise.all([
    apiGet<CostPoint[]>('/analytics/cost?days=30'),
    apiGet<PurposeCost[]>('/analytics/cost-by-purpose?days=30'),
    apiGet<RunAnalytics>('/analytics/runs?days=30'),
  ]);

  const byDay = new Map<string, number>();
  for (const point of cost) byDay.set(point.day, (byDay.get(point.day) ?? 0) + point.costUsd);
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(0, ...days.map(([, v]) => v));
  const total = days.reduce((n, [, v]) => n + v, 0);

  const byProvider = new Map<string, number>();
  for (const point of cost) {
    byProvider.set(point.provider, (byProvider.get(point.provider) ?? 0) + point.costUsd);
  }
  const providers = [...byProvider.entries()].sort(([, a], [, b]) => b - a);
  const maxPurpose = Math.max(0, ...purposes.map((p) => p.costUsd));

  return (
    <main>
      <Section title="Last 30 days">
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded border border-zinc-800 px-3 py-2">
            spend <span className="ml-2 font-mono text-emerald-400">${total.toFixed(4)}</span>
          </span>
          <span className="rounded border border-zinc-800 px-3 py-2">
            finished runs <span className="ml-2 font-mono text-zinc-300">{runs.finishedRuns}</span>
          </span>
          <span className="rounded border border-zinc-800 px-3 py-2">
            success rate{' '}
            <span className="ml-2 font-mono text-zinc-300">
              {runs.successRate === null ? '—' : `${Math.round(runs.successRate * 100)}%`}
            </span>
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Success rate counts only finished runs — counting in-flight ones would understate it.
        </p>
      </Section>

      <Section title="Daily spend">
        <div className="space-y-1">
          {days.map(([day, value]) => (
            <Bar key={day} label={day} value={value} max={maxDay} right={`$${value.toFixed(4)}`} />
          ))}
          {days.length === 0 && <p className="text-sm text-zinc-500">No model calls recorded yet.</p>}
        </div>
      </Section>

      <Section title="Spend by provider">
        <div className="space-y-1">
          {providers.map(([provider, value]) => (
            <Bar
              key={provider}
              label={provider}
              value={value}
              max={providers[0]?.[1] ?? 0}
              right={`$${value.toFixed(4)}`}
            />
          ))}
          {providers.length === 0 && <p className="text-sm text-zinc-500">Nothing yet.</p>}
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          CLI-driven work appears as <span className="font-mono">cli:&lt;agent&gt;</span> — the
          coding agent is usually the largest line, so leaving it out would make this chart lie.
        </p>
      </Section>

      <Section title="Spend by purpose">
        <div className="space-y-1">
          {purposes.map((p) => (
            <Bar
              key={p.purpose}
              label={p.purpose}
              value={p.costUsd}
              max={maxPurpose}
              right={`$${p.costUsd.toFixed(4)}`}
            />
          ))}
          {purposes.length === 0 && <p className="text-sm text-zinc-500">Nothing yet.</p>}
        </div>
      </Section>

      <Section title="Runs by outcome">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-1">status</th>
              <th>pipeline</th>
              <th className="text-right">runs</th>
              <th className="text-right">avg iterations</th>
              <th className="text-right">avg minutes</th>
            </tr>
          </thead>
          <tbody>
            {runs.byStatus.map((row) => (
              <tr key={`${row.status}-${row.pipeline}`} className="border-t border-zinc-900">
                <td className="py-1 font-mono text-xs">{row.status}</td>
                <td className="font-mono text-xs text-zinc-400">{row.pipeline}</td>
                <td className="text-right font-mono text-xs">{row.count}</td>
                <td className="text-right font-mono text-xs">{row.avgIterations.toFixed(1)}</td>
                <td className="text-right font-mono text-xs">{row.avgMinutes.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.byStatus.length === 0 && <p className="text-sm text-zinc-500">No runs in this window.</p>}
      </Section>
    </main>
  );
}
