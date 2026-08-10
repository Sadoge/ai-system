import { eq } from 'drizzle-orm';
import { agentRuns, type Db } from '@ai-system/db';
import {
  CliAgentExecutor,
  renderCodingContinuationPrompt,
  renderCodingPrompt,
  type AgentExecutionResult,
  type CodingTaskSpec,
} from '@ai-system/agent-execution';
import { AgentFailureReason, uuidv7, type StageKind } from '@ai-system/domain';
import { createArtifact } from './artifacts.js';
import { agentActivityReporter, reportActivity } from './activity.js';
import {
  executorCandidateLabel,
  persistedExecutorKind,
  recordExecutorUsage,
  resumableCodexSession,
} from './executors.js';
import type { ExecutorCandidate } from './services.js';

type SuccessfulExecution = Extract<AgentExecutionResult, { status: 'succeeded' }>;
type FailedExecution = Extract<AgentExecutionResult, { status: 'failed' }>;

export interface AttemptValidation {
  ok: boolean;
  note?: string;
}

export interface FallbackExecutionInput {
  db: Db;
  candidates: ExecutorCandidate[];
  maxAttempts: number;
  runId: string;
  taskId?: string;
  stage: StageKind;
  agentKind: 'coding' | 'conflict_resolution';
  worktreeDir: string;
  taskSpec: CodingTaskSpec;
  timeoutMs: number;
  allowedCommands?: string[];
  artifactContext?: Record<string, unknown>;
  validate?: (input: {
    result: SuccessfulExecution;
    candidate: ExecutorCandidate;
  }) => Promise<AttemptValidation>;
}

export type FallbackExecutionResult =
  | {
      status: 'succeeded';
      result: SuccessfulExecution;
      agentRunId: string;
      candidate: ExecutorCandidate;
      artifactIds: string[];
    }
  | {
      status: 'failed';
      result: FailedExecution;
      artifactIds: string[];
      attempts: number;
    };

export function shouldTryExecutorFallback(reason: AgentFailureReason): boolean {
  // A provider switch must never be used to evade the run's frozen budget.
  return reason !== 'budget_denied';
}

