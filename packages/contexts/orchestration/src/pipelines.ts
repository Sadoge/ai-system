import type { GateKind, PolicySnapshot, RunStatus, StageKind } from '@ai-system/domain';

/**
 * A pipeline definition is data: an ordered stage list plus the run status
 * each stage runs under. advance() interprets definitions; it contains no
 * pipeline-specific branches. Phase 0 ships `trivial`, Phase 1 `mvp_linear`,
 * Phase 2 `team` (task DAG + parallel agents).
 */
export interface PipelineDefinition {
  name: PolicySnapshot['pipeline'];
  stages: readonly StageKind[];
  statusDuring: (stage: StageKind) => RunStatus;
  /** Gate to park in after this stage completes, or null. Must respect policy.enabledGates. */
  gateAfter: (stage: StageKind, policy: PolicySnapshot) => GateKind | null;
  /**
   * The stage that fans out over the task DAG instead of running once.
   * Undefined for linear pipelines.
   */
  taskStage?: StageKind;
  /** Where a fix iteration re-enters the pipeline (docs/05 §5). */
  iterationReentryStage: StageKind;
}

export const TRIVIAL_PIPELINE: PipelineDefinition = {
  name: 'trivial',
  stages: ['intake', 'echo_agent'],
  statusDuring: () => 'executing',
  gateAfter: () => null,
  iterationReentryStage: 'echo_agent',
};

function mvpStatusDuring(stage: StageKind): RunStatus {
  switch (stage) {
    case 'classify':
      return 'classifying';
    case 'research':
      return 'researching';
    case 'plan':
      return 'planning';
    case 'decompose':
      return 'decomposing';
    case 'integrate':
      return 'integrating';
    case 'review':
      return 'reviewing';
    case 'test':
      return 'testing';
    case 'document':
      return 'documenting';
    case 'package':
      return 'packaging';
    default:
      return 'executing';
  }
}

export const MVP_LINEAR_PIPELINE: PipelineDefinition = {
  name: 'mvp_linear',
  stages: ['intake', 'classify', 'research', 'plan', 'code', 'review', 'test', 'package'],
  statusDuring: mvpStatusDuring,
  gateAfter: (stage, policy) => {
    if (stage === 'plan' && policy.enabledGates.includes('plan_approval')) return 'plan_approval';
    if (stage === 'package') return 'final_pr'; // never disableable
    return null;
  },
  iterationReentryStage: 'code',
};

/**
 * Phase 2: planning decomposes the work into a task DAG, `code` fans out over
 * it (bounded by policy.maxParallelTasks), and `integrate` merges the task
 * branches back. Fix iterations re-enter at `decompose`, which turns findings
 * into fix tasks rather than replanning from scratch.
 */
export const TEAM_PIPELINE: PipelineDefinition = {
  name: 'team',
  stages: [
    'intake',
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
  ],
  statusDuring: mvpStatusDuring,
  gateAfter: (stage, policy) => {
    if (stage === 'plan' && policy.enabledGates.includes('plan_approval')) return 'plan_approval';
    if (stage === 'integrate' && policy.enabledGates.includes('pre_merge')) return 'pre_merge';
    if (stage === 'package') return 'final_pr';
    return null;
  },
  taskStage: 'code',
  iterationReentryStage: 'decompose',
};

const PIPELINES: Record<PolicySnapshot['pipeline'], PipelineDefinition> = {
  trivial: TRIVIAL_PIPELINE,
  mvp_linear: MVP_LINEAR_PIPELINE,
  team: TEAM_PIPELINE,
};

export function pipelineFor(policy: PolicySnapshot): PipelineDefinition {
  return PIPELINES[policy.pipeline];
}

export function nextStage(def: PipelineDefinition, after: StageKind | null): StageKind | null {
  if (after === null) return def.stages[0] ?? null;
  const i = def.stages.indexOf(after);
  if (i === -1) return null;
  return def.stages[i + 1] ?? null;
}

/** Kept for source compatibility with Phase 0/1 imports. */
export type LinearPipelineDefinition = PipelineDefinition;
