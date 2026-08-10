import { asc, eq, isNull, sql } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { outbox, type Db } from '@ai-system/db';
import type { Logger } from 'pino';

const BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 250;

export interface OutboxDispatcherOptions {
  intervalMs?: number;
  /** Queue lease for agent-backed stage/task jobs. Must exceed the agent timeout. */
  longRunningExpireInSeconds?: number;
}

export function agentJobLeaseSeconds(
  timeoutMs: number,
  maxAttempts: number,
  graceMs: number,
): number {
  return Math.ceil((timeoutMs * Math.max(1, maxAttempts) + graceMs) / 1000);
}

export function jobOptionsFor(
  jobName: string,
  longRunningExpireInSeconds?: number,
): PgBoss.SendOptions {
  const longRunning = jobName === 'stage.execute' || jobName === 'task.execute';
  return {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    ...(longRunning && longRunningExpireInSeconds
      ? { expireInSeconds: longRunningExpireInSeconds }
      : {}),
  };
}

/**
 * Publishes outbox rows (written transactionally by the engine) to pg-boss.
 * At-least-once: a crash between send and mark re-sends the job, so every
 * job handler is idempotent (docs/04 §3).
 */
export class OutboxDispatcher {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly boss: PgBoss,
    private readonly log: Logger,
    private readonly options: OutboxDispatcherOptions = {},
  ) {}

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.drainOnce();
      } catch (err) {
        this.log.error({ err }, 'outbox dispatch failed');
      }
      if (!this.stopped)
        this.timer = setTimeout(tick, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async drainOnce(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const pending = await tx
        .select()
        .from(outbox)
        .where(isNull(outbox.processedAt))
        .orderBy(asc(outbox.createdAt))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      for (const row of pending) {
        await this.boss.send(
          row.jobName,
          row.payload as object,
          jobOptionsFor(row.jobName, this.options.longRunningExpireInSeconds),
        );
        await tx
          .update(outbox)
          .set({ processedAt: new Date(), attempts: sql`${outbox.attempts} + 1` })
          .where(eq(outbox.id, row.id));
      }
      return pending.length;
    });
  }
}
