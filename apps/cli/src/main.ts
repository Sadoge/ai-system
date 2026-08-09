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
  repositories,
  reviewFindings,
  stageExecutions,
  type Db,
} from '@ai-system/db';
import {
  KnowledgeKind,
  TicketSnapshot,
  defaultMvpPolicy,
  defaultTeamPolicy,
  defaultTrivialPolicy,
  uuidv7,
} from '@ai-system/domain';
import {
  addManualKnowledge,
  decideKnowledge,
  listKnowledge as listKnowledgeItems,
} from '@ai-system/brain';
import {
  InMemoryCallLedger,
  LocalHashEmbeddingAdapter,
  ModelGateway,
} from '@ai-system/model-gateway';
import { CliAgentExecutor } from '@ai-system/agent-execution';
import {
  createApiKey,
  getQuotas,
  listApiKeys,
  revokeApiKey,
  setQuotas,
  type Role,
} from '@ai-system/tenancy';
import { fetchJiraTicket, jiraConfigFromEnv } from '@ai-system/integrations';
import { listTasks, resolveGate, startRun } from '@ai-system/orchestration';

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

const orgCmd = program.command('org').description('organizations, keys, and quotas');

orgCmd
  .command('bootstrap')
  .description('create an organization, an owner API key, and a default project')
  .requiredOption('--name <name>', 'organization name')
  .option('--key-name <name>', 'label for the owner API key', 'bootstrap')
  .option('--project <name>', 'default project name', 'default')
  .action(
    withDb(async (db, opts: { name: string; keyName: string; project: string }) => {
      const organizationId = uuidv7();
      const projectId = uuidv7();
      await db.insert(organizations).values({ id: organizationId, name: opts.name });
      await db.insert(projects).values({ id: projectId, organizationId, name: opts.project });
      const key = await createApiKey(db, {
        organizationId,
        name: opts.keyName,
        role: 'owner',
      });
      console.log(`organization: ${organizationId}`);
      console.log(`project:      ${projectId}`);
      console.log(`API key:      ${key.plaintext}`);
      console.log('\nStore the key now — it is hashed and cannot be shown again.');
    }),
  );

orgCmd
  .command('key-create')
  .description('mint an API key for an organization')
  .requiredOption('--org <id>')
  .requiredOption('--name <name>')
  .option('--role <role>', 'viewer | member | admin | owner', 'member')
  .action(
    withDb(async (db, opts: { org: string; name: string; role: string }) => {
      const key = await createApiKey(db, {
        organizationId: opts.org,
        name: opts.name,
        role: opts.role as Role,
      });
      console.log(key.plaintext);
      console.log('\nStore it now — it is hashed and cannot be shown again.');
    }),
  );

orgCmd
  .command('key-list')
  .description('list API keys (prefixes only — the secrets are unrecoverable)')
  .requiredOption('--org <id>')
  .action(
    withDb(async (db, opts: { org: string }) => {
      const keys = await listApiKeys(db, opts.org);
      for (const k of keys) {
        console.log(
          `${k.id}  ${k.keyPrefix}…  ${k.role.padEnd(7)} ${k.name}${k.revokedAt ? '  [revoked]' : ''}`,
        );
      }
      if (keys.length === 0) console.log('no keys');
    }),
  );

orgCmd
  .command('key-revoke <key-id>')
  .description('revoke an API key immediately')
  .requiredOption('--org <id>')
  .action(
    withDb(async (db, keyId: string, opts: { org: string }) => {
      await revokeApiKey(db, keyId, opts.org);
      console.log('revoked');
    }),
  );

orgCmd
  .command('quotas')
  .description('show or set per-organization quotas')
  .requiredOption('--org <id>')
  .option('--max-concurrent-runs <n>', 'refuse new runs beyond this many active')
  .option('--monthly-budget-usd <n>', 'refuse new runs once this month exceeds it')
  .option('--requests-per-minute <n>', 'API rate limit for this organization')
  .action(
    withDb(
      async (
        db,
        opts: {
          org: string;
          maxConcurrentRuns?: string;
          monthlyBudgetUsd?: string;
          requestsPerMinute?: string;
        },
      ) => {
        const updates = {
          ...(opts.maxConcurrentRuns ? { maxConcurrentRuns: Number(opts.maxConcurrentRuns) } : {}),
          ...(opts.monthlyBudgetUsd ? { monthlyBudgetUsd: Number(opts.monthlyBudgetUsd) } : {}),
          ...(opts.requestsPerMinute ? { requestsPerMinute: Number(opts.requestsPerMinute) } : {}),
        };
        if (Object.keys(updates).length > 0) {
          await setQuotas(db, opts.org, { ...(await getQuotas(db, opts.org)), ...updates });
        }
        console.log(JSON.stringify(await getQuotas(db, opts.org), null, 2));
      },
    ),
  );

