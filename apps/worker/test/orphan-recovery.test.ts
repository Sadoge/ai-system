import { describe, expect, it, vi } from 'vitest';
import type { createPool } from '@ai-system/db';
import type { Logger } from 'pino';
import {
  DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS,
  recoverOrphanedAgentJobs,
} from '../src/orphan-recovery.js';

type Pool = ReturnType<typeof createPool>;

function harness(rows: Array<Record<string, unknown>> = []) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [], rowCount: null })
    .mockResolvedValueOnce({ rows, rowCount: rows.length })
    .mockResolvedValueOnce({ rows: [], rowCount: null });
  const release = vi.fn();
  const pool = {
    connect: vi.fn().mockResolvedValue({ query, release }),
  } as unknown as Pool;
  const log = { warn: vi.fn() } as unknown as Logger;
  return { pool, log, query, release };
}

describe('recoverOrphanedAgentJobs', () => {
  it('reactivates stale jobs transactionally and reports each recovery', async () => {
    const recovered = {
      job_id: 'job-1',
      job_name: 'task.execute',
      agent_run_id: 'agent-1',
      run_id: 'run-1',
      task_id: 'task-1',
    };
    const { pool, log, query, release } = harness([recovered]);

    await expect(recoverOrphanedAgentJobs(pool, log)).resolves.toBe(1);

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query.mock.calls[1]?.[1]).toEqual([DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS]);
    expect(query).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', agentRunId: 'agent-1' }),
      'recovered orphaned agent job',
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the connection when recovery fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;
    const log = { warn: vi.fn() } as unknown as Logger;

    await expect(recoverOrphanedAgentJobs(pool, log, 120_000)).rejects.toThrow(
      'database unavailable',
    );

    expect(query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
