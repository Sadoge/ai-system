import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { renderCodingPrompt } from './prompt.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

const exec = promisify(execFile);
const MAX_READ_BYTES = 100_000;
const MAX_COMMAND_OUTPUT = 20_000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

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

function buildTools(allowedCommands: string[]) {
  return [
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
    {
      name: 'edit_file',
      description:
        'Replace an exact string in a file. old_string must occur exactly once; include enough surrounding context to make it unique. Prefer this over write_file for existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    ...(allowedCommands.length > 0
      ? [
          {
            name: 'run_command',
            description: `Run one of the repository's allowlisted commands in the workspace and return its output. Allowed commands (must match EXACTLY): ${allowedCommands.map((c) => JSON.stringify(c)).join(', ')}`,
            parameters: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        ]
      : []),
  ];
}

/**
 * Platform-owned coding agent (docs/06 §1, `api_loop`): instead of shelling out
 * to a CLI, the platform runs the tool loop itself through the Model Gateway.
 *
 * Sandboxing is structural, not advisory: every file path is confined to the
 * task's worktree (traversal is rejected, not sanitized), and `run_command`
 * executes only strings the repository itself declared — the model selects
 * from the allowlist, it never composes shell. The loop is bounded by
 * iterations, tool calls, and the run's cost budget.
 */
export class ApiLoopAgentExecutor implements AgentExecutor {
  readonly executorKind = 'api_loop' as const;

  constructor(
    private readonly runner: ToolLoopRunner,
    private readonly profile: unknown,
    private readonly options: ApiLoopOptions = {},
  ) {}

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    if (input.signal?.aborted) {
      return {
        status: 'failed',
        failureReason: 'cancelled',
        transcript: 'Stopped by the operator.',
      };
    }
    const root = resolve(input.worktreeDir);
    const allowedCommands = input.allowedCommands ?? [];
    const transcript: string[] = [];

    const resolveInside = (relPath: string): string => {
      const full = resolve(root, relPath);
      if (full !== root && !full.startsWith(root + sep)) {
        throw new Error(`path "${relPath}" escapes the workspace`);
      }
      return full;
    };

    try {
      await input
        .onActivity?.({ kind: 'agent', message: 'API agent loop started' })
        .catch(() => {});
      const result = await this.runner.toolLoop(this.profile, {
        system:
          'You are a coding agent working inside an isolated git worktree. Use the tools to inspect and edit files; prefer edit_file for surgical changes to existing files. Run the allowlisted commands to check your work when they exist. Implement exactly what the task asks, nothing more. When finished, reply with a one-paragraph summary of what you changed.',
        messages: [{ role: 'user', content: renderCodingPrompt(input.taskSpec) }],
        tools: buildTools(allowedCommands),
        maxIterations: this.options.maxIterations ?? 16,
        maxToolCalls: this.options.maxToolCalls ?? 60,
        meta: {
          purpose: 'coding',
          runId: input.runId,
          agentRunId: input.agentRunId,
        },
        // Tool failures — including sandbox violations — are reported back to
        // the model as errors rather than thrown, so containment holds no
        // matter who drives the loop, and the model can correct itself.
        executeTool: async (call) => {
          if (input.signal?.aborted) throw new Error('run cancelled by operator');
          const args = call.arguments as {
            path?: string;
            content?: string;
            old_string?: string;
            new_string?: string;
            command?: string;
          };
          const path = String(args.path ?? '');
          const target = call.name === 'run_command' ? '' : path;
          await input
            .onActivity?.({
              kind: 'tool',
              message:
                call.name === 'run_command'
                  ? 'Running an allowlisted repository command'
                  : target
                    ? `${call.name}: ${target}`.slice(0, 240)
                    : call.name,
            })
            .catch(() => {});
          transcript.push(
            `> ${call.name} ${call.name === 'run_command' ? String(args.command ?? '') : path}`,
          );
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
              case 'edit_file': {
                const full = resolveInside(path);
                const oldString = String(args.old_string ?? '');
                const newString = String(args.new_string ?? '');
                if (oldString.length === 0) {
                  return { content: 'old_string must not be empty', isError: true };
                }
                const content = await readFile(full, 'utf8');
                const first = content.indexOf(oldString);
                if (first === -1) {
                  return { content: `old_string not found in ${path}`, isError: true };
                }
                if (content.indexOf(oldString, first + 1) !== -1) {
                  // Ambiguity is an error, never a guess: editing the wrong
                  // occurrence is worse than asking the model to disambiguate.
                  return {
                    content: `old_string occurs more than once in ${path}; include more surrounding context`,
                    isError: true,
                  };
                }
                await writeFile(full, content.replace(oldString, newString), 'utf8');
                return { content: `edited ${path}` };
              }
              case 'run_command': {
                const command = String(args.command ?? '');
                if (!allowedCommands.includes(command)) {
                  return {
                    content: `command not in the repository allowlist: ${command}`,
                    isError: true,
                  };
                }
                try {
                  const { stdout, stderr } = await exec('bash', ['-c', command], {
                    cwd: root,
                    timeout: COMMAND_TIMEOUT_MS,
                    signal: input.signal,
                    maxBuffer: 16 * 1024 * 1024,
                    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
                  });
                  return { content: (stdout + stderr).slice(-MAX_COMMAND_OUTPUT) || '(no output)' };
                } catch (err) {
                  const e = err as { stdout?: string; stderr?: string; message: string };
                  return {
                    content: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`.slice(
                      -MAX_COMMAND_OUTPUT,
                    ),
                    isError: true,
                  };
                }
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

      if (input.signal?.aborted) {
        return {
          status: 'failed',
          failureReason: 'cancelled',
          transcript: `${transcript.join('\n')}\nStopped by the operator.`.trim(),
        };
      }

      transcript.push(result.text);
      await input
        .onActivity?.({ kind: 'message', message: result.text.replace(/\s+/g, ' ').slice(0, 240) })
        .catch(() => {});
      return { status: 'succeeded', transcript: transcript.join('\n') };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      transcript.push(`ERROR: ${message}`);
      return {
        status: 'failed',
        failureReason:
          input.signal?.aborted || /\bcancelled\b/i.test(message)
            ? 'cancelled'
            : message.includes('budget')
              ? 'budget_denied'
              : 'model_error',
        transcript: transcript.join('\n'),
      };
    }
  }
}
