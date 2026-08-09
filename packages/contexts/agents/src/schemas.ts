import { z } from 'zod';
import { Complexity, FindingSeverity, TicketSnapshot } from '@ai-system/domain';
import type { BrainContext } from '@ai-system/brain';

// Typed agent outputs (docs/06 §2): the ONLY thing an LLM can return is an
// instance of these schemas. Anything else is invalid_output.

export const ClassifierOutput = z.object({
  complexity: Complexity,
  rationale: z.string(),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutput>;

export const ResearchReport = z.object({
  summary: z.string(),
  relevantFiles: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

export const ImplementationPlan = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      files: z.array(z.string()).default([]),
    }),
  ),
  testStrategy: z.string(),
});
export type ImplementationPlan = z.infer<typeof ImplementationPlan>;

/**
 * The task DAG a decomposition produces. `key` is local to this response and
 * only used to express `dependsOn`; the platform assigns real ids.
 */
export const TaskPlan = z.object({
  summary: z.string(),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        detail: z.string(),
        files: z.array(z.string()).default([]),
        dependsOn: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type TaskPlan = z.infer<typeof TaskPlan>;

export const DocumentationOutput = z.object({
  summary: z.string(),
  changelog: z.array(z.string()).default([]),
});
export type DocumentationOutput = z.infer<typeof DocumentationOutput>;

export const ReviewReport = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: FindingSeverity,
      category: z.string(),
      title: z.string(),
      detail: z.string(),
      filePath: z.string().nullable().default(null),
    }),
  ),
});
export type ReviewReport = z.infer<typeof ReviewReport>;

// ── Agent inputs ──────────────────────────────────────────────────────

export interface ClassifyInput {
  ticket: TicketSnapshot;
}

export interface ResearchInput {
  ticket: TicketSnapshot;
  brain: BrainContext;
}

export interface PlanInput {
  ticket: TicketSnapshot;
  research: ResearchReport;
  brain: BrainContext;
  /** Present when re-planning after a gate rejection. */
  rejectionFeedback?: string;
}

export interface DecomposeInput {
  ticket: TicketSnapshot;
  plan: ImplementationPlan;
  brain: BrainContext;
  maxTasks: number;
  /** Present on a fix iteration: decompose findings into fix tasks instead of planning fresh. */
  findings?: { severity: string; title: string; detail: string; filePath: string | null }[];
  /** Present when a human rejected the PR: their comment is the work to do. */
  feedback?: string;
}

export interface DocumentInput {
  ticket: TicketSnapshot;
  plan: ImplementationPlan;
  diff: string;
}

export interface ReviewInput {
  ticket: TicketSnapshot;
  plan: ImplementationPlan;
  diff: string;
  brain: BrainContext;
  iterationCount: number;
}

export interface AgentContext {
  runId: string;
  budgetUsd: number | null;
}

/** The stage handlers' view of the agent roster. Two factories implement it: LLM and mock. */
export interface Agents {
  classify(input: ClassifyInput, ctx: AgentContext): Promise<ClassifierOutput>;
  research(input: ResearchInput, ctx: AgentContext): Promise<ResearchReport>;
  plan(input: PlanInput, ctx: AgentContext): Promise<ImplementationPlan>;
  decompose(input: DecomposeInput, ctx: AgentContext): Promise<TaskPlan>;
  review(input: ReviewInput, ctx: AgentContext): Promise<ReviewReport>;
  document(input: DocumentInput, ctx: AgentContext): Promise<DocumentationOutput>;
}