const repoCmd = program.command('repo').description('repositories');

repoCmd
  .command('register <remote-url-or-path>')
  .description('register a repository (git URL or local path) with a project')
  .option('--project <id>', 'project id (defaults to the only project)')
  .option('--name <name>', 'display name')
  .option('--default-branch <branch>', 'default branch', 'main')
  .option('--test-command <cmd>', 'allowlisted test command run in the sandbox')
  .option(
    '--executor <name>',
    'coding agent: claude_code | codex | api_loop | scripted (default: claude_code)',
  )
  .option('--executor-model <model>', 'model passed to the coding agent CLI')
  .action(
    withDb(
      async (
        db,
        remoteUrl: string,
        opts: {
          project?: string;
          name?: string;
          defaultBranch: string;
          testCommand?: string;
          executor?: string;
          executorModel?: string;
        },
      ) => {
        const project = await pickProject(db, opts.project);
        const repositoryId = uuidv7();
        await db.insert(repositories).values({
          id: repositoryId,
          organizationId: project.organizationId,
          projectId: project.id,
          name: opts.name ?? remoteUrl.split('/').pop() ?? remoteUrl,
          remoteUrl,
          defaultBranch: opts.defaultBranch,
          settings: {
            ...(opts.testCommand ? { testCommand: opts.testCommand } : {}),
            ...(opts.executor ? { executor: opts.executor } : {}),
            ...(opts.executorModel ? { executorModel: opts.executorModel } : {}),
          },
        });
        console.log(`repository registered: ${repositoryId}`);
      },
    ),
  );

repoCmd
  .command('list')
  .description('list registered repositories and their coding agent')
  .action(
    withDb(async (db) => {
      const rows = await db.select().from(repositories);
      if (rows.length === 0) {
        console.log('no repositories registered');
        return;
      }
      for (const repo of rows) {
        const settings = (repo.settings ?? {}) as { executor?: string; testCommand?: string };
        console.log(
          `${repo.id}  ${repo.name.padEnd(20)} executor=${settings.executor ?? 'claude_code (default)'}${
            settings.testCommand ? `  test="${settings.testCommand}"` : ''
          }`,
        );
      }
    }),
  );

repoCmd
  .command('check-agents')
  .description('report which coding agent CLIs are installed on this machine')
  .action(async () => {
    for (const name of ['claude_code', 'codex'] as const) {
      const available = await new CliAgentExecutor({ preset: name }).isAvailable();
      console.log(`${name.padEnd(12)} ${available ? 'available' : 'NOT installed'}`);
    }
  });

const runCmd = program.command('run').description('pipeline runs');

