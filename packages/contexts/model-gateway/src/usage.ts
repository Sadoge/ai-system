import type { BillingMode } from './ledger.js';

/**
 * Usage reporting for a platform that mostly does not pay per call.
 *
 * When the agents run on signed-in Codex and Claude CLIs, a USD total is not
 * just uninformative, it is wrong: metered calls cost real money, subscription
 * calls consume plan quota, and adding them together reports a charge nobody
 * received. So every total here stays split by billing mode, and subscription
 * usage is denominated in tokens.
 *
 * What this deliberately does NOT do is express usage as a fraction of a
 * limit. No provider exposes remaining subscription quota, so a percentage
 * would be invented. Consumption is reported; headroom is not.
 */

export interface UsageRow {
  provider: string;
  billing: BillingMode;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Real money, from metered calls only. */
  meteredUsd: number;
  /**
   * What subscription calls would have cost at API rates, where the CLI
   * reported it. Never money that was charged — display it as an estimate or
   * not at all, but never add it to `meteredUsd`.
   */
  notionalUsd: number;
}

export interface UsageBreakdown extends UsageTotals {
  metered: UsageTotals;
  subscription: UsageTotals;
}

function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, meteredUsd: 0, notionalUsd: 0 };
}

function add(into: UsageTotals, row: UsageRow): void {
  into.calls += row.calls;
  into.inputTokens += row.inputTokens;
  into.outputTokens += row.outputTokens;
  if (row.billing === 'metered') into.meteredUsd += row.costUsd;
  else into.notionalUsd += row.costUsd;
}

/**
 * Fold ledger rows into combined totals plus the two billing modes separately.
 * Token counts are meaningful across both; the two USD figures never merge.
 */
export function summarizeUsage(rows: readonly UsageRow[]): UsageBreakdown {
  const combined = emptyTotals();
  const metered = emptyTotals();
  const subscription = emptyTotals();

  for (const row of rows) {
    add(combined, row);
    add(row.billing === 'metered' ? metered : subscription, row);
  }

  return { ...combined, metered, subscription };
}

/**
 * The windows subscription limits are actually enforced over: Codex and Claude
 * plans reset on a rolling multi-hour basis with a longer weekly cap, so a
 * daily average hides the burst that gets you rate-limited.
 */
export const USAGE_WINDOWS = [
  { label: '5h', ms: 5 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export type UsageWindowLabel = (typeof USAGE_WINDOWS)[number]['label'];

export interface UsageWindow {
  window: UsageWindowLabel;
  since: string;
  providers: UsageRow[];
  totals: UsageBreakdown;
}