export async function executeWithFallbacks(
  input: FallbackExecutionInput,
): Promise<FallbackExecutionResult> {
  const candidates = input.candidates.slice(0, Math.max(1, input.maxAttempts));
  if (candidates.length === 0) throw new Error('no coding executor candidates are configured');

  const artifactIds: string[] = [];
  let lastFailure: FailedExecution | undefined;
  let attempted = 0;

  for (const [index, candidate] of candidates.entries()) {
    const attempt = index + 1;
    attempted = attempt;
    const agentRunId = uuidv7();
    const label = executorCandidateLabel(candidate);
    const resumeSessionId =
      input.agentKind === 'coding'
        ? await resumableCodexSession(input.db, {
            runId: input.runId,
            ...(input.taskId ? { taskId: input.taskId } : {}),
            executor: candidate.executor,
          })
        : undefined;
    const prompt = resumeSessionId
      ? renderCodingContinuationPrompt(input.taskSpec)
      : renderCodingPrompt(input.taskSpec);

    const { artifactId: bundleId } = await createArtifact(input.db, {
      runId: input.runId,
      kind: 'task_spec',
      content: {
        ...input.artifactContext,
        taskSpec: input.taskSpec,
        prompt,
        attempt,
        candidate: {
          provider: candidate.target.provider,
          model: candidate.target.model,
          ...(candidate.target.params?.reasoningEffort
            ? { reasoningEffort: candidate.target.params.reasoningEffort }
            : {}),
        },
        ...(resumeSessionId ? { resumeSessionId } : {}),
      },
    });
    artifactIds.push(bundleId);

    await input.db.insert(agentRuns).values({
      id: agentRunId,
      runId: input.runId,
      taskId: input.taskId ?? null,
      agentKind: input.agentKind,
      // Include the CLI provider so a Claude conversation can never be handed
      // to Codex (or vice versa) when a later attempt resumes after timeout.
      executorKind: persistedExecutorKind(candidate.executor),
      status: 'running',
      sessionId: resumeSessionId,
      contextBundleArtifactId: bundleId,
      startedAt: new Date(),
    });
    await reportActivity(
      input.db,
      {
        runId: input.runId,
        stage: input.stage,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        agentRunId,
      },
      {
        kind: 'agent',
        message: `Attempt ${attempt}/${candidates.length}: starting ${label}`,
      },
    );

    const startedAt = Date.now();
    let result: AgentExecutionResult;
    try {
      result = await candidate.executor.execute({
        runId: input.runId,
        agentRunId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        worktreeDir: input.worktreeDir,
        taskSpec: input.taskSpec,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        limits: { timeoutMs: input.timeoutMs },
        ...(input.allowedCommands ? { allowedCommands: input.allowedCommands } : {}),
        onActivity: agentActivityReporter(input.db, {
          runId: input.runId,
          stage: input.stage,
          ...(input.taskId ? { taskId: input.taskId } : {}),
          agentRunId,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const typedReason = AgentFailureReason.safeParse(
        typeof error === 'object' && error !== null && 'reason' in error ? error.reason : undefined,
      );
      result = {
        status: 'failed',
        failureReason: typedReason.success
          ? typedReason.data
          : /\bbudget\b/i.test(message)
            ? 'budget_denied'
            : 'sandbox_error',
        transcript: `Executor crashed before returning a result: ${message}`,
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      };
    }

    if (result.status === 'succeeded' && input.validate) {
      const validation = await input.validate({ result, candidate });
      if (!validation.ok) {
        result = {
          status: 'failed',
          failureReason: 'invalid_output',
          transcript: `${result.transcript}\n\nValidation failed: ${validation.note ?? 'output did not pass validation'}`,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        };
      }
    }

    await recordExecutorUsage(input.db, {
      runId: input.runId,
      agentRunId,
      executorKind: candidate.executor.executorKind,
      ...(candidate.executor instanceof CliAgentExecutor
        ? { cliName: candidate.executor.cliName }
        : {}),
      usage: result.usage,
      status: result.status === 'succeeded' ? 'succeeded' : 'failed',
      latencyMs: Date.now() - startedAt,
      purpose: input.agentKind === 'coding' ? 'coding' : 'integration',
    });

    const { artifactId: transcriptId } = await createArtifact(input.db, {
      runId: input.runId,
      kind: 'agent_transcript',
      content: {
        ...input.artifactContext,
        attempt,
        candidate: { provider: candidate.target.provider, model: candidate.target.model },
        transcript: result.transcript.slice(-100_000),
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      },
      createdByAgentRunId: agentRunId,
    });
    artifactIds.push(transcriptId);

    await input.db
      .update(agentRuns)
      .set({
        status: result.status === 'succeeded' ? 'succeeded' : 'failed',
        ...(result.status === 'failed' ? { failureReason: result.failureReason } : {}),
        sessionId: result.sessionId ?? resumeSessionId,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRunId));

    if (result.status === 'succeeded') {
      return { status: 'succeeded', result, agentRunId, candidate, artifactIds };
    }

    lastFailure = result;
    const next = candidates[index + 1];
    if (!next || !shouldTryExecutorFallback(result.failureReason)) break;
    await reportActivity(
      input.db,
      {
        runId: input.runId,
        stage: input.stage,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        agentRunId,
      },
      {
        kind: 'agent',
        message: `${label} failed (${result.failureReason}). Falling back to ${executorCandidateLabel(next)}`,
      },
    );
  }

  if (!lastFailure) throw new Error('executor fallback chain ended without a result');
  return { status: 'failed', result: lastFailure, artifactIds, attempts: attempted };
}
