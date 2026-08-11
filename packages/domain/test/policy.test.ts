import { describe, expect, it } from 'vitest';
import {
  COMPLEXITY_POLICY,
  MAX_CORRECTION_ITERATIONS,
  defaultMvpPolicy,
  defaultTeamPolicy,
} from '../src/policy.js';

describe('correction policy', () => {
  it('caps every non-trivial pipeline and complexity at one correction', () => {
    expect(MAX_CORRECTION_ITERATIONS).toBe(1);
    expect(defaultMvpPolicy().iterationBudget).toBe(1);
    expect(defaultTeamPolicy().iterationBudget).toBe(1);
    expect(Object.values(COMPLEXITY_POLICY).map((policy) => policy.iterationBudget)).toEqual([
      1, 1, 1, 1,
    ]);
  });
});
