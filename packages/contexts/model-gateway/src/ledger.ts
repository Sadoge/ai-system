import { and, eq, sql } from 'drizzle-orm';
import { modelCalls, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';

/**
 * `metered` calls cost real money through an API key. `subscription` calls go
 * through a signed-in Codex/Claude CLI and cost nothing — any USD on them is
 * zero or the CLI's own API-equivalent estimate, never a charge. Summing the
 * two would report money that was never spent, so they stay separable.
 */
export type BillingMode = 'metered' | 'subscription';

export interface LedgerEntry {
  runId?: string | undefined;
  agentRunId?: string | undefined;
  provider: string;
  model: string;
  purpose: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Defaults to `metered`: a call is only free if an adapter says so. */
  billing?: BillingMode | undefined;
  latencyMs: number;
  status: 'succeeded' | 'failed';
  error?: string | undefined;
}

/** The call ledger is core domain, not a proxy's log file (docs/09 §4). */
export interface CallLedger {
  record(entry: LedgerEntry): Promise<void>;
  spentUsd(runId: string): Promise<number>;
}

export class DrizzleCallLedger implements CallLedger {
  constructor(private readonly db: Db) {}

  async record(entry: LedgerEntry): Promise<void> {
    await this.db.insert(modelCalls).values({
      id: uuidv7(),
      runId: entry.runId ?? null,
      agentRunId: entry.agentRunId ?? null,
      provider: entry.provider,
      model: entry.model,
      purpose: entry.purpose,
      promptHash: entry.promptHash,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd: entry.costUsd.toFixed(6),
      billing: entry.billing ?? 'metered',
      latencyMs: entry.latencyMs,
      status: entry.status,
      error: entry.error ?? null,
    });
  }

  /**
   * Real money only. The budget guard exists to stop a run from spending more
   * than it was allowed, and a subscription call spends nothing — counting a
   * CLI's notional API-equivalent figure would pause runs over a charge that
   * never happened.
   */
  async spentUsd(runId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${modelCalls.costUsd}), 0)` })
      .from(modelCalls)
      .where(and(eq(modelCalls.runId, runId), eq(modelCalls.billing, 'metered')));
    return Number(rows[0]?.total ?? 0);
  }
}

export class InMemoryCallLedger implements CallLedger {
  readonly entries: LedgerEntry[] = [];

  async record(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async spentUsd(runId: string): Promise<number> {
    return this.entries
      .filter(
        (e) =>
          e.runId === runId && e.status === 'succeeded' && (e.billing ?? 'metered') === 'metered',
      )
      .reduce((sum, e) => sum + e.costUsd, 0);
  }
}
