import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import {
  artifacts,
  gateDecisions,
  gateRequests,
  pipelineRuns,
  repositories,
  reviewFindings,
  type Db,
} from '@ai-system/db';
import {
  PolicySnapshot,
  REVIEW_SPECIALTIES,
  TicketSnapshot,
  uuidv7,
  type ReviewSpecialty,
} from '@ai-system/domain';
import { applyEvent } from '@ai-system/orchestration';
import {
  brainQuery,
  indexRepository,
  latestIndexSnapshot,
  recordContextGrants,
  retrievalPriors,
  saveIndexSnapshot,
  type BrainContext,
} from '@ai-system/brain';
import { ImplementationPlan, ResearchReport, type AgentContext } from '@ai-system/agents';
import {
  commitAll,
  diffAgainst,
  ensureCheckout,
  ensureWorktree,
  type CodingTaskSpec,
} from '@ai-system/agent-execution';
import { createArtifact } from './artifacts.js';
import { detectGitHost, gitHostFor } from './git-host.js';
import { notifyTracker } from './trackers.js';
import { reportActivity } from './activity.js';
import { executeWithFallbacks } from './execution-fallback.js';
import type { StageServices } from './services.js';
import type { RunRow, StageOutcome } from './stages.js';

const exec = promisify(execFile);
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

// ── shared helpers ────────────────────────────────────────────────────

type RepoRow = typeof repositories.$inferSelect;

export function agentCtx(run: RunRow): AgentContext {
  const policy = PolicySnapshot.parse(run.policySnapshot);
  return { runId: run.id, budgetUsd: policy.budgetUsd };
}

export function runBranch(run: RunRow): string {
  return `ai/run-${run.id.slice(-8)}`;
}

export function repoPaths(services: StageServices, repoId: string, runId: string) {
  const dataDir = resolve(services.dataDir);
  return {
    checkoutDir: join(dataDir, 'repos', repoId),
    // The run branch's worktree. Task worktrees are siblings of it.
    worktreeDir: join(dataDir, 'worktrees', runId, 'run'),
  };
}

export function taskWorktreeDir(services: StageServices, runId: string, taskId: string): string {
  return join(resolve(services.dataDir), 'worktrees', runId, `task-${taskId.slice(-8)}`);
}

export function taskBranch(run: RunRow, taskId: string): string {
  // Sibling of the run branch, not a child: git stores refs as files, so
  // `ai/run-x` and `ai/run-x/t-y` cannot both exist.
  return `${runBranch(run)}-t-${taskId.slice(-8)}`;
}

/** The commands a repository has declared safe for its sandbox (docs/06 §4). */
export function allowedCommandsFor(repo: RepoRow): string[] {
  const settings = (repo.settings ?? {}) as { testCommand?: string; lintCommand?: string };
  return [settings.testCommand, settings.lintCommand].filter((c): c is string => Boolean(c));
}

export async function requireRepo(db: Db, run: RunRow): Promise<RepoRow> {
  if (!run.repositoryId) throw new Error('run has no repository — register one and restart');
  const rows = await db.select().from(repositories).where(eq(repositories.id, run.repositoryId));
  if (!rows[0]) throw new Error(`unknown repository ${run.repositoryId}`);
  return rows[0];
}

export async function latestArtifact(db: Db, runId: string, kind: string) {
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.kind, kind)))
    .orderBy(desc(artifacts.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBrainContext(
  services: StageServices,
  run: RunRow,
  repo: RepoRow | null,
): Promise<BrainContext> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  let index = null;
  if (repo) {
    const { checkoutDir } = repoPaths(services, repo.id, run.id);
    await ensureCheckout(repo.remoteUrl, checkoutDir);
    index = await latestIndexSnapshot(db, repo.id);
    if (!index) {
      index = await indexRepository(checkoutDir);
      await saveIndexSnapshot(db, repo.id, index);
    }
  }
  const keywords = [
    ...new Set(
      `${ticket.title} ${ticket.description}`
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((w) => w.length > 3),
    ),
  ].slice(0, 12);
  const query = `${ticket.title}\n${ticket.description}`;
  // Outcome priors are read per assembly rather than cached: they change only
  // when runs settle, and a stale prior would silently outlive the evidence.
  const priors = await retrievalPriors(db, {
    organizationId: run.organizationId,
    projectId: run.projectId,
  });
  const context = await brainQuery(db, {
    projectId: run.projectId,
    ...(repo ? { repositoryId: repo.id } : {}),
    index,
    need: {
      structural: { keywords },
      rules: {},
      semantic: { query },
      episodic: { query },
    },
    ...(services.embedder ? { embedder: services.embedder } : {}),
    priors,
  });

  // Record what this run received so its outcome can be attributed later. A
  // bookkeeping failure must never fail a stage that otherwise has its context.
  await recordContextGrants(db, {
    organizationId: run.organizationId,
    projectId: run.projectId,
    runId: run.id,
    context,
  }).catch(() => ({ recorded: 0 }));

  return context;
}

export async function openBlockingFindings(db: Db, runId: string) {
  return db
    .select()
    .from(reviewFindings)
    .where(and(eq(reviewFindings.runId, runId), eq(reviewFindings.status, 'open')));
}

// ── stage handlers (docs/10 Phase 1 pipeline) ─────────────────────────

export async function classifyStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const ticket = TicketSnapshot.parse(run.ticket);
  const agents = await services.agents(run);
  const result = await agents.classify({ ticket }, agentCtx(run));
  await services.db
    .update(pipelineRuns)
    .set({ complexity: result.complexity })
    .where(eq(pipelineRuns.id, run.id));
  await applyEvent(services.db, {
    name: 'run.complexity.classified',
    payload: { runId: run.id, complexity: result.complexity },
  });
  // Epic: the engine parked the run at awaiting_split; a human splits the ticket.
  return { artifactIds: [], suppressCompletion: result.complexity === 'epic' };
}

