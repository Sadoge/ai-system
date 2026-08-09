import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderCodingPrompt } from './prompt.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

/**
 * Deterministic executor for tests and mock mode: writes implementation notes
 * from the plan; on fix iterations appends FIX: lines acknowledging each
 * finding (which satisfies the mock reviewer). Exercises the entire
 * worktree → commit → diff → review → iterate machinery without an LLM.
 */
export class ScriptedAgentExecutor implements AgentExecutor {
  readonly executorKind = 'scripted' as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const notesFile = join(input.worktreeDir, 'IMPLEMENTATION_NOTES.md');
    const spec = input.taskSpec;

    if (spec.findings.length === 0) {
      await writeFile(
        notesFile,
        `# ${spec.ticketTitle}\n\n${spec.planSummary}\n\n${spec.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n`,
        'utf8',
      );
    } else {
      const fixes = spec.findings.map((f) => `FIX: ${f.title} — ${f.detail}`).join('\n');
      await appendFile(notesFile, `\n${fixes}\n`, 'utf8');
    }

    return { status: 'succeeded', transcript: renderCodingPrompt(spec) };
  }
}
