import { defaultMvpPolicy } from '@ai-system/domain';
import { describe, expect, it } from 'vitest';
import { shouldAnalyzeTestFailure } from '../src/mvp-stages.js';
import { shouldExecuteStage } from '../src/stages.js';

const policySnapshot = defaultMvpPolicy('autonomous');

describe('shouldExecuteStage', () => {
  it('accepts only the current stage in its active pipeline status', () => {
    expect(
      shouldExecuteStage({ currentStage: 'code', status: 'executing', policySnapshot }, 'code'),
    ).toBe(true);
    expect(
      shouldExecuteStage({ currentStage: 'plan', status: 'planning', policySnapshot }, 'plan'),
    ).toBe(true);
  });

  it.each(['failed', 'completed', 'cancelled', 'awaiting_final_approval'] as const)(
    'rejects a redelivery after the run became %s',
    (status) => {
      expect(shouldExecuteStage({ currentStage: 'code', status, policySnapshot }, 'code')).toBe(
        false,
      );
    },
  );

  it('rejects stale stages and mismatched active statuses', () => {
    expect(
      shouldExecuteStage({ currentStage: 'code', status: 'executing', policySnapshot }, 'review'),
    ).toBe(false);
    expect(
      shouldExecuteStage({ currentStage: 'plan', status: 'executing', policySnapshot }, 'plan'),
    ).toBe(false);
  });
});

describe('post-correction validation', () => {
  it('does not run another judgment pass over a successful test command', () => {
    expect(shouldAnalyzeTestFailure('pnpm test', true)).toBe(false);
  });

  it('uses the testing agent only to explain a real command failure', () => {
    expect(shouldAnalyzeTestFailure('pnpm test', false)).toBe(true);
    expect(shouldAnalyzeTestFailure(undefined, false)).toBe(false);
  });
});
