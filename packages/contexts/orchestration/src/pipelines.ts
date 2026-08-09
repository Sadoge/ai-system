import type { PolicySnapshot, RunStatus, StageKind } from '@ai-system/domain';

/**
 * A pipeline definition is data: an ordered stage list plus the run status
 * each stage runs under. advance() interprets definitions; it contains no
 * pipeline-specific branches. Phase 0 ships `trivial`; Phase 1 adds
 * `mvp_linear` gates via `gateAfter` (docs/10).
 */
export interface LinearPipelineDefinition {
  name: PolicySnapshot['pipeline'];
  stages: readonly StageKind[];
  statusDuring: (stage: StageKind) => RunStatus;
  /** Gate to park in after this stage completes, or null. Must respect policy.enabledGates. */
  gateAfter: (stage: StageKind, policy: PolicySnapshot) => 'plan_approval' | 'final_pr' | null;
}

export const TRIVIAL_PIPELINE: LinearPipelineDefinition = {
  name: 'trivial',
  stages: ['intake', 'echo_agent'],
  statusDuring: () => 'executing',
  gateAfter: () => null,
};

export const MVP_LINEAR_PIPELINE: LinearPipelineDefinition = {
  name: 'mvp_linear',
  stages: ['intake', 'classify', 'research', 'plan', 'code', 'review', 'test', 'package'],
  statusDuring: (stage) => {
    switch (stage) {
      case 'classify':
        return 'classifying';
      case 'research':
        return 'researching';
      case 'plan':
        return 'planning';
      case 'code':
        return 'executing';
      case 'review':
        return 'reviewing';
      case 'test':
        return 'testing';
      case 'package':
        return 'packaging';
      default:
        return 'executing';
    }
  },
  gateAfter: (stage, policy) => {
    if (stage === 'plan' && policy.enabledGates.includes('plan_approval')) return 'plan_approval';
    if (stage === 'package') return 'final_pr'; // never disableable
    return null;
  },
};

const PIPELINES: Record<PolicySnapshot['pipeline'], LinearPipelineDefinition> = {
  trivial: TRIVIAL_PIPELINE,
  mvp_linear: MVP_LINEAR_PIPELINE,
};

export function pipelineFor(policy: PolicySnapshot): LinearPipelineDefinition {
  return PIPELINES[policy.pipeline];
}

export function nextStage(
  def: LinearPipelineDefinition,
  after: StageKind | null,
): StageKind | null {
  if (after === null) return def.stages[0] ?? null;
  const i = def.stages.indexOf(after);
  if (i === -1) return null;
  return def.stages[i + 1] ?? null;
}