runCmd
  .command('start [ticket-file]')
  .description('start a run from a ticket file (JSON or plain text) or a Jira issue (--jira)')
  .option('--project <id>', 'project id (defaults to the only project)')
  .option('--pipeline <name>', 'trivial | mvp | team', 'trivial')
  .option('--automation <level>', 'plan_gated | autonomous (mvp only)', 'plan_gated')
  .option('--repo <id>', 'repository id (defaults to the only repo of the project)')
  .option('--jira <issue-key>', 'fetch the ticket from Jira (needs JIRA_BASE_URL/EMAIL/API_TOKEN)')
  .action(
    withDb(
      async (
        db,
        ticketFile: string | undefined,
        opts: { project?: string; pipeline: string; automation: string; repo?: string; jira?: string },
      ) => {
        let ticket: TicketSnapshot;
        if (opts.jira) {
          const jira = jiraConfigFromEnv();
          if (!jira) throw new Error('Jira env not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)');
          ticket = await fetchJiraTicket(jira, opts.jira);
        } else if (ticketFile) {
          ticket = readTicketFile(ticketFile);
        } else {
          throw new Error('pass a ticket file or --jira <issue-key>');
        }
        const project = await pickProject(db, opts.project);
        let repositoryId: string | undefined;
        if (opts.pipeline !== 'trivial') {
          repositoryId = await pickRepository(db, project.id, opts.repo);
        }
        const automation = opts.automation === 'autonomous' ? 'autonomous' : 'plan_gated';
        const policy =
          opts.pipeline === 'team'
            ? defaultTeamPolicy(automation)
            : opts.pipeline === 'mvp'
              ? defaultMvpPolicy(automation)
              : defaultTrivialPolicy();
        const { runId } = await startRun(db, {
          organizationId: project.organizationId,
          projectId: project.id,
          ...(repositoryId ? { repositoryId } : {}),
          ticket,
          policy,
        });
        console.log(`run started: ${runId} (pipeline: ${policy.pipeline})`);
        console.log(`follow with: ai-system run status ${runId}`);
      },
    ),
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

      const taskRows = await listTasks(db, runId);
      if (taskRows.length > 0) {
        const byId = new Map(taskRows.map((t) => [t.id, t.title]));
        console.log('  tasks:');
        for (const t of taskRows) {
          const deps = t.dependsOn.map((d) => byId.get(d) ?? d.slice(-8)).join(', ');
          console.log(
            `    ${t.status.padEnd(10)} ${t.title}${deps ? ` (after: ${deps})` : ''}${
              t.error ? ` — ${t.error}` : ''
            }`,
          );
        }
      }

      const findings = await db
        .select()
        .from(reviewFindings)
        .where(eq(reviewFindings.runId, runId))
        .orderBy(asc(reviewFindings.createdAt));
      if (findings.length > 0) {
        console.log('  findings:');
        for (const f of findings) {
          console.log(`    [${f.severity}] ${f.title} (${f.status})`);
        }
      }

      const pendingGates = await db
        .select()
        .from(gateRequests)
        .where(eq(gateRequests.runId, runId))
        .orderBy(asc(gateRequests.createdAt));
      for (const g of pendingGates.filter((g) => g.status === 'pending')) {
        console.log(`  ⏸ pending gate: ${g.gate} — resolve with: ai-system gate approve ${g.id}`);
      }

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

const knowledgeCmd = program.command('knowledge').description('Project Brain curated knowledge');

knowledgeCmd
  .command('add')
  .description('add an approved manual knowledge item (rule, convention, pitfall, ...)')
  .requiredOption('--kind <kind>', 'architecture_rule | convention | adr | pitfall | pattern | glossary | business_rule')
  .requiredOption('--title <title>')
  .requiredOption('--content <content>')
  .option('--project <id>', 'project id (defaults to the only project)')
  .action(
    withDb(
      async (db, opts: { kind: string; title: string; content: string; project?: string }) => {
        const project = await pickProject(db, opts.project);
        const { knowledgeItemId } = await addManualKnowledge(
          db,
          {
            organizationId: project.organizationId,
            projectId: project.id,
            kind: KnowledgeKind.parse(opts.kind),
            title: opts.title,
            content: opts.content,
          },
          // Embed on write so the rule is immediately retrievable.
          localEmbedder(),
        );
        console.log(`knowledge item added: ${knowledgeItemId}`);
      },
    ),
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

knowledgeCmd
  .command('inbox')
  .description('list knowledge proposed by the learning loop, awaiting your approval')
  .action(
    withDb(async (db) => {
      const proposals = await listKnowledgeItems(db, 'proposed');
      if (proposals.length === 0) {
        console.log('no pending knowledge proposals');
        return;
      }
      for (const item of proposals) {
        console.log(`${item.id}  [${item.kind}] ${item.title}`);
        console.log(`    ${item.content}`);
        const evidence = (item.scopeTags as string[]) ?? [];
        if (evidence.length > 0) console.log(`    evidence: ${evidence.join(' · ')}`);
      }
    }),
  );

knowledgeCmd
  .command('approve <knowledge-item-id>')
  .description('approve a proposal (it becomes retrievable by agents)')
  .action(
    withDb(async (db, knowledgeItemId: string) => {
      await decideKnowledge(db, { knowledgeItemId, decision: 'approved' }, localEmbedder());
      console.log('approved');
    }),
  );

knowledgeCmd
  .command('reject <knowledge-item-id>')
  .description('reject a proposal (kept as a negative example for the distiller)')
  .action(
    withDb(async (db, knowledgeItemId: string) => {
      await decideKnowledge(db, { knowledgeItemId, decision: 'rejected' });
      console.log('rejected');
    }),
  );

/** Local deterministic embedder — the CLI never needs an API key to approve knowledge. */
function localEmbedder() {
  const gateway = new ModelGateway([], new InMemoryCallLedger(), {
    embeddingAdapters: [new LocalHashEmbeddingAdapter()],
  });
  const profile = {
    purpose: 'embeddings',
    primary: { provider: 'local', model: 'local-hash' },
    fallbacks: [],
  };
  return {
    embed: async (texts: string[]) =>
      (await gateway.embed(profile, { texts, meta: { purpose: 'embeddings' } })).vectors,
  };
}

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

async function pickRepository(db: Db, projectId: string, repoId?: string): Promise<string> {
  if (repoId) {
    const rows = await db.select().from(repositories).where(eq(repositories.id, repoId));
    if (!rows[0]) throw new Error(`unknown repository ${repoId}`);
    return rows[0].id;
  }
  const rows = await db
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, projectId))
    .limit(2);
  if (rows.length === 0) throw new Error('no repositories — run `ai-system repo register` first');
  if (rows.length > 1) throw new Error('multiple repositories — pass --repo <id>');
  return rows[0]!.id;
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
