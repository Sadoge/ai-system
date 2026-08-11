import type { createPool } from '@ai-system/db';
import type { Logger } from 'pino';

type Pool = ReturnType<typeof createPool>;

export const DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS = 90_000;

interface RecoveredJob {
  job_id: string;
  job_name: string;
  agent_run_id: string;
  run_id: string;
  task_id: string | null;
  stage: string;
}

/**
 * Reactivate queue jobs whose CLI process disappeared with a previous worker.
 *
 * CLI executors persist a heartbeat every 15 seconds. A healthy executor on
 * another worker therefore remains outside this query. The queue reset, stale
 * agent settlement, and audit event are one transaction so a restart cannot
 * leave only half of the recovery visible.
 */
export async function recoverOrphanedAgentJobs(
  pool: Pool,
  log: Logger,
  heartbeatGraceMs = DEFAULT_ORPHAN_HEARTBEAT_GRACE_MS,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const recovered = await client.query<RecoveredJob>(
      `WITH stale AS MATERIALIZED (
         SELECT
           job.id AS job_id,
           job.name AS job_name,
           agent.id AS agent_run_id,
           agent.run_id,
           agent.task_id,
           COALESCE(job.data->>'stage', 'code') AS stage
         FROM pgboss.job AS job
         CROSS JOIN LATERAL (
           SELECT candidate.*
           FROM agent_runs AS candidate
           LEFT JOIN stage_executions AS stage
             ON stage.id = candidate.stage_execution_id
           WHERE candidate.status = 'running'
             AND candidate.executor_kind LIKE 'cli%'
             AND candidate.run_id = (job.data->>'runId')::uuid
             AND (
               (
                 job.name = 'task.execute'
                 AND candidate.task_id = (job.data->>'taskId')::uuid
               )
               OR
               (
                 job.name = 'stage.execute'
                 AND candidate.task_id IS NULL
                 AND stage.stage = job.data->>'stage'
               )
           )
           ORDER BY candidate.created_at DESC
           LIMIT 1
           FOR UPDATE OF candidate SKIP LOCKED
         ) AS agent
         LEFT JOIN LATERAL (
           SELECT event.created_at
           FROM domain_events AS event
           WHERE event.run_id = agent.run_id
             AND event.name = 'run.activity'
             AND event.payload->>'agentRunId' = agent.id::text
             AND event.payload->>'kind' = 'heartbeat'
           ORDER BY event.id DESC
           LIMIT 1
         ) AS heartbeat ON true
         WHERE job.state = 'active'
           AND job.name IN ('stage.execute', 'task.execute')
           AND COALESCE(heartbeat.created_at, agent.started_at, job.started_on)
             < now() - ($1::double precision * interval '1 millisecond')
         FOR UPDATE OF job SKIP LOCKED
       ),
       reset_jobs AS (
         UPDATE pgboss.job AS job
         SET state = 'created', completed_on = NULL
         FROM stale
         WHERE job.id = stale.job_id
           AND job.name = stale.job_name
           AND job.state = 'active'
         RETURNING job.id, job.name
       ),
       settled_agents AS (
         UPDATE agent_runs AS agent
         SET
           status = 'cancelled',
           failure_reason = 'cancelled',
           finished_at = now()
         FROM stale
         JOIN reset_jobs
           ON reset_jobs.id = stale.job_id
          AND reset_jobs.name = stale.job_name
         WHERE agent.id = stale.agent_run_id
           AND agent.status = 'running'
         RETURNING agent.id, agent.run_id, agent.task_id
       ),
       audit AS (
         INSERT INTO domain_events (id, run_id, name, payload)
         SELECT
           gen_random_uuid(),
           agent.run_id,
           'run.activity',
           jsonb_strip_nulls(
             jsonb_build_object(
               'runId', agent.run_id,
               'taskId', agent.task_id,
               'agentRunId', agent.id,
               'stage', stale.stage,
               'kind', 'agent',
               'message',
               'Orphaned CLI process recovered after its heartbeat stopped; queue job reactivated'
             )
           )
         FROM settled_agents AS agent
         JOIN stale ON stale.agent_run_id = agent.id
         RETURNING 1
       )
       SELECT stale.*
       FROM stale
       JOIN reset_jobs
         ON reset_jobs.id = stale.job_id
        AND reset_jobs.name = stale.job_name
       JOIN settled_agents
         ON settled_agents.id = stale.agent_run_id`,
      [heartbeatGraceMs],
    );
    await client.query('COMMIT');

    for (const job of recovered.rows) {
      log.warn(
        {
          jobId: job.job_id,
          jobName: job.job_name,
          agentRunId: job.agent_run_id,
          runId: job.run_id,
          taskId: job.task_id,
          stage: job.stage,
        },
        'recovered orphaned agent job',
      );
    }
    return recovered.rowCount ?? recovered.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
