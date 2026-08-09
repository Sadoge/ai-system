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
  'awaiting_pre_merge',
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

export const TaskStatus = z.enum(['created', 'running', 'completed', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskOrigin = z.enum(['decomposition', 'fix_iteration']);
export type TaskOrigin = z.infer<typeof TaskOrigin>;

export const FindingSeverity = z.enum(['blocker', 'major', 'minor', 'info']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const BLOCKING_SEVERITIES: readonly FindingSeverity[] = ['blocker', 'major'];

export const FindingStatus = z.enum(['open', 'resolved', 'superseded', 'waived']);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const KnowledgeKind = z.enum([
  'architecture_rule',
  'convention',
  'adr',
  'pitfall',
  'pattern',
  'glossary',
  'business_rule',
]);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;

export const KnowledgeOrigin = z.enum(['manual', 'learned']);
export type KnowledgeOrigin = z.infer<typeof KnowledgeOrigin>;

export const KnowledgeStatus = z.enum(['proposed', 'approved', 'deprecated', 'rejected']);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatus>;

export const ArtifactKind = z.enum([
  'ticket_snapshot',
  'research_report',
  'implementation_plan',
  'task_plan',
  'task_spec',
  'diff',
  'integration_report',
  'review_report',
  'test_report',
  'documentation',
  'pr_package',
  'agent_transcript',
  'echo_output',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;
