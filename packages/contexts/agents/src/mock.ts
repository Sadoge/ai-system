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
          {
            title: 'Record design notes',
            detail: 'Capture the design considerations for the change',
            files: ['DESIGN_NOTES.md'],
          },
          {
            title: 'Summarize the change set',
            detail: 'Roll the notes up into a summary once both exist',
            files: ['SUMMARY.md'],
          },
        ],
        testStrategy: 'Run the repository test command if configured.',
      };
    },

    /**
     * Produces a deliberately shaped DAG: two independent tasks plus a third
     * that depends on both, so parallel dispatch and fan-in both get exercised.
     */
    async decompose(input) {
      if ((input.findings && input.findings.length > 0) || input.feedback) {
        const items = input.findings ?? [];
        const fixes = items.length > 0 ? items : [{ title: input.feedback ?? 'address feedback', detail: '', filePath: null, severity: 'major' }];
        return {
          summary: 'Mock fix decomposition',
          tasks: fixes.slice(0, input.maxTasks).map((f, i) => ({
            key: `fix-${i + 1}`,
            title: `Fix: ${f.title}`,
            detail: f.detail,
            files: f.filePath ? [f.filePath] : [],
            dependsOn: [],
          })),
        };
      }
      const steps = input.plan.steps.slice(0, Math.max(1, input.maxTasks));
      const tasks = steps.map((step, i) => ({
        key: `t${i + 1}`,
        title: step.title,
        detail: step.detail,
        files: step.files,
        // The last task rolls up the others (only when there are others).
        dependsOn: i === steps.length - 1 && steps.length > 1 ? steps.slice(0, -1).map((_, j) => `t${j + 1}`) : [],
      }));
      return { summary: 'Mock decomposition', tasks };
    },

    async document(input) {
      return {
        summary: `Mock documentation for "${input.ticket.title}"`,
        changelog: input.plan.steps.map((s) => s.title),
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
