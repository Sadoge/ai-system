import { deliverPending, fanoutEvents } from '@ai-system/webhooks';
import type { Db } from '@ai-system/db';
import type { Logger } from 'pino';

/**
 * Runs the two halves of outbound delivery on a timer: tail domain events into
 * per-endpoint delivery rows, then send whatever is due.
 *
 * Kept out of pg-boss deliberately. Retries here are scheduled in the delivery
 * row itself (`next_attempt_at`), which is what the API and CLI display; moving
 * them into the job queue's retry machinery would put the schedule somewhere an
 * operator cannot see it.
 */
export class WebhookNotifier {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly intervalMs = 2_000,
  ) {}

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.runOnce();
      } catch (err) {
        this.log.error({ err }, 'webhook notifier tick failed');
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce(): Promise<void> {
    const fanout = await fanoutEvents(this.db);
    if (fanout.created > 0) this.log.info(fanout, 'webhook deliveries queued');
    const sent = await deliverPending(this.db);
    if (sent.attempted > 0) this.log.info(sent, 'webhook deliveries attempted');
  }
}
