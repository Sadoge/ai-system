import { z } from 'zod';
import { AutomationLevel, Complexity, GateKind } from './enums.js';

/**
 * Frozen at run start; the engine consults ONLY this snapshot for policy
 * decisions thereafter (docs/03 §invariants, docs/05 §1). Changing project
 * settings mid-run never affects a running pipeline.
 */
export const PolicySnapshot = z.object({
  pipeline: z.enum(['trivial', 'mvp_linear']),
  automationLevel: AutomationLevel,
  enabledGates: z.array(GateKind),
  maxParallelTasks: z.number().int().min(1),
  iterationBudget: z.number().int().min(0),
  maxTaskAttempts: z.number().int().min(1),
  budgetUsd: z.number().nonnegative().nullable(),
});
export type PolicySnapshot = z.infer<typeof PolicySnapshot>;

// Complexity → policy table (docs/03 §4). Epic is rejected at classification,
// so it has no row here.
export const COMPLEXITY_POLICY: Record<
  Exclude<Complexity, 'epic'>,
  Pick<PolicySnapshot, 'maxParallelTasks' | 'iterationBudget'>
> = {
  tiny: { maxParallelTasks: 1, iterationBudget: 1 },
  small: { maxParallelTasks: 1, iterationBudget: 2 },
  medium: { maxParallelTasks: 3, iterationBudget: 3 },
  large: { maxParallelTasks: 5, iterationBudget: 4 },
};

// Automation level → gates (docs/05 §2). final_pr is always present: the
// human is always the final decision maker.
export function gatesForAutomationLevel(level: AutomationLevel): GateKind[] {
  switch (level) {
    case 'research_only':
      return [];
    case 'plan_gated':
      return ['plan_approval', 'final_pr'];
    case 'code_gated':
      return ['plan_approval', 'pre_merge', 'final_pr'];
    case 'review_gated':
      return ['pre_merge', 'final_pr'];
    case 'autonomous':
      return ['final_pr'];
  }
}

export function defaultMvpPolicy(
  automationLevel: Extract<AutomationLevel, 'plan_gated' | 'autonomous'> = 'plan_gated',
): PolicySnapshot {
  return {
    pipeline: 'mvp_linear',
    automationLevel,
    enabledGates: gatesForAutomationLevel(automationLevel),
    maxParallelTasks: 1,
    iterationBudget: 2,
    maxTaskAttempts: 2,
    budgetUsd: null,
  };
}

export function defaultTrivialPolicy(): PolicySnapshot {
  return {
    pipeline: 'trivial',
    automationLevel: 'autonomous',
    enabledGates: [],
    maxParallelTasks: 1,
    iterationBudget: 0,
    maxTaskAttempts: 1,
    budgetUsd: null,
  };
}
