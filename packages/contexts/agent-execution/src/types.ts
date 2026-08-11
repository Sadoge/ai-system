import type { AgentFailureReason } from '@ai-system/domain';

/**
 * The pluggable executor contract (docs/06 §1). MVP ships `cli` (headless
 * agent CLI in a worktree) and `scripted` (deterministic, for tests and mock
 * mode); `api_loop` is the documented Phase 2+ implementation.
 */
export interface CodingTaskSpec {
  ticketTitle: string;
  /** Set when this execution is one task of a decomposed DAG. */
  taskTitle?: string;
  planSummary: string;
  steps: { title: string; detail: string; files: string[] }[];
  /** Open findings from the previous review — present on fix iterations. */
  findings: { severity: string; title: string; detail: string; filePath: string | null }[];
  rules: { title: string; content: string }[];
  /** Set only for the conflict-resolution agent: paths left conflicted by a merge. */
  conflicts?: string[];
}

export interface AgentExecutionInput {
  runId: string;
  agentRunId: string;
  taskId?: string;
  worktreeDir: string;
  taskSpec: CodingTaskSpec;
  /** Existing provider session to continue after a timeout/cancellation. */
  resumeSessionId?: string;
  limits: { timeoutMs: number };
  /** Aborted when an operator stops the parent pipeline run. */
  signal?: AbortSignal;
  /**
   * Commands the repository has declared safe to run in its sandbox
   * (docs/06 §4). The api_loop run_command tool accepts EXACTLY these
   * strings — never arbitrary shell composed by the model.
   */
  allowedCommands?: string[];
  /**
   * Best-effort, operator-safe progress telemetry. A reporting failure must
   * never change the execution result, but implementations preserve ordering.
   */
  onActivity?: (activity: AgentExecutionActivity) => Promise<void>;
}

export interface AgentExecutionActivity {
  kind: 'agent' | 'tool' | 'message' | 'heartbeat';
  message: string;
}

/** What an execution cost, when the executor can tell us (CLIs report their own spend). */
export interface AgentExecutionUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export type AgentExecutionResult =
  | {
      status: 'succeeded';
      transcript: string;
      usage?: AgentExecutionUsage;
      /** Provider conversation/session id, when the executor exposes one. */
      sessionId?: string;
    }
  | {
      status: 'failed';
      failureReason: AgentFailureReason;
      transcript: string;
      usage?: AgentExecutionUsage;
      /** Persisted so a human retry can continue instead of starting over. */
      sessionId?: string;
      /** Operator-facing hint, e.g. a missing binary. */
      note?: string;
    };

export interface AgentExecutor {
  readonly executorKind: 'cli' | 'scripted' | 'api_loop';
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
