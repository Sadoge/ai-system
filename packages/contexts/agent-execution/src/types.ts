import type { AgentFailureReason } from '@ai-system/domain';

/**
 * The pluggable executor contract (docs/06 §1). MVP ships `cli` (headless
 * agent CLI in a worktree) and `scripted` (deterministic, for tests and mock
 * mode); `api_loop` is the documented Phase 2+ implementation.
 */
export interface CodingTaskSpec {
  ticketTitle: string;
  planSummary: string;
  steps: { title: string; detail: string; files: string[] }[];
  /** Open findings from the previous review — present on fix iterations. */
  findings: { severity: string; title: string; detail: string; filePath: string | null }[];
  rules: { title: string; content: string }[];
}

export interface AgentExecutionInput {
  runId: string;
  agentRunId: string;
  worktreeDir: string;
  taskSpec: CodingTaskSpec;
  limits: { timeoutMs: number };
}

export type AgentExecutionResult =
  | { status: 'succeeded'; transcript: string }
  | { status: 'failed'; failureReason: AgentFailureReason; transcript: string };

export interface AgentExecutor {
  readonly executorKind: 'cli' | 'scripted' | 'api_loop';
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
