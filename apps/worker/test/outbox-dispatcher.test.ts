import { describe, expect, it } from 'vitest';
import { agentJobLeaseSeconds, jobOptionsFor } from '../src/outbox-dispatcher.js';

describe('jobOptionsFor', () => {
  it.each(['stage.execute', 'task.execute'])('extends the lease for %s', (jobName) => {
    expect(jobOptionsFor(jobName, 3_000)).toMatchObject({
      expireInSeconds: 3_000,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
    });
  });

  it('does not give short control jobs an agent-sized lease', () => {
    expect(jobOptionsFor('gate.request', 3_000)).not.toHaveProperty('expireInSeconds');
  });
});

describe('agentJobLeaseSeconds', () => {
  it('covers every fallback timeout plus shutdown grace', () => {
    expect(agentJobLeaseSeconds(45 * 60_000, 3, 5 * 60_000)).toBe(140 * 60);
  });
});
