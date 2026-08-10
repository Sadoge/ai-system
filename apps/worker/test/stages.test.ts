import { defaultMvpPolicy } from '@ai-system/domain';
import { describe, expect, it } from 'vitest';
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

  it.each(['failed', 'completed', 'awaiting_final_approval'] as const)(
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
