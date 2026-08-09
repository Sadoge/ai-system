import { eq, sql } from 'drizzle-orm';
import { modelCalls, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';

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
      latencyMs: entry.latencyMs,
      status: entry.status,
      error: entry.error ?? null,
    });
  }

  async spentUsd(runId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${modelCalls.costUsd}), 0)` })
      .from(modelCalls)
      .where(eq(modelCalls.runId, runId));
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
      .filter((e) => e.runId === runId && e.status === 'succeeded')
      .reduce((sum, e) => sum + e.costUsd, 0);
  }
}
