import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, RETRY_BACKOFF_SECONDS, endpointWants } from '../src/index.js';

describe('endpointWants', () => {
  it('treats an empty filter as "everything"', () => {
    expect(endpointWants([], 'run.completed')).toBe(true);
  });

  it('matches exact names and dotted prefixes', () => {
    expect(endpointWants(['run.completed'], 'run.completed')).toBe(true);
    expect(endpointWants(['run.completed'], 'run.failed')).toBe(false);
    expect(endpointWants(['run.*'], 'run.failed')).toBe(true);
    expect(endpointWants(['run.*'], 'task.failed')).toBe(false);
    expect(endpointWants(['task.*', 'gate.*'], 'gate.requested')).toBe(true);
  });
});

describe('retry schedule', () => {
  it('is strictly increasing and bounds the attempt count', () => {
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_SECONDS.length);
    for (let i = 1; i < RETRY_BACKOFF_SECONDS.length; i++) {
      expect(RETRY_BACKOFF_SECONDS[i]!).toBeGreaterThan(RETRY_BACKOFF_SECONDS[i - 1]!);
    }
  });
});
