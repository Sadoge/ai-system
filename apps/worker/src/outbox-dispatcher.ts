import { asc, eq, isNull, sql } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { outbox, type Db } from '@ai-system/db';
import type { Logger } from 'pino';

const BATCH_SIZE = 25;

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
    private readonly intervalMs = 250,
  ) {}

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.drainOnce();
      } catch (err) {
        this.log.error({ err }, 'outbox dispatch failed');
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
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
        await this.boss.send(row.jobName, row.payload as object, {
          retryLimit: 3,
          retryDelay: 2,
          retryBackoff: true,
        });
        await tx
          .update(outbox)
          .set({ processedAt: new Date(), attempts: sql`${outbox.attempts} + 1` })
          .where(eq(outbox.id, row.id));
      }
      return pending.length;
    });
  }
}
