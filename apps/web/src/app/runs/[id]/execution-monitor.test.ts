import { describe, expect, it } from 'vitest';
import { stageFailureDetail } from './execution-monitor-copy';

describe('execution monitor failure copy', () => {
  it('translates the child-process buffer error into an operator-readable Git failure', () => {
    expect(stageFailureDetail('stdout maxBuffer length exceeded')).toBe(
      'Git output exceeded the worker buffer',
    );
  });

  it('preserves specific stage errors that do not have a friendlier explanation', () => {
    expect(stageFailureDetail('test command exited with status 2')).toBe(
      'test command exited with status 2',
    );
  });
});
