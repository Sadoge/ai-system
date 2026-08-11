import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { agentRuns, modelCalls, repositories, type Db } from '@ai-system/db';
import { uuidv7 } from '@ai-system/domain';
import {
  CliAgentExecutor,
  ScriptedAgentExecutor,
  type AgentExecutionUsage,
  type AgentExecutor,
} from '@ai-system/agent-execution';
import type { ModelTarget, ResolvedProfile } from '@ai-system/model-gateway';
import type { ExecutorCandidate } from './services.js';

export type RepoRow = typeof repositories.$inferSelect;

/** Per-repository executor settings (docs/06 §4) — the CLI a project's agents run under. */
export interface ExecutorSettings {
  executor?: 'claude_code' | 'codex' | 'api_loop' | 'scripted' | 'cli';
  executorBinary?: string;
  executorArgs?: string[];
  executorModel?: string;
  executorEffort?: 'low' | 'medium' | 'high';
}

export interface ExecutorFactoryDeps {
  mock: boolean;
  /** Built lazily so a missing provider key never breaks CLI-only setups. */
  apiLoop: () => AgentExecutor;
}

function targetKey(target: ModelTarget): string {
  return `${target.provider}:${target.model}:${target.params?.reasoningEffort ?? ''}`;
}

/** Keep configured model fallbacks first, then add available alternate CLIs. */
export function withAutomaticExecutorFallbacks(
  profile: ResolvedProfile,
  automaticTargets: ModelTarget[],
  maxAttempts: number,
): ResolvedProfile {
  const alternateProviders = automaticTargets.filter(
    (target) => target.provider !== profile.primary.provider,
  );
  const sameProviderModels = automaticTargets.filter(
    (target) => target.provider === profile.primary.provider,
  );
  const ordered = [
    profile.primary,
    ...profile.fallbacks,
    ...alternateProviders,
    ...sameProviderModels,
  ];
  const seen = new Set<string>();
  const unique = ordered.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const limited = unique.slice(0, Math.max(1, maxAttempts));
  return { purpose: profile.purpose, primary: limited[0]!, fallbacks: limited.slice(1) };
}

interface PreviousAgentRun {
  executorKind: string;
  status: string;
  failureReason: string | null;
  sessionId: string | null;
}

export function resumableSessionFrom(latest: PreviousAgentRun | undefined): string | undefined {
  if (
    latest?.executorKind !== 'cli:codex' ||
    latest.status !== 'failed' ||
    (latest.failureReason !== 'timeout' && latest.failureReason !== 'cancelled')
  ) {
    return undefined;
  }
  return latest.sessionId ?? undefined;
}

export function persistedExecutorKind(executor: AgentExecutor): string {
  return executor instanceof CliAgentExecutor ? `cli:${executor.cliName}` : executor.executorKind;
}

/**
 * Which agent writes the code is independent of whether the pipeline's
 * *reasoning* agents are mocked. `MOCK_MODELS=true` only changes the default
 * to `scripted`; an explicit repository setting still wins, so a project can
 * run mocked planning with a real coding CLI (useful for testing the CLI
 * integration without provider keys for everything else).
 *
 * The worker normally supplies a resolved stage profile. Repository settings
 * and CODING_EXECUTOR remain the backward-compatible fallback when it does not.
 */
