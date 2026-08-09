import { and, desc, eq } from 'drizzle-orm';
import { agentRuns, gateDecisions, gateRequests, tasks as tasksTable } from '@ai-system/db';
import { PolicySnapshot, TicketSnapshot, uuidv7 } from '@ai-system/domain';
import { applyEvent, createTasks, listTasks, type TaskDraft } from '@ai-system/orchestration';
import { ImplementationPlan } from '@ai-system/agents';
import {
  commitAll,
  diffAgainst,
  ensureCheckout,
  ensureWorktree,
  mergeBranch,
  renderCodingPrompt,
  type CodingTaskSpec,
} from '@ai-system/agent-execution';
import { createArtifact } from './artifacts.js';
import {
  agentCtx,
  getBrainContext,
  latestArtifact,
  openBlockingFindings,
  repoPaths,
  requireRepo,
  runBranch,
  taskBranch,
  taskWorktreeDir,
} from './mvp-stages.js';
import type { StageServices } from './services.js';
import type { RunRow, StageOutcome } from './stages.js';

/**
 * Turn the approved plan into a task DAG (docs/05 §4). On a fix iteration the
 * same stage decomposes open findings — or a human's PR rejection comment —
 * into fix tasks, so the pipeline re-enters here rather than replanning.
 */
export async function decomposeStage(
  services: StageServices,
  run: RunRow,
): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const policy = PolicySnapshot.parse(run.policySnapshot);
  const repo = await requireRepo(db, run);
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  if (!planArtifact) throw new Error('no implementation plan to decompose');
  const plan = ImplementationPlan.parse(planArtifact.content);
  const brain = await getBrainContext(services, run, repo);

  const findings = await openBlockingFindings(db, run.id);
  const feedback = await latestFinalRejectionComment(db, run.id);
  const agents = await services.agents(run);
  const taskPlan = await agents.decompose(
    {
      ticket,
      plan,
      brain,
      maxTasks: Math.max(1, policy.maxParallelTasks * 2),
      ...(findings.length > 0
        ? {
            findings: findings.map((f) => ({
              severity: f.severity,
              title: f.title,
              detail: f.detail,
              filePath: f.filePath,
            })),
          }
        : {}),
      ...(findings.length === 0 && feedback ? { feedback } : {}),
    },
    agentCtx(run),
  );

  // The run branch must exist before tasks can branch from it.
  const { checkoutDir, worktreeDir } = repoPaths(services, repo.id, run.id);
  await ensureCheckout(repo.remoteUrl, checkoutDir);
  await ensureWorktree(checkoutDir, worktreeDir, runBranch(run), repo.defaultBranch);

  const drafts: TaskDraft[] = taskPlan.tasks.map((t) => ({
    key: t.key,
    title: t.title,
    spec: { detail: t.detail, files: t.files, planSummary: taskPlan.summary },
    dependsOn: t.dependsOn,
  }));
  const { taskIds } = await createTasks(db, {
    runId: run.id,
    drafts,
    origin: findings.length > 0 || feedback ? 'fix_iteration' : 'decomposition',
    maxAttempts: policy.maxTaskAttempts,
  });

  // Branch names are derived from the task id, so they are stable across retries.
  for (const taskId of taskIds) {
    await db
      .update(tasksTable)
      .set({ branch: taskBranch(run, taskId) })
      .where(eq(tasksTable.id, taskId));
  }

  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'task_plan',
    content: { ...taskPlan, taskIds, iteration: run.iterationCount },
  });
  return { artifactIds: [artifactId] };
}

async function latestFinalRejectionComment(
  db: StageServices['db'],
  runId: string,
): Promise<string | null> {
  const rows = await db
    .select({ comment: gateDecisions.comment, decision: gateDecisions.decision })
    .from(gateDecisions)
    .innerJoin(gateRequests, eq(gateDecisions.gateRequestId, gateRequests.id))
    .where(and(eq(gateRequests.runId, runId), eq(gateRequests.gate, 'final_pr')))
    .orderBy(desc(gateDecisions.createdAt))
    .limit(1);
  const last = rows[0];
  return last && last.decision === 'rejected' ? (last.comment ?? null) : null;
}

/**
 * Execute one task of the DAG in its own branch and worktree, so parallel
 * agents can never collide. Emits task.completed / task.failed — the engine
 * decides what happens next.
 */
