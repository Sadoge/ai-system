import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderCodingPrompt } from './prompt.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

const TRANSCRIPT_LIMIT = 200_000;

export interface CliExecutorOptions {
  /**
   * Command template; {prompt_file} is replaced with the prompt's path.
   * Default targets Claude Code non-interactive mode.
   */
  commandTemplate?: string;
  /** Env var names passed through to the sandboxed process (beyond PATH/HOME). */
  envAllowlist?: string[];
}

const DEFAULT_COMMAND = 'claude -p "$(cat {prompt_file})" --output-format text';
const DEFAULT_ENV_ALLOWLIST = ['ANTHROPIC_API_KEY', 'LANG', 'TERM'];

/**
 * MVP coding executor (docs/06): wraps a headless agent CLI inside a git
 * worktree. The subprocess gets a minimal environment — never repository
 * credentials; git operations happen outside the sandbox.
 */
export class CliAgentExecutor implements AgentExecutor {
  readonly executorKind = 'cli' as const;
  private readonly commandTemplate: string;
  private readonly envAllowlist: string[];

  constructor(options: CliExecutorOptions = {}) {
    this.commandTemplate = options.commandTemplate ?? DEFAULT_COMMAND;
    this.envAllowlist = options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const promptFile = join(input.worktreeDir, '.ai-system-prompt.md');
    await writeFile(promptFile, renderCodingPrompt(input.taskSpec), 'utf8');
    const command = this.commandTemplate.replaceAll('{prompt_file}', promptFile);

    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
    };
    for (const name of this.envAllowlist) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }

    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', command], {
        cwd: input.worktreeDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let transcript = '';
      const capture = (chunk: Buffer) => {
        if (transcript.length < TRANSCRIPT_LIMIT) transcript += chunk.toString('utf8');
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ status: 'failed', failureReason: 'timeout', transcript });
      }, input.limits.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ status: 'succeeded', transcript });
        else resolve({ status: 'failed', failureReason: 'sandbox_error', transcript });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          status: 'failed',
          failureReason: 'sandbox_error',
          transcript: `${transcript}\n${err.message}`,
        });
      });
    });
  }
}
