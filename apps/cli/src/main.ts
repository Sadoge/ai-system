#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Exit quietly when output is piped into a pager that closes early (e.g. `| head`).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

import { Command } from 'commander';
import { asc, desc, eq } from 'drizzle-orm';
import {
  artifacts,
  createDb,
  createPool,
  domainEvents,
  gateRequests,
  migrateDb,
  organizations,
  pipelineRuns,
  projects,
  stageExecutions,
  type Db,
} from '@ai-system/db';
import { TicketSnapshot, defaultTrivialPolicy, uuidv7 } from '@ai-system/domain';
import { resolveGate, startRun } from '@ai-system/orchestration';

// Phase 0: the CLI is the UI before the UI (docs/10). It talks to the same
// context facades the API app will use in Phase 1 — no logic lives here.

const program = new Command('ai-system').description(
  'AI Software Engineering Platform — operator CLI',
);

function withDb<A extends unknown[]>(fn: (db: Db, ...args: A) => Promise<void>) {
  return async (...args: A) => {
    const pool = createPool();
    const db = createDb(pool);
    try {
      await fn(db, ...args);
    } finally {
      await pool.end();
    }
  };
}

const dbCmd = program.command('db').description('database operations');
dbCmd
  .command('migrate')
  .description('apply pending migrations')
  .action(
    withDb(async (db) => {
      await migrateDb(db);
      console.log('migrations applied');
    }),
  );

program
  .command('seed')
  .description('create a local organization and project if none exist')
  .action(
    withDb(async (db) => {
      const existing = await db.select().from(projects).limit(1);
      if (existing[0]) {
        console.log(`project already exists: ${existing[0].id} (${existing[0].name})`);
        return;
      }
      const orgId = uuidv7();
      const projectId = uuidv7();
      await db.insert(organizations).values({ id: orgId, name: 'Local' });
      await db.insert(projects).values({ id: projectId, organizationId: orgId, name: 'default' });
      console.log(`organization: ${orgId}`);
      console.log(`project:      ${projectId}`);
    }),
  );

const runCmd = program.command('run').description('pipeline runs');

runCmd
  .command('start <ticket-file>')
  .description('start a run from a ticket file (JSON matching TicketSnapshot, or plain text)')
  .option('--project <id>', 'project id (defaults to the only project)')
  .action(
    withDb(async (db, ticketFile: string, opts: { project?: string }) => {
      const ticket = readTicketFile(ticketFile);
      const project = await pickProject(db, opts.project);
      const { runId } = await startRun(db, {
        organizationId: project.organizationId,
        projectId: project.id,
        ticket,
        policy: defaultTrivialPolicy(),
      });
      console.log(`run started: ${runId}`);
      console.log(`follow with: ai-system run status ${runId}`);
    }),
  );

runCmd
  .command('status <run-id>')
  .description('show run state, stages, artifacts, and recent events')
  .action(
    withDb(async (db, runId: string) => {
      const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
      const run = runRows[0];
      if (!run) {
        console.error(`unknown run ${runId}`);
        process.exitCode = 1;
        return;
      }
      console.log(`run ${run.id}`);
      console.log(`  status:    ${run.status}${run.currentStage ? ` (stage: ${run.currentStage})` : ''}`);
      console.log(`  pipeline:  ${(run.policySnapshot as { pipeline: string }).pipeline}`);
      console.log(`  version:   ${run.version}`);
      if (run.error) console.log(`  error:     ${run.error}`);

      const stages = await db
        .select()
        .from(stageExecutions)
        .where(eq(stageExecutions.runId, runId))
        .orderBy(asc(stageExecutions.createdAt));
      console.log('  stages:');
      for (const s of stages) {
        console.log(`    ${s.stage.padEnd(12)} ${s.status}${s.error ? ` — ${s.error}` : ''}`);
      }

      const arts = await db
        .select({ id: artifacts.id, kind: artifacts.kind })
        .from(artifacts)
        .where(eq(artifacts.runId, runId))
        .orderBy(asc(artifacts.createdAt));
      console.log('  artifacts:');
      for (const a of arts) console.log(`    ${a.kind.padEnd(16)} ${a.id}`);

      const events = await db
        .select({ name: domainEvents.name, createdAt: domainEvents.createdAt })
        .from(domainEvents)
        .where(eq(domainEvents.runId, runId))
        .orderBy(desc(domainEvents.createdAt))
        .limit(10);
      console.log('  recent events:');
      for (const e of events.reverse()) {
        console.log(`    ${e.createdAt.toISOString()}  ${e.name}`);
      }
    }),
  );

const gateCmd = program.command('gate').description('human approval gates');

gateCmd
  .command('list')
  .description('list pending gate requests')
  .action(
    withDb(async (db) => {
      const pending = await db
        .select()
        .from(gateRequests)
        .where(eq(gateRequests.status, 'pending'))
        .orderBy(asc(gateRequests.createdAt));
      if (pending.length === 0) {
        console.log('no pending gates');
        return;
      }
      for (const g of pending) {
        console.log(`${g.id}  ${g.gate.padEnd(16)} run ${g.runId}`);
      }
    }),
  );

gateCmd
  .command('approve <gate-request-id>')
  .description('approve a pending gate')
  .option('--comment <text>')
  .action(
    withDb(async (db, gateRequestId: string, opts: { comment?: string }) => {
      await resolveGate(db, {
        gateRequestId,
        decision: 'approved',
        ...(opts.comment !== undefined ? { comment: opts.comment } : {}),
      });
      console.log('approved');
    }),
  );

gateCmd
  .command('reject <gate-request-id>')
  .description('reject a pending gate with feedback')
  .requiredOption('--comment <text>', 'feedback for the engine to route back')
  .action(
    withDb(async (db, gateRequestId: string, opts: { comment: string }) => {
      await resolveGate(db, { gateRequestId, decision: 'rejected', comment: opts.comment });
      console.log('rejected');
    }),
  );

function readTicketFile(path: string): TicketSnapshot {
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return TicketSnapshot.parse(JSON.parse(raw));
  const [firstLine = '', ...rest] = raw.trim().split('\n');
  return TicketSnapshot.parse({
    source: 'file',
    title: firstLine.replace(/^#\s*/, ''),
    description: rest.join('\n').trim(),
  });
}

async function pickProject(db: Db, projectId?: string) {
  if (projectId) {
    const rows = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!rows[0]) throw new Error(`unknown project ${projectId}`);
    return rows[0];
  }
  const rows = await db.select().from(projects).limit(2);
  if (rows.length === 0) throw new Error('no projects — run `ai-system seed` first');
  if (rows.length > 1) throw new Error('multiple projects — pass --project <id>');
  return rows[0]!;
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