export async function researchStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = run.repositoryId ? await requireRepo(db, run) : null;
  const brain = await getBrainContext(services, run, repo);
  const agents = await services.agents(run);
  const report = await agents.research({ ticket, brain }, agentCtx(run));
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'research_report',
    content: report,
  });
  return { artifactIds: [artifactId] };
}

export async function planStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const researchArtifact = await latestArtifact(db, run.id, 'research_report');
  if (!researchArtifact) throw new Error('no research report to plan from');
  const research = ResearchReport.parse(researchArtifact.content);
  const repo = run.repositoryId ? await requireRepo(db, run) : null;
  const brain = await getBrainContext(services, run, repo);
  const rejectionFeedback = await latestPlanRejectionComment(db, run.id);

  const agents = await services.agents(run);
  const plan = await agents.plan(
    { ticket, research, brain, ...(rejectionFeedback ? { rejectionFeedback } : {}) },
    agentCtx(run),
  );
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'implementation_plan',
    content: plan,
  });
  return { artifactIds: [artifactId] };
}

async function latestPlanRejectionComment(db: Db, runId: string): Promise<string | null> {
  const rows = await db
    .select({ comment: gateDecisions.comment, decision: gateDecisions.decision })
    .from(gateDecisions)
    .innerJoin(gateRequests, eq(gateDecisions.gateRequestId, gateRequests.id))
    .where(and(eq(gateRequests.runId, runId), eq(gateRequests.gate, 'plan_approval')))
    .orderBy(desc(gateDecisions.createdAt))
    .limit(1);
  const last = rows[0];
  return last && last.decision === 'rejected' ? (last.comment ?? null) : null;
}

export async function codeStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = await requireRepo(db, run);
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  if (!planArtifact) throw new Error('no implementation plan to code from');
  const plan = ImplementationPlan.parse(planArtifact.content);
  const findings = await openBlockingFindings(db, run.id);
  await reportActivity(
    db,
    { runId: run.id, stage: 'code' },
    { kind: 'stage', message: 'Loading repository context and coding rules' },
  );
  const brain = await getBrainContext(services, run, repo);

  const { checkoutDir, worktreeDir } = repoPaths(services, repo.id, run.id);
  await ensureCheckout(repo.remoteUrl, checkoutDir);
  await ensureWorktree(checkoutDir, worktreeDir, runBranch(run), repo.defaultBranch);

  const taskSpec: CodingTaskSpec = {
    ticketTitle: ticket.title,
    planSummary: plan.summary,
    steps: plan.steps,
    findings: findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      filePath: f.filePath,
    })),
    rules: brain.rules.map((r) => ({ title: r.title, content: r.content })),
  };

  const execution = await executeWithFallbacks({
    db,
    candidates: await services.executorsFor(run, repo, 'coding'),
    maxAttempts: services.codingMaxAttempts,
    runId: run.id,
    stage: 'code',
    agentKind: 'coding',
    worktreeDir,
    taskSpec,
    timeoutMs: services.codingTimeoutMs,
    allowedCommands: allowedCommandsFor(repo),
    artifactContext: { iteration: run.iterationCount },
  });
  if (execution.status === 'failed') {
    const { result } = execution;
    throw new Error(
      `all coding agents failed; last failure: ${result.failureReason}${result.note ? ` — ${result.note}` : ''}`,
    );
  }

  await reportActivity(
    db,
    { runId: run.id, stage: 'code', agentRunId: execution.agentRunId },
    { kind: 'stage', message: 'Coding agent succeeded; finalizing its Git changes' },
  );
  await commitAll(
    worktreeDir,
    `ai-system: ${ticket.title} (iteration ${run.iterationCount})`,
    repo.defaultBranch,
  );
  await reportActivity(
    db,
    { runId: run.id, stage: 'code', agentRunId: execution.agentRunId },
    { kind: 'stage', message: 'Generating the review diff' },
  );
  const diff = await diffAgainst(worktreeDir, repo.defaultBranch);
  const { artifactId: diffId } = await createArtifact(db, {
    runId: run.id,
    kind: 'diff',
    content: { diff, baseBranch: repo.defaultBranch, branch: runBranch(run) },
    createdByAgentRunId: execution.agentRunId,
  });
  return { artifactIds: [...execution.artifactIds, diffId] };
}

