import type { Agents } from './schemas.js';

/**
 * Deterministic agents for keyless runs (MOCK_MODELS=true): CI, demos, and
 * engine verification. Behavior is intentionally scripted — the first review
 * of a run reports one major finding so the iteration loop is exercised;
 * later reviews (or diffs containing FIX:) come back clean.
 */
export function createMockAgents(): Agents {
  return {
    async classify(input) {
      const size = input.ticket.description.length + input.ticket.title.length;
      const complexity =
        /\[epic\]/i.test(input.ticket.title) ? 'epic'
        : size < 80 ? 'tiny'
        : size < 200 ? 'small'
        : 'medium';
      return { complexity, rationale: `mock classification from ticket length (${size} chars)` };
    },

    async research(input) {
      return {
        summary: `Mock research for "${input.ticket.title}": inspected ${input.brain.relevantFiles.length} candidate files against ${input.brain.rules.length} project rules.`,
        relevantFiles: input.brain.relevantFiles.slice(0, 5).map((f) => f.path),
        risks: [],
        openQuestions: [],
      };
    },

    async plan(input) {
      return {
        summary: `Mock plan for "${input.ticket.title}"${input.rejectionFeedback ? ' (revised after feedback)' : ''}`,
        steps: [
          {
            title: 'Record implementation notes',
            detail: `Document the intended change for: ${input.ticket.title}`,
            files: ['IMPLEMENTATION_NOTES.md'],
          },
        ],
        testStrategy: 'Run the repository test command if configured.',
      };
    },

    async review(input) {
      if (input.iterationCount === 0 && !input.diff.includes('FIX:')) {
        return {
          summary: 'Mock review: one major finding to exercise the iteration loop.',
          findings: [
            {
              severity: 'major',
              category: 'completeness',
              title: 'Missing FIX marker',
              detail:
                'The change must include a line starting with "FIX:" acknowledging the review finding (mock rule).',
              filePath: 'IMPLEMENTATION_NOTES.md',
            },
          ],
        };
      }
      return { summary: 'Mock review: clean.', findings: [] };
    },
  };
}
