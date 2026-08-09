import { z } from 'zod';

// Pipeline run lifecycle (docs/05 §2). The full machine is declared up front;
// which states a given run can reach is decided by its pipeline definition
// and frozen policy_snapshot, not by this enum.
export const RunStatus = z.enum([
  'created',
  'classifying',
  'awaiting_split',
  'researching',
  'planning',
  'awaiting_plan_approval',
  'decomposing',
  'executing',
  'integrating',
  'reviewing',
  'testing',
  'awaiting_iteration_gate',
  'documenting',
  'packaging',
  'awaiting_final_approval',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const Complexity = z.enum(['tiny', 'small', 'medium', 'large', 'epic']);
export type Complexity = z.infer<typeof Complexity>;

export const AutomationLevel = z.enum([
  'research_only',
  'plan_gated',
  'code_gated',
  'review_gated',
  'autonomous',
]);
export type AutomationLevel = z.infer<typeof AutomationLevel>;

export const StageKind = z.enum([
  // Phase 0 trivial pipeline
  'intake',
  'echo_agent',
  // Full pipeline (Phase 1+)
  'classify',
  'research',
  'plan',
  'decompose',
  'code',
  'integrate',
  'review',
  'test',
  'document',
  'package',
]);
export type StageKind = z.infer<typeof StageKind>;

export const StageStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type StageStatus = z.infer<typeof StageStatus>;

export const GateKind = z.enum([
  'plan_approval',
  'pre_merge',
  'final_pr',
  'iteration_extension',
  'budget_top_up',
  'knowledge_approval',
]);
export type GateKind = z.infer<typeof GateKind>;

export const GateDecisionKind = z.enum(['approved', 'rejected']);
export type GateDecisionKind = z.infer<typeof GateDecisionKind>;

export const AgentRunStatus = z.enum([
  'queued',
  'preparing',
  'running',
  'validating',
  'succeeded',
  'failed',
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const AgentFailureReason = z.enum([
  'invalid_output',
  'model_error',
  'rate_limited',
  'budget_denied',
  'timeout',
  'sandbox_error',
  'cancelled',
]);
export type AgentFailureReason = z.infer<typeof AgentFailureReason>;

export const ArtifactKind = z.enum([
  'ticket_snapshot',
  'research_report',
  'implementation_plan',
  'task_spec',
  'diff',
  'review_report',
  'test_report',
  'pr_package',
  'agent_transcript',
  'echo_output',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;
