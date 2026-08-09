import type { ModelGateway, ResolvedProfile } from '@ai-system/model-gateway';
import type { BrainContext } from '@ai-system/brain';
import { runJsonAgent } from './runner.js';
import {
  ClassifierOutput,
  ImplementationPlan,
  ResearchReport,
  ReviewReport,
  type AgentContext,
  type Agents,
} from './schemas.js';

export interface AgentProfiles {
  classifier: ResolvedProfile;
  research: ResolvedProfile;
  planning: ResolvedProfile;
  review: ResolvedProfile;
}

function renderBrain(brain: BrainContext): string {
  const rules =
    brain.rules.length > 0
      ? brain.rules.map((r) => `- [${r.kind}] ${r.title}: ${r.content}`).join('\n')
      : '(none)';
  const files =
    brain.relevantFiles.length > 0
      ? brain.relevantFiles.map((f) => `- ${f.path} exports: ${f.exports.join(', ')}`).join('\n')
      : '(none matched)';
  return `## Project rules and conventions (MUST be respected)\n${rules}\n\n## Relevant files\n${files}\n\n## Repository file map\n${brain.fileMap}`;
}

export function createLlmAgents(gateway: ModelGateway, profiles: AgentProfiles): Agents {
  const meta = (purpose: string, ctx: AgentContext) => ({
    purpose,
    runId: ctx.runId,
    budgetUsd: ctx.budgetUsd,
  });

  return {
    async classify(input, ctx) {
      return runJsonAgent(gateway, profiles.classifier, {
        system:
          'You classify software tickets by implementation complexity: tiny (one-line change), small (single file, no design), medium (a few files, some design), large (many files, significant design), epic (should be split into multiple tickets).',
        user: `Ticket: ${input.ticket.title}\n\n${input.ticket.description}\n\nAcceptance criteria:\n${input.ticket.acceptanceCriteria.join('\n') || '(none)'}`,
        schema: ClassifierOutput,
        meta: meta('classifier', ctx),
      });
    },

    async research(input, ctx) {
      return runJsonAgent(gateway, profiles.research, {
        system:
          'You are a senior engineer researching a codebase before implementation. Identify the files that matter, the risks, and open questions. Be specific and cite real paths from the file map.',
        user: `Ticket: ${input.ticket.title}\n\n${input.ticket.description}\n\n${renderBrain(input.brain)}`,
        schema: ResearchReport,
        meta: meta('research', ctx),
      });
    },

    async plan(input, ctx) {
      const feedback = input.rejectionFeedback
        ? `\n\nA human rejected the previous plan with this feedback — address it:\n${input.rejectionFeedback}`
        : '';
      return runJsonAgent(gateway, profiles.planning, {
        system:
          'You write implementation plans a coding agent will follow verbatim. Small, ordered, verifiable steps; name the files to touch; respect every project rule.',
        user: `Ticket: ${input.ticket.title}\n\n${input.ticket.description}\n\nResearch findings:\n${input.research.summary}\nRelevant files: ${input.research.relevantFiles.join(', ')}\nRisks: ${input.research.risks.join('; ') || '(none)'}\n\n${renderBrain(input.brain)}${feedback}`,
        schema: ImplementationPlan,
        meta: meta('planning', ctx),
      });
    },

    async review(input, ctx) {
      return runJsonAgent(gateway, profiles.review, {
        system:
          'You are a strict but fair code reviewer. Report findings with severity: blocker (must not merge), major (should fix before merge), minor, info. Explain WHY each finding matters — you never rewrite code yourself. Check the diff against the plan and every project rule.',
        user: `Ticket: ${input.ticket.title}\n\nPlan:\n${input.plan.summary}\n${input.plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\nIteration: ${input.iterationCount}\n\nDiff:\n${input.diff || '(empty diff)'}\n\n${renderBrain(input.brain)}`,
        schema: ReviewReport,
        meta: meta('review', ctx),
      });
    },
  };
}
