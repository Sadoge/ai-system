import { describe, expect, it } from 'vitest';
import { SUITE_METRICS, summarizeSuite, type EvalComparison, type RunMetrics } from '../src/eval.js';

function metrics(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    runId: '01936b00-0000-7000-8000-000000000001',
    status: 'completed',
    iterations: 0,
    findingsTotal: 0,
    findingsBlocking: 0,
    taskCount: 0,
    costUsd: 0,
    durationMinutes: 0,
    ...over,
  };
}

/** A settled comparison carrying the given deltas. */
function comparison(
  deltas: Partial<Record<(typeof SUITE_METRICS)[number], number>>,
  ready = true,
): EvalComparison {
  return {
    ready,
    source: metrics(),
    replay: metrics(),
    deltas: Object.fromEntries(SUITE_METRICS.map((m) => [m, deltas[m] ?? 0])),
  };
}

describe('summarizeSuite', () => {
  it('totals and averages every metric across settled replays', () => {
    const summary = summarizeSuite([
      comparison({ iterations: 1, findingsBlocking: 2, costUsd: 0.5 }),
      comparison({ iterations: -1, findingsBlocking: 4, costUsd: 1.5 }),
    ]);

    expect(summary.readyCount).toBe(2);
    expect(summary.totals.iterations).toBe(0);
    expect(summary.totals.findingsBlocking).toBe(6);
    expect(summary.totals.costUsd).toBe(2);
    expect(summary.means.findingsBlocking).toBe(3);
    expect(summary.means.costUsd).toBe(1);
  });

  it('counts in-flight replays without averaging them', () => {
    // A replay that is still moving would drag the mean toward numbers that
    // change under the reader — the same reason compareEvalRun exposes `ready`.
    const summary = summarizeSuite([
      comparison({ costUsd: 2 }),
      comparison({ costUsd: 100 }, false),
    ]);

    expect(summary.readyCount).toBe(1);
    expect(summary.pendingCount).toBe(1);
    expect(summary.totals.costUsd).toBe(2);
    expect(summary.means.costUsd).toBe(2);
  });

  it('counts members that have never been replayed as missing', () => {
    const summary = summarizeSuite([comparison({ iterations: 3 }), null, null]);

    expect(summary.missingCount).toBe(2);
    expect(summary.readyCount).toBe(1);
    expect(summary.means.iterations).toBe(3);
  });

  it('reports zeroes rather than dividing by zero for an empty suite', () => {
    const summary = summarizeSuite([]);

    expect(summary).toMatchObject({ readyCount: 0, pendingCount: 0, missingCount: 0 });
    for (const metric of SUITE_METRICS) {
      expect(summary.totals[metric]).toBe(0);
      expect(summary.means[metric]).toBe(0);
    }
  });

  it('reports zero means when every member is still pending', () => {
    const summary = summarizeSuite([comparison({ costUsd: 9 }, false), null]);

    expect(summary.means.costUsd).toBe(0);
    expect(summary.totals.costUsd).toBe(0);
  });
});
