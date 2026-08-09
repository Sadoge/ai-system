import type { CodingTaskSpec } from './types.js';

/** Render the persisted context bundle into the coding agent's prompt. */
export function renderCodingPrompt(spec: CodingTaskSpec): string {
  const findings =
    spec.findings.length > 0
      ? `\n## Review findings to fix (this is a fix iteration)\n${spec.findings
          .map((f) => `- [${f.severity}] ${f.title}${f.filePath ? ` (${f.filePath})` : ''}: ${f.detail}`)
          .join('\n')}\n`
      : '';
  const rules =
    spec.rules.length > 0
      ? `\n## Project rules (MUST be respected)\n${spec.rules.map((r) => `- ${r.title}: ${r.content}`).join('\n')}\n`
      : '';
  return `# Task: ${spec.ticketTitle}

## Plan
${spec.planSummary}

## Steps
${spec.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}${s.files.length ? ` (files: ${s.files.join(', ')})` : ''}`).join('\n')}
${findings}${rules}
## Constraints
- Work only inside this directory (an isolated git worktree).
- Do not run git commands; the platform commits your changes.
- Implement the plan; do not expand scope.`;
}