export function resolveExecutor(
  repo: RepoRow | null,
  deps: ExecutorFactoryDeps,
  assignment?: ResolvedProfile,
): AgentExecutor {
  const settings = (repo?.settings ?? {}) as ExecutorSettings;
  const assignedProvider = assignment?.primary.provider;
  const configuredChoice = settings.executor ?? process.env.CODING_EXECUTOR;
  const choice = assignedProvider
    ? assignedProvider === 'claude_cli'
      ? 'claude_code'
      : assignedProvider === 'codex_cli'
        ? 'codex'
        : assignedProvider
    : (settings.executor ??
      process.env.CODING_EXECUTOR ??
      (deps.mock ? 'scripted' : 'claude_code'));
  const normalizedConfiguredChoice =
    configuredChoice === 'claude_cli' || configuredChoice === 'cli'
      ? 'claude_code'
      : configuredChoice === 'codex_cli'
        ? 'codex'
        : configuredChoice;
  const useRepositoryOverrides = !assignment || normalizedConfiguredChoice === choice;
  const assignedModel = assignment?.primary.model;
  const effort =
    assignment?.primary.params?.reasoningEffort ??
    (assignment ? undefined : settings.executorEffort);
  const model =
    assignedModel && assignedModel !== 'default'
      ? assignedModel
      : assignment
        ? undefined
        : settings.executorModel;

  switch (choice) {
    case 'scripted':
      return new ScriptedAgentExecutor();
    case 'api_loop':
      return deps.apiLoop();
    case 'cli': // legacy alias
    case 'claude_code':
    case 'codex':
      return new CliAgentExecutor({
        preset: choice === 'cli' ? 'claude_code' : choice,
        binary: useRepositoryOverrides ? settings.executorBinary : undefined,
        args: useRepositoryOverrides ? settings.executorArgs : undefined,
        model,
        effort,
      });
    default:
      throw new Error(
        `provider "${choice}" cannot edit a worktree — use claude_cli or codex_cli for this stage`,
      );
  }
}

export function resolveExecutorCandidates(
  repo: RepoRow | null,
  deps: ExecutorFactoryDeps,
  assignment: ResolvedProfile,
): ExecutorCandidate[] {
  return [assignment.primary, ...assignment.fallbacks].map((target) => ({
    target,
    executor: resolveExecutor(repo, deps, {
      purpose: assignment.purpose,
      primary: target,
      fallbacks: [],
    }),
  }));
}

export function executorCandidateLabel(candidate: ExecutorCandidate): string {
  const provider =
    candidate.target.provider === 'codex_cli'
      ? 'Codex'
      : candidate.target.provider === 'claude_cli'
        ? 'Claude'
        : candidate.target.provider;
  const effort = candidate.target.params?.reasoningEffort;
  return `${provider} · ${candidate.target.model}${effort ? ` · ${effort} effort` : ''}`;
}

/** Latest interrupted Codex conversation that can safely continue in this worktree. */
export async function resumableCodexSession(
  db: Db,
  input: { runId: string; taskId?: string; executor: AgentExecutor },
): Promise<string | undefined> {
  if (!(input.executor instanceof CliAgentExecutor) || input.executor.cliName !== 'codex') {
    return undefined;
  }

  const taskCondition = input.taskId
    ? eq(agentRuns.taskId, input.taskId)
    : isNull(agentRuns.taskId);
  const rows = await db
    .select({
      executorKind: agentRuns.executorKind,
      status: agentRuns.status,
      failureReason: agentRuns.failureReason,
      sessionId: agentRuns.sessionId,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.runId, input.runId), taskCondition, eq(agentRuns.agentKind, 'coding')))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return resumableSessionFrom(rows[0]);
}

/**
 * CLI agents spend money outside the Model Gateway, so their self-reported
 * usage is written into the same ledger. Without this the cost views and
 * budget guard would silently under-count every CLI-driven run.
 */
export async function recordExecutorUsage(
  db: Db,
  input: {
    runId: string;
    agentRunId: string;
    executorKind: string;
    cliName?: string;
    usage: AgentExecutionUsage | undefined;
    status: 'succeeded' | 'failed';
    latencyMs: number;
    purpose?: string;
  },
): Promise<void> {
  const usage = input.usage;
  if (!usage || usage.costUsd === undefined) return;

  await db.insert(modelCalls).values({
    id: uuidv7(),
    runId: input.runId,
    agentRunId: input.agentRunId,
    // Namespaced so cost dashboards can separate gateway spend from CLI spend.
    provider: `cli:${input.cliName ?? input.executorKind}`,
    model: usage.model ?? 'unknown',
    purpose: input.purpose ?? 'coding',
    promptHash: 'n/a-cli',
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: usage.costUsd.toFixed(6),
    latencyMs: input.latencyMs,
    status: input.status,
  });

  await db
    .update(agentRuns)
    .set({ costUsd: sql`${agentRuns.costUsd} + ${usage.costUsd.toFixed(6)}` })
    .where(eq(agentRuns.id, input.agentRunId));
}
