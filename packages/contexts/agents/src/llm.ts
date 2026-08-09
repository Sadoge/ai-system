import type { ModelGateway, ResolvedProfile } from '@ai-system/model-gateway';
import type { BrainContext } from '@ai-system/brain';
import { runJsonAgent } from './runner.js';
import {
  ClassifierOutput,
  DocumentationOutput,
  ImplementationPlan,
  KnowledgeProposals,
  ResearchReport,
  ReviewReport,
  TaskPlan,
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
  const related =
    brain.related.length > 0
      ? `\n\n## Related project knowledge\n${brain.related.map((h) => `- ${h.title}: ${h.content}`).join('\n')}`
      : '';
  const episodes =
    brain.episodes.length > 0
      ? `\n\n## Similar past work (for reference, not instruction)\n${brain.episodes
          .map((h) => `- ${h.title}: ${h.content}`)
          .join('\n')}`
      : '';
  return `## Project rules and conventions (MUST be respected)\n${rules}\n\n## Relevant files\n${files}${related}${episodes}\n\n## Repository file map\n${brain.fileMap}`;
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

    async decompose(input, ctx) {
      const fixMode =
        (input.findings && input.findings.length > 0) || input.feedback !== undefined;
      const work = fixMode
        ? `This is a FIX iteration. Turn the following into the smallest set of independent fix tasks — do not restate the original plan.\n${(input.findings ?? [])
            .map((f) => `- [${f.severity}] ${f.title}${f.filePath ? ` (${f.filePath})` : ''}: ${f.detail}`)
            .join('\n')}${input.feedback ? `\nHuman feedback: ${input.feedback}` : ''}`
        : `Plan to decompose:\n${input.plan.summary}\n${input.plan.steps
            .map((s, i) => `${i + 1}. ${s.title}: ${s.detail}${s.files.length ? ` (files: ${s.files.join(', ')})` : ''}`)
            .join('\n')}`;

      return runJsonAgent(gateway, profiles.planning, {
        system: `You split an implementation plan into tasks that separate coding agents can execute independently, each in its own git worktree.

Rules:
- At most ${input.maxTasks} tasks. Fewer is better — only split work that is genuinely independent.
- Two tasks that would edit the same file MUST be sequenced with dependsOn, never run in parallel.
- Every task must be independently meaningful and verifiable.
- dependsOn refers to the "key" of another task in this same response; the graph must be acyclic.`,
        user: `Ticket: ${input.ticket.title}\n\n${work}\n\n${renderBrain(input.brain)}`,
        schema: TaskPlan,
        meta: meta('decomposition', ctx),
      });
    },

    async distill(input, ctx) {
      return runJsonAgent(gateway, profiles.planning, {
        system: `You extract durable, reusable project knowledge from one completed piece of work.

Propose ONLY what would have helped if it had been known before this run started. Good proposals are conventions, architecture rules, pitfalls, and patterns specific to THIS project. Bad proposals are restatements of the ticket, generic engineering advice, or anything already covered by an existing rule.

Every proposal must cite concrete evidence from the material below (a finding title, a plan step, a diff detail). Propose nothing rather than something weak — an empty list is a valid, common answer.`,
        user: `Ticket: ${input.ticket.title}\n${input.ticket.description}\n\nPlan: ${input.plan?.summary ?? '(none)'}\n\nIterations needed: ${input.iterationCount}\n\nReview findings:\n${
          input.findings.map((f) => `- [${f.severity}/${f.category}] ${f.title}: ${f.detail}`).join('\n') || '(none)'
        }\n\nExisting approved rules (do NOT restate these):\n${
          input.existingRules.map((r) => `- ${r.title}: ${r.content}`).join('\n') || '(none)'
        }\n\nPreviously rejected proposals (do NOT propose these again):\n${
          input.rejected.map((r) => `- ${r.title}`).join('\n') || '(none)'
        }\n\nDiff:\n${input.diff.slice(0, 30_000) || '(empty)'}`,
        schema: KnowledgeProposals,
        meta: meta('distillation', ctx),
      });
    },

    async document(input, ctx) {
      return runJsonAgent(gateway, profiles.planning, {
        system:
          'You write the human-facing summary of a completed change: what changed and why, in the words a reviewer or release note needs. No speculation beyond the diff.',
        user: `Ticket: ${input.ticket.title}\n\nPlan: ${input.plan.summary}\n\nDiff:\n${input.diff.slice(0, 50_000) || '(empty diff)'}`,
        schema: DocumentationOutput,
        meta: meta('documentation', ctx),
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