export async function executeTask(
  services: StageServices,
  input: { runId: string; taskId: string },
  run: RunRow,
): Promise<void> {
  const { db } = services;
  const taskRows = await db.select().from(tasksTable).where(eq(tasksTable.id, input.taskId));
  const task = taskRows[0];
  if (!task) throw new Error(`unknown task ${input.taskId}`);
  // Redelivery guard: only a task the engine has marked running may execute.
  if (task.status !== 'running') return;

  const ticket = TicketSnapshot.parse(run.ticket);
  const repo = await requireRepo(db, run);
  const brain = await getBrainContext(services, run, repo);
  const spec = task.spec as { detail?: string; files?: string[]; planSummary?: string };
  const findings = await openBlockingFindings(db, run.id);
  const isFix = task.origin === 'fix_iteration';

  const branch = task.branch ?? taskBranch(run, task.id);
  const { checkoutDir, worktreeDir: runWorktree } = repoPaths(services, repo.id, run.id);
  const worktreeDir = taskWorktreeDir(services, run.id, task.id);
  const agentRunId = uuidv7();

  try {
    await ensureCheckout(repo.remoteUrl, checkoutDir);
    await ensureWorktree(checkoutDir, runWorktree, runBranch(run), repo.defaultBranch);
    // Task branches fork from the run branch, so fix iterations build on merged work.
    await ensureWorktree(checkoutDir, worktreeDir, branch, runBranch(run));

    const taskSpec: CodingTaskSpec = {
      ticketTitle: ticket.title,
      taskTitle: task.title,
      planSummary: spec.planSummary ?? '',
      steps: [{ title: task.title, detail: spec.detail ?? '', files: spec.files ?? [] }],
      findings: isFix
        ? findings.map((f) => ({
            severity: f.severity,
            title: f.title,
            detail: f.detail,
            filePath: f.filePath,
          }))
        : [],
      rules: brain.rules.map((r) => ({ title: r.title, content: r.content })),
    };

    const { artifactId: bundleId } = await createArtifact(db, {
      runId: run.id,
      kind: 'task_spec',
      content: { taskId: task.id, taskSpec, prompt: renderCodingPrompt(taskSpec) },
    });
    await db.insert(agentRuns).values({
      id: agentRunId,
      runId: run.id,
      taskId: task.id,
      agentKind: 'coding',
      executorKind: services.executor.executorKind,
      status: 'running',
      contextBundleArtifactId: bundleId,
      startedAt: new Date(),
    });
    await applyEvent(db, {
      name: 'task.started',
      payload: { runId: run.id, taskId: task.id, attempt: task.attemptCount },
    });

    const result = await services.executor.execute({
      runId: run.id,
      agentRunId,
      taskId: task.id,
      worktreeDir,
      taskSpec,
      limits: { timeoutMs: services.codingTimeoutMs },
    });

    await createArtifact(db, {
      runId: run.id,
      kind: 'agent_transcript',
      content: { taskId: task.id, transcript: result.transcript.slice(-100_000) },
      createdByAgentRunId: agentRunId,
    });

    if (result.status === 'failed') {
      await db
        .update(agentRuns)
        .set({ status: 'failed', failureReason: result.failureReason, finishedAt: new Date() })
        .where(eq(agentRuns.id, agentRunId));
      await failTask(services, run.id, task.id, `coding agent failed: ${result.failureReason}`);
      return;
    }

    await commitAll(worktreeDir, `ai-system: ${task.title}`);
    await db
      .update(agentRuns)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(eq(agentRuns.id, agentRunId));
    await db.update(tasksTable).set({ error: null }).where(eq(tasksTable.id, task.id));
    await applyEvent(db, { name: 'task.completed', payload: { runId: run.id, taskId: task.id } });
  } catch (err) {
    await db
      .update(agentRuns)
      .set({ status: 'failed', failureReason: 'sandbox_error', finishedAt: new Date() })
      .where(eq(agentRuns.id, agentRunId))
      .catch(() => {});
    await failTask(services, run.id, task.id, err instanceof Error ? err.message : String(err));
  }
}

async function failTask(
  services: StageServices,
  runId: string,
  taskId: string,
  reason: string,
): Promise<void> {
  await services.db.update(tasksTable).set({ error: reason }).where(eq(tasksTable.id, taskId));
  await applyEvent(services.db, { name: 'task.failed', payload: { runId, taskId, reason } });
}

/**
 * Merge every completed task branch into the run branch. Conflicts are
 * reported, never force-resolved — the stage fails and a human decides
 * (docs/05 §6; the conflict-resolution agent is a later increment).
 */
export async function integrateStage(
  services: StageServices,
  run: RunRow,
): Promise<StageOutcome> {
  const { db } = services;
  const repo = await requireRepo(db, run);
  const { checkoutDir, worktreeDir } = repoPaths(services, repo.id, run.id);
  await ensureCheckout(repo.remoteUrl, checkoutDir);
  await ensureWorktree(checkoutDir, worktreeDir, runBranch(run), repo.defaultBranch);

  const all = await listTasks(db, run.id);
  const completed = all.filter((t) => t.status === 'completed' && t.branch);
  const merged: string[] = [];
  const alreadyMerged: string[] = [];

  for (const task of completed) {
    const result = await mergeBranch(worktreeDir, task.branch!, `merge task: ${task.title}`);
    if (result.status === 'conflict') {
      throw new Error(
        `merge conflict integrating task "${task.title}" (${task.branch}): ${result.conflicts.join(', ') || 'unknown paths'}`,
      );
    }
    if (result.status === 'merged') merged.push(task.title);
    else alreadyMerged.push(task.title);
  }

  const diff = await diffAgainst(worktreeDir, repo.defaultBranch);
  const { artifactId: reportId } = await createArtifact(db, {
    runId: run.id,
    kind: 'integration_report',
    content: {
      merged,
      alreadyMerged,
      taskCount: all.length,
      branch: runBranch(run),
      iteration: run.iterationCount,
    },
  });
  // Downstream stages (review, test, package) consume the diff artifact, so
  // integration produces it for the team pipeline exactly as coding does for
  // the linear one.
  const { artifactId: diffId } = await createArtifact(db, {
    runId: run.id,
    kind: 'diff',
    content: { diff, baseBranch: repo.defaultBranch, branch: runBranch(run) },
  });
  return { artifactIds: [reportId, diffId] };
}

export async function documentStage(services: StageServices, run: RunRow): Promise<StageOutcome> {
  const { db } = services;
  const ticket = TicketSnapshot.parse(run.ticket);
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  const diffArtifact = await latestArtifact(db, run.id, 'diff');
  if (!planArtifact) throw new Error('no implementation plan to document');
  const plan = ImplementationPlan.parse(planArtifact.content);
  const diff = (diffArtifact?.content as { diff?: string })?.diff ?? '';

  const agents = await services.agents(run);
  const doc = await agents.document({ ticket, plan, diff }, agentCtx(run));
  const { artifactId } = await createArtifact(db, {
    runId: run.id,
    kind: 'documentation',
    content: doc,
  });
  return { artifactIds: [artifactId] };
}
