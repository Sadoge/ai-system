import { apiGet } from '@/lib/api';
import { Hairpin, System, formatTokens as tok } from '@/lib/ui';

interface CostPoint {
  day: string;
  provider: string;
  billing: 'metered' | 'subscription';
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}
interface PurposeCost {
  purpose: string;
  billing: 'metered' | 'subscription';
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}
interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  meteredUsd: number;
  notionalUsd: number;
}
interface UsageWindow {
  window: string;
  since: string;
  providers: {
    provider: string;
    billing: 'metered' | 'subscription';
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  totals: UsageTotals & { metered: UsageTotals; subscription: UsageTotals };
}

interface ContextEffectiveness {
  baselineFirstPassRate: number;
  baselineRuns: number;
  minSample: number;
  correlationOnly: boolean;
  rows: {
    sourceType: string;
    sourceId: string;
    title: string;
    section: string;
    settledRuns: number;
    firstPassRuns: number;
    firstPassRate: number;
    avgIterations: number;
  }[];
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

/**
 * Dynamics: a magnitude read along the stave. Quantity is drawn in bone,
 * never in a state colour — vermilion, cobalt and ochre mean something on
 * this surface, and a bar chart is not a state.
 */
function Dynamic({
  value,
  max,
  label,
  right,
}: {
  value: number;
  max: number;
  label: string;
  right: string;
}) {
  const pct = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="dynamic-row flex items-center gap-4">
      <span className="w-36 shrink-0 truncate font-mono text-xs text-ink-muted">{label}</span>
      <span className="h-2.5 flex-1 bg-ground-band">
        <span className="dynamic-fill block h-2.5" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-xs text-ink-muted tnum">{right}</span>
    </div>
  );
}

/** A ruled readout: the window's facts read along one line, barline-separated. */
function Readout({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-rule py-3">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-5">
          {i > 0 && <span className="barline h-7" aria-hidden />}
          <p className="flex items-baseline gap-2">
            <span className="annot text-xs text-ink-label">{item.label}</span>
            <span className="font-mono text-sm text-ink tnum">{item.value}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

export default async function AnalyticsPage() {
  const [cost, purposes, runs, context, windows] = await Promise.all([
    apiGet<CostPoint[]>('/analytics/cost?days=30'),
    apiGet<PurposeCost[]>('/analytics/cost-by-purpose?days=30'),
    apiGet<RunAnalytics>('/analytics/runs?days=30'),
    apiGet<ContextEffectiveness>('/analytics/context'),
    apiGet<UsageWindow[]>('/analytics/usage'),
  ]);

  // Tokens are the common denominator: a subscription call has no price, so a
  // chart drawn in dollars would render most of the work as nothing.
  const tokensOf = (r: { inputTokens: number; outputTokens: number }) =>
    r.inputTokens + r.outputTokens;

  const byDay = new Map<string, number>();
  for (const point of cost) byDay.set(point.day, (byDay.get(point.day) ?? 0) + tokensOf(point));
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const maxDay = Math.max(0, ...days.map(([, v]) => v));
  const totalTokens = days.reduce((n, [, v]) => n + v, 0);
  const meteredUsd = cost
    .filter((p) => p.billing === 'metered')
    .reduce((n, p) => n + p.costUsd, 0);
  const notionalUsd = cost
    .filter((p) => p.billing === 'subscription')
    .reduce((n, p) => n + p.costUsd, 0);

  const byProvider = new Map<string, number>();
  for (const point of cost) {
    byProvider.set(point.provider, (byProvider.get(point.provider) ?? 0) + tokensOf(point));
  }
  const providers = [...byProvider.entries()].sort(([, a], [, b]) => b - a);

  const byPurpose = new Map<string, number>();
  for (const p of purposes) byPurpose.set(p.purpose, (byPurpose.get(p.purpose) ?? 0) + tokensOf(p));
  const purposeRows = [...byPurpose.entries()].sort(([, a], [, b]) => b - a);
  const maxPurpose = Math.max(0, ...purposeRows.map(([, v]) => v));

  return (
    <main>
      <System mark="A" title="Last thirty days">
        <Readout
          items={[
            { label: 'tokens', value: tok(totalTokens) },
            { label: 'metered spend', value: `$${meteredUsd.toFixed(4)}` },
            { label: 'finished runs', value: String(runs.finishedRuns) },
            {
              label: 'success rate',
              value:
                runs.successRate === null ? '—' : `${Math.round(runs.successRate * 100)}%`,
            },
          ]}
        />
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          Success rate counts only finished runs — counting in-flight ones would understate it.
          Metered spend is money actually charged through an API key.
          {notionalUsd > 0 && (
            <>
              {' '}
              Work done on a Codex or Claude subscription costs nothing and is measured in tokens;
              the agent CLIs estimate it would have been{' '}
              <span className="font-mono not-italic">${notionalUsd.toFixed(2)}</span> at API rates,
              which is not a charge and is never added to spend.
            </>
          )}
        </p>
      </System>

      <System mark="B" title="Recent windows">
        <p className="annot mb-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          Subscription plans are enforced over rolling windows, so a burst is what gets you
          limited, not a monthly average. How much of the plan is left is not something any
          provider reports — this is consumption only.
        </p>
        <div className="space-y-1.5">
          {windows.map((w) => (
            <Dynamic
              key={w.window}
              label={`last ${w.window}`}
              value={w.totals.inputTokens + w.totals.outputTokens}
              max={Math.max(
                0,
                ...windows.map((x) => x.totals.inputTokens + x.totals.outputTokens),
              )}
              right={`${tok(w.totals.inputTokens + w.totals.outputTokens)} · ${w.totals.calls} calls`}
            />
          ))}
        </div>
      </System>

      <System mark="C" title="Daily tokens">
        {days.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">No model calls recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {days.map(([day, value]) => (
              <Dynamic key={day} label={day} value={value} max={maxDay} right={tok(value)} />
            ))}
          </div>
        )}
      </System>

