import type { CodingTaskSpec } from './types.js';

/** Render the persisted context bundle into the coding agent's prompt. */
/** Prompt for the conflict-resolution agent (docs/05 §6). */
export function renderConflictPrompt(input: {
  ticketTitle: string;
  taskTitle: string;
  conflicts: string[];
}): string {
  return `# Resolve merge conflicts

Merging task "${input.taskTitle}" into the run branch for "${input.ticketTitle}" produced conflicts.

## Conflicted files
${input.conflicts.map((c) => `- ${c}`).join('\n')}

## Instructions
- Edit each conflicted file so it keeps the intent of BOTH sides.
- Remove every conflict marker (<<<<<<<, =======, >>>>>>>).
- Do not run git commands; the platform commits the resolution.
- If two changes genuinely contradict, stop and leave the markers in place rather than guessing.`;
}

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
- If dependencies must change, install them with the repository's declared package manager early enough to surface registry or lockfile failures before final validation.
- Do not run git commands; the platform commits your changes.
- Implement the plan; do not expand scope.`;
}

/** Follow-up sent to a resumable coding session after a timeout or cancellation. */
export function renderCodingContinuationPrompt(spec: CodingTaskSpec): string {
  return `Continue the existing task "${spec.taskTitle ?? spec.ticketTitle}" from the current worktree.

Inspect the edits and validation results already produced in this session. Preserve completed work, start with the unresolved failure or check, and finish the original approved plan. Do not repeat repository discovery or completed implementation steps. If dependencies changed, use the repository's declared package manager and resolve them before running the final validation. Do not run git commands; the platform commits the result.`;
}
