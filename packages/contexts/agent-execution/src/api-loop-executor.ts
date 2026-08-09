import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { renderCodingPrompt } from './prompt.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

const MAX_READ_BYTES = 100_000;

/** The gateway surface this executor needs — kept structural so the package imports no SDK. */
export interface ToolLoopRunner {
  toolLoop(
    profile: unknown,
    req: {
      system?: string;
      messages: { role: 'user' | 'assistant'; content: string }[];
      tools: { name: string; description: string; parameters: Record<string, unknown> }[];
      executeTool: (call: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ content: string; isError?: boolean }>;
      maxIterations: number;
      maxToolCalls: number;
      meta: { purpose: string; runId?: string; agentRunId?: string; budgetUsd?: number | null };
    },
  ): Promise<{ text: string; toolCallCount: number; costUsd: number }>;
}

export interface ApiLoopOptions {
  maxIterations?: number;
  maxToolCalls?: number;
}

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files under a directory relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory, "." for root' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 file relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 file relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
];

/**
 * Platform-owned coding agent (docs/06 §1, `api_loop`): instead of shelling out
 * to a CLI, the platform runs the tool loop itself through the Model Gateway.
 * Every file operation is confined to the task's worktree — path traversal is
 * rejected, not sanitized — and the loop is bounded by iterations, tool calls,
 * and the run's cost budget.
 */
export class ApiLoopAgentExecutor implements AgentExecutor {
  readonly executorKind = 'api_loop' as const;

  constructor(
    private readonly runner: ToolLoopRunner,
    private readonly profile: unknown,
    private readonly options: ApiLoopOptions = {},
  ) {}

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const root = resolve(input.worktreeDir);
    const transcript: string[] = [];

    const resolveInside = (relPath: string): string => {
      const full = resolve(root, relPath);
      if (full !== root && !full.startsWith(root + sep)) {
        throw new Error(`path "${relPath}" escapes the workspace`);
      }
      return full;
    };

    try {
      const result = await this.runner.toolLoop(this.profile, {
        system:
          'You are a coding agent working inside an isolated git worktree. Use the tools to inspect and edit files. Implement exactly what the task asks, nothing more. When finished, reply with a one-paragraph summary of what you changed.',
        messages: [{ role: 'user', content: renderCodingPrompt(input.taskSpec) }],
        tools: TOOLS,
        maxIterations: this.options.maxIterations ?? 12,
        maxToolCalls: this.options.maxToolCalls ?? 40,
        meta: {
          purpose: 'coding',
          runId: input.runId,
          agentRunId: input.agentRunId,
        },
        // Tool failures — including sandbox violations — are reported back to
        // the model as errors rather than thrown, so containment holds no
        // matter who drives the loop, and the model can correct itself.
        executeTool: async (call) => {
          const args = call.arguments as { path?: string; content?: string };
          const path = String(args.path ?? '');
          transcript.push(`> ${call.name} ${path}`);
          try {
            switch (call.name) {
              case 'list_files': {
                const dir = resolveInside(path || '.');
                const entries = await readdir(dir, { withFileTypes: true });
                return {
                  content: entries
                    .filter((e) => e.name !== '.git')
                    .map(
                      (e) =>
                        `${relative(root, join(dir, e.name)) || e.name}${e.isDirectory() ? '/' : ''}`,
                    )
                    .join('\n'),
                };
              }
              case 'read_file': {
                const content = await readFile(resolveInside(path), 'utf8');
                return { content: content.slice(0, MAX_READ_BYTES) };
              }
              case 'write_file': {
                const full = resolveInside(path);
                await mkdir(dirname(full), { recursive: true });
                await writeFile(full, String(args.content ?? ''), 'utf8');
                return { content: `wrote ${path}` };
              }
              default:
                return { content: `unknown tool ${call.name}`, isError: true };
            }
          } catch (err) {
            return {
              content: err instanceof Error ? err.message : String(err),
              isError: true,
            };
          }
        },
      });

      transcript.push(result.text);
      return { status: 'succeeded', transcript: transcript.join('\n') };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      transcript.push(`ERROR: ${message}`);
      return {
        status: 'failed',
        failureReason: message.includes('budget') ? 'budget_denied' : 'model_error',
        transcript: transcript.join('\n'),
      };
    }
  }
}