      <System mark="D" title="Tokens by provider">
        {providers.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">Nothing yet.</p>
        ) : (
          <div className="space-y-1.5">
            {providers.map(([provider, value]) => (
              <Dynamic
                key={provider}
                label={provider}
                value={value}
                max={providers[0]?.[1] ?? 0}
                right={tok(value)}
              />
            ))}
          </div>
        )}
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          CLI-driven work appears as <span className="font-mono not-italic">cli:&lt;agent&gt;</span> —
          the coding agent is usually the largest line, so leaving it out would make this chart lie.
          Subscription-backed CLIs (
          <span className="font-mono not-italic">codex_cli</span>,{' '}
          <span className="font-mono not-italic">claude_cli</span>, and every{' '}
          <span className="font-mono not-italic">cli:</span> row) consume plan quota rather than
          money.
        </p>
      </System>

      <System mark="E" title="Tokens by purpose">
        {purposeRows.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">Nothing yet.</p>
        ) : (
          <div className="space-y-1.5">
            {purposeRows.map(([purpose, value]) => (
              <Dynamic
                key={purpose}
                label={purpose}
                value={value}
                max={maxPurpose}
                right={tok(value)}
              />
            ))}
          </div>
        )}
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          Which stage of a run is actually expensive. Coding is usually the largest by a wide
          margin.
        </p>
      </System>

      <System mark="F" title="Runs by outcome">
        {runs.byStatus.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">No runs in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left">
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">status</th>
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">pipeline</th>
                  <th className="annot py-1.5 pr-4 text-right font-normal text-ink-label">runs</th>
                  <th className="annot py-1.5 pr-4 text-right font-normal text-ink-label">
                    avg iterations
                  </th>
                  <th className="annot py-1.5 text-right font-normal text-ink-label">avg minutes</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs text-ink-secondary">
                {runs.byStatus.map((row) => (
                  <tr key={`${row.status}-${row.pipeline}`} className="border-b border-rule">
                    <td className="py-1.5 pr-4">{row.status}</td>
                    <td className="py-1.5 pr-4 text-ink-muted">{row.pipeline}</td>
                    <td className="py-1.5 pr-4 text-right tnum">{row.count}</td>
                    <td className="py-1.5 pr-4 text-right tnum">{row.avgIterations.toFixed(1)}</td>
                    <td className="py-1.5 text-right tnum">{row.avgMinutes.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </System>

      <System mark="G" title="Context effectiveness">
        <p className="annot mb-4 max-w-3xl text-sm leading-relaxed text-ink-label">
          How runs that received each piece of Brain context actually fared, against a baseline
          first-pass rate of{' '}
          <span className="font-mono not-italic text-ink-secondary tnum">
            {(context.baselineFirstPassRate * 100).toFixed(1)}%
          </span>{' '}
          over {context.baselineRuns} settled run(s). This is correlation, not cause: material is
          retrieved because it looks relevant, and the hardest tickets attract the most of it. Rows
          with fewer than {context.minSample} runs get no ranking prior and are marked with an
          asterisk; a hairpin shows whether a row sits above or below the baseline.
        </p>
        {context.rows.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            No context grants recorded yet — they accumulate as runs execute.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-2xl text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left">
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">material</th>
                  <th className="annot py-1.5 pr-4 font-normal text-ink-label">section</th>
                  <th className="annot py-1.5 pr-4 text-right font-normal text-ink-label">runs</th>
                  <th className="annot py-1.5 pr-4 text-right font-normal text-ink-label">
                    first pass
                  </th>
                  <th className="annot py-1.5 text-right font-normal text-ink-label">
                    avg iterations
                  </th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {context.rows.slice(0, 25).map((row) => {
                  const thin = row.settledRuns < context.minSample;
                  const better = row.firstPassRate > context.baselineFirstPassRate;
                  return (
                    <tr key={`${row.sourceType}-${row.sourceId}`} className="border-b border-rule">
                      <td className="max-w-md truncate py-1.5 pr-4 text-ink-secondary" title={row.title}>
                        {row.title}
                        <span className="ml-2 font-mono text-ink-faint">{row.sourceType}</span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-ink-muted">{row.section}</td>
                      <td className="py-1.5 pr-4 text-right font-mono text-ink-secondary tnum">
                        {row.settledRuns}
                      </td>
                      {/* Above or below baseline is drawn as a hairpin — the
                          world's own sign — not typed and not coloured. */}
                      <td
                        className={`py-1.5 pr-4 text-right font-mono tnum ${
                          thin ? 'text-ink-faint' : 'text-ink-secondary'
                        }`}
                      >
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {(row.firstPassRate * 100).toFixed(0)}%{thin ? '*' : ''}
                          {!thin && (
                            <Hairpin
                              direction={better ? 'cresc' : 'dim'}
                              className="shrink-0 text-ink-faint"
                            />
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono text-ink-secondary tnum">
                        {row.avgIterations.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </System>
    </main>
  );
}