export async function reviewStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = run.repositoryId ? await requireRepo(db, run) : null;
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  const diffArtifact = await latestArtifact(db, run.id, 'diff');
  if (!planArtifact || !diffArtifact) throw new Error('review needs a plan and a diff');
  const plan = ImplementationPlan.parse(planArtifact.content);
  const diff = (diffArtifact.content as { diff: string }).diff;
  const brain = await getBrainContext(services, run, repo);

  // Findings from earlier iterations are superseded by this fresh review.
  await db
    .update(reviewFindings)
    .set({ status: 'superseded' })
    .where(and(eq(reviewFindings.runId, run.id), eq(reviewFindings.status, 'open')));

  const agents = await services.agents(run);
  const report = await agents.review(
    { ticket, plan, diff, brain, iterationCount: run.iterationCount },
    agentCtx(run),
  );

  // Specialized passes (docs/10 Phase 4): each looks at one dimension only,
  // declared per repository — a security pass on a repo that wants it, never
  // a global behavior change.
  const specialties = specializedReviewersFor(repo);
  const specialtyPasses: { specialty: string; summary: string; findingCount: number }[] = [];
  const allFindings = report.findings.map((f) => ({ ...f }));
  for (const specialty of specialties) {
    const pass = await agents.review(
      { ticket, plan, diff, brain, iterationCount: run.iterationCount, specialty },
      agentCtx(run),
    );
    specialtyPasses.push({ specialty, summary: pass.summary, findingCount: pass.findings.length });
    for (const finding of pass.findings) {
      allFindings.push({
        ...finding,
        // Attribution lives in the category, so the findings dashboard groups
        // by reviewer for free: "security:injection", or bare "security".
        category: finding.category.startsWith(specialty)
          ? finding.category
          : `${specialty}:${finding.category}`,
      });
    }
  }

  for (const finding of allFindings) {
    await db.insert(reviewFindings).values({
      id: uuidv7(),
      runId: run.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      detail: finding.detail,
      filePath: finding.filePath,
    });
  }
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'review_report',
    content: { ...report, findings: allFindings, specialtyPasses },
  });
  return { artifactIds: [artifactId] };
}

/** Additional review passes a repository has opted into (settings.reviewers). */
export function specializedReviewersFor(repo: RepoRow | null): ReviewSpecialty[] {
  const settings = (repo?.settings ?? {}) as { reviewers?: string[] };
  return (settings.reviewers ?? []).filter((r): r is ReviewSpecialty =>
    (REVIEW_SPECIALTIES as readonly string[]).includes(r),
  );
}

