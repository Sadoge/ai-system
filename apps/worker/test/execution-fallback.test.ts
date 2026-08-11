import { describe, expect, it } from 'vitest';
import { shouldTryExecutorFallback } from '../src/execution-fallback.js';

describe('shouldTryExecutorFallback', () => {
  it.each([
    'timeout',
    'cancelled',
    'invalid_output',
    'model_error',
    'rate_limited',
    'sandbox_error',
  ] as const)('allows another provider/model after %s', (reason) => {
    expect(shouldTryExecutorFallback(reason)).toBe(true);
  });

  it('does not bypass a frozen run budget', () => {
    expect(shouldTryExecutorFallback('budget_denied')).toBe(false);
  });
});
