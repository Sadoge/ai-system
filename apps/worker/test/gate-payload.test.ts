import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@ai-system/db';
import { enrichGatePayload, evidenceKindFor } from '../src/gate-payload.js';

/** A drizzle select chain that resolves to `rows` at the end. */
function dbReturning(rows: Array<{ id: string }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } as unknown as Db, select };
}

const RUN_ID = '01936b00-0000-7000-8000-000000000001';
const ARTIFACT_ID = '01936b00-0000-7000-8000-0000000000a1';

describe('evidenceKindFor', () => {
  it('names the artifact a reviewer must read for every gate that ships one', () => {
    expect(evidenceKindFor('plan_approval')).toBe('implementation_plan');
    expect(evidenceKindFor('pre_merge')).toBe('integration_report');
    expect(evidenceKindFor('final_pr')).toBe('pr_package');
  });

  it('has no evidence for gates nothing requests yet', () => {
    // iteration_extension is resolvable by advance() but never requested by
    // any pipeline, so there is no artifact to attach.
    expect(evidenceKindFor('iteration_extension')).toBeNull();
    expect(evidenceKindFor('budget_top_up')).toBeNull();
  });
});

describe('enrichGatePayload', () => {
  it('attaches the latest matching artifact and preserves the existing payload', async () => {
    const { db } = dbReturning([{ id: ARTIFACT_ID }]);

    await expect(
      enrichGatePayload(db, RUN_ID, 'pre_merge', { reason: 'team pipeline' }),
    ).resolves.toEqual({
      reason: 'team pipeline',
      artifactId: ARTIFACT_ID,
      artifactKind: 'integration_report',
    });
  });

  it('returns the payload untouched when the run has no such artifact', async () => {
    const { db } = dbReturning([]);

    await expect(enrichGatePayload(db, RUN_ID, 'final_pr', { a: 1 })).resolves.toEqual({ a: 1 });
  });

  it('does not query at all for a gate with no evidence mapping', async () => {
    const { db, select } = dbReturning([{ id: ARTIFACT_ID }]);

    await expect(enrichGatePayload(db, RUN_ID, 'iteration_extension', {})).resolves.toEqual({});
    expect(select).not.toHaveBeenCalled();
  });
});