export async function testStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = await requireRepo(db, run);
  const { worktreeDir } = repoPaths(services, repo.id, run.id);
  const settings = (repo.settings ?? {}) as { testCommand?: string };

  // Only the repository's allowlisted command runs — never anything an agent chose (docs/06 §4).
  let testsPassed = true;
  let output = '(no test command configured for this repository)';
  if (settings.testCommand) {
    try {
      const { stdout, stderr } = await exec('bash', ['-c', settings.testCommand], {
        cwd: worktreeDir,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      });
      output = (stdout + stderr).slice(-20_000);
    } catch (err) {
      testsPassed = false;
      const e = err as { stdout?: string; stderr?: string; message: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`.slice(-20_000);
    }
  }

  // The command result is deterministic; the assigned testing agent explains
  // failures and turns them into actionable fix inputs. No command means no
  // model call, because there is no evidence for an agent to interpret.
  let analysis = {
    summary: 'No test command configured.',
    findings: [] as Array<{
      severity: 'blocker' | 'major' | 'minor' | 'info';
      category: string;
      title: string;
      detail: string;
      filePath: string | null;
    }>,
  };
  if (settings.testCommand) {
    const diffArtifact = await latestArtifact(db, run.id, 'diff');
    const diff = (diffArtifact?.content as { diff?: string } | undefined)?.diff ?? '';
    const agents = await services.agents(run);
    analysis = await agents.test(
      {
        ticket,
        command: settings.testCommand,
        passed: testsPassed,
        output,
        diff,
        iterationCount: run.iterationCount,
      },
      agentCtx(run),
    );
  }

  if (!testsPassed && !analysis.findings.some((f) => ['blocker', 'major'].includes(f.severity))) {
    analysis.findings.push({
      severity: 'major',
      category: 'testing',
      title: 'Repository test command failed',
      detail: analysis.summary || output.slice(-2_000),
      filePath: null,
    });
  }
  for (const finding of analysis.findings) {
    await db.insert(reviewFindings).values({
      id: uuidv7(),
      runId: run.id,
      severity: finding.severity,
      category: finding.category.startsWith('testing')
        ? finding.category
        : `testing:${finding.category}`,
      title: finding.title,
      detail: finding.detail,
      filePath: finding.filePath,
    });
  }

  const blocking = (await openBlockingFindings(db, run.id)).filter((f) =>
    ['blocker', 'major'].includes(f.severity),
  );
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'test_report',
    content: {
      testsPassed,
      output,
      analysis,
      blockingFindings: blocking.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
      iteration: run.iterationCount,
    },
  });

  if (testsPassed && blocking.length === 0) return { artifactIds: [artifactId] };

  // The engine — not this handler — decides between a fix iteration and the gate.
  await applyEvent(db, {
    name: 'run.iteration.needed',
    payload: { runId: run.id, blockingFindingIds: blocking.map((f) => f.id), testsPassed },
  });
  return { artifactIds: [artifactId], suppressCompletion: true };
}

export async function packageStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = await requireRepo(db, run);
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  const diffArtifact = await latestArtifact(db, run.id, 'diff');
  const testArtifact = await latestArtifact(db, run.id, 'test_report');
  const reviewArtifact = await latestArtifact(db, run.id, 'review_report');
  const plan = planArtifact ? ImplementationPlan.parse(planArtifact.content) : null;
  const branch = runBranch(run);

  const body = [
    `## Summary`,
    plan?.summary ?? ticket.description,
    '',
    `## Plan`,
    ...(plan?.steps.map((s, i) => `${i + 1}. ${s.title}`) ?? []),
    '',
    `## Evidence`,
    `- Review: ${(reviewArtifact?.content as { summary?: string })?.summary ?? 'n/a'}`,
    `- Tests: ${(testArtifact?.content as { testsPassed?: boolean })?.testsPassed ? 'passed' : 'see report'}`,
    `- Iterations used: ${run.iterationCount}`,
  ].join('\n');

  // Git-host port: the stage speaks "push branch, open change request"; GitHub,
  // GitLab, and Bitbucket are interchangeable behind that sentence.
  let prUrl: string | null = null;
  let prError: string | null = null;
  const host = gitHostFor(repo.remoteUrl, { githubToken: services.githubToken });
  if (host) {
    try {
      const { checkoutDir } = repoPaths(services, repo.id, run.id);
      await host.push(checkoutDir, branch);
      const cr = await host.openChangeRequest({
        title: ticket.title,
        body,
        sourceBranch: branch,
        targetBranch: repo.defaultBranch,
      });
      prUrl = cr.url;
    } catch (err) {
      prError = err instanceof Error ? err.message : String(err);
    }
  } else {
    // A recognized forge without credentials is a configuration mistake, not a
    // silent no-op: say so in the artifact so the gate reviewer sees why the
    // package has a branch but no link.
    const detected = detectGitHost(repo.remoteUrl);
    if (detected) prError = `${detected} remote detected but no credentials are configured`;
  }

  const trackerResult = prUrl ? await notifyTracker(ticket, prUrl) : null;

  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'pr_package',
    content: {
      branch,
      baseBranch: repo.defaultBranch,
      title: ticket.title,
      body,
      diffStat: summarizeDiff((diffArtifact?.content as { diff?: string })?.diff ?? ''),
      prUrl,
      prError,
      gitHost: host?.name ?? null,
      tracker: trackerResult,
    },
  });
  return { artifactIds: [artifactId] };
}

function summarizeDiff(diff: string): { files: number; additions: number; deletions: number } {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { files, additions, deletions };
}
