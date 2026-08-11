import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderCodingPrompt } from './prompt.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

/**
 * Deterministic executor for tests and mock mode: writes notes for its own
 * task into that task's declared file; on fix iterations it appends FIX:
 * lines acknowledging each finding (which satisfies the mock reviewer).
 * Exercises the whole worktree → commit → integrate → review → iterate
 * machinery, including parallel tasks, without an LLM.
 */
export class ScriptedAgentExecutor implements AgentExecutor {
  readonly executorKind = 'scripted' as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    if (input.signal?.aborted) {
      return {
        status: 'failed',
        failureReason: 'cancelled',
        transcript: 'Stopped by the operator.',
      };
    }
    const spec = input.taskSpec;
    await input.onActivity?.({ kind: 'agent', message: 'Scripted agent started' }).catch(() => {});

    // Conflict-resolution mode: keep both sides by stripping the markers.
    if (spec.conflicts && spec.conflicts.length > 0) {
      const { readFile, writeFile: write } = await import('node:fs/promises');
      for (const file of spec.conflicts) {
        await input.onActivity?.({ kind: 'tool', message: `Resolving ${file}` }).catch(() => {});
        const full = join(input.worktreeDir, file);
        const content = await readFile(full, 'utf8');
        await write(
          full,
          content
            .split('\n')
            .filter((line) => !/^(<{7}|={7}|>{7})/.test(line))
            .join('\n'),
          'utf8',
        );
      }
      return {
        status: 'succeeded',
        transcript: `resolved ${spec.conflicts.length} conflicted file(s)`,
      };
    }
    // One file per task keeps parallel task branches conflict-free.
    const targetFile =
      spec.steps.flatMap((s) => s.files)[0] ?? `${slug(spec.taskTitle ?? spec.ticketTitle)}.md`;
    const path = join(input.worktreeDir, targetFile);
    await input.onActivity?.({ kind: 'tool', message: `Writing ${targetFile}` }).catch(() => {});
    if (input.signal?.aborted) {
      return {
        status: 'failed',
        failureReason: 'cancelled',
        transcript: 'Stopped by the operator.',
      };
    }

    if (spec.findings.length === 0) {
      await writeFile(
        path,
        `# ${spec.taskTitle ?? spec.ticketTitle}\n\n${spec.planSummary}\n\n${spec.steps
          .map((s, i) => `${i + 1}. ${s.title}`)
          .join('\n')}\n`,
        'utf8',
      );
    } else {
      const fixes = spec.findings.map((f) => `FIX: ${f.title} — ${f.detail}`).join('\n');
      await appendFile(path, `\n${fixes}\n`, 'utf8');
    }

    await input.onActivity?.({ kind: 'agent', message: 'Scripted agent finished' }).catch(() => {});
    return { status: 'succeeded', transcript: renderCodingPrompt(spec) };
  }
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'task'
  );
}
