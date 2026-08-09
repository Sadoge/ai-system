import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { renderCodingPrompt } from './prompt.js';
import { presetFor, type AgentCliPreset } from './cli-presets.js';
import type { AgentExecutionInput, AgentExecutionResult, AgentExecutor } from './types.js';

const exec = promisify(execFile);
const TRANSCRIPT_LIMIT = 200_000;

export interface CliExecutorOptions {
  /** Preset name (`claude_code`, `codex`) or a fully custom preset. */
  preset?: string | AgentCliPreset;
  /** Override the binary — useful for a pinned path or a wrapper script. */
  binary?: string | undefined;
  /** Replace the preset's argv entirely (flags change between CLI versions). */
  args?: string[] | undefined;
  /** Model passed through to the CLI, when it supports one. */
  model?: string | undefined;
}

/**
 * Runs a headless coding-agent CLI inside a git worktree (docs/06). The CLI is
 * spawned directly — no shell — so prompt text can never be interpreted as
 * shell syntax, and the prompt goes over stdin so its size is unbounded.
 *
 * The subprocess receives a minimal environment: PATH, HOME, and only the
 * variables its preset allows. Repository credentials are never among them;
 * all git remote work happens on the host, outside the sandbox.
 */
export class CliAgentExecutor implements AgentExecutor {
  readonly executorKind = 'cli' as const;
  private readonly preset: AgentCliPreset;

  constructor(private readonly options: CliExecutorOptions = {}) {
    const preset = options.preset ?? 'claude_code';
    this.preset = typeof preset === 'string' ? presetFor(preset) : preset;
  }

  get cliName(): string {
    return this.preset.name;
  }

  /** Is the CLI actually installed? Used at startup and before a run needs it. */
  async isAvailable(): Promise<boolean> {
    try {
      await exec(this.binary(), this.preset.versionArgs, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  private binary(): string {
    return this.options.binary ?? this.preset.binary;
  }

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const prompt = renderCodingPrompt(input.taskSpec);
    // Always persisted next to the work, so a human can see exactly what ran.
    const promptFile = join(input.worktreeDir, '.ai-system-prompt.md');
    await writeFile(promptFile, prompt, 'utf8');

    const args = this.options.args ?? this.preset.buildArgs({ model: this.options.model });
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
    };
    for (const name of this.preset.envAllowlist) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }

    const argv = this.preset.promptDelivery === 'arg' ? [...args, prompt] : args;

    return new Promise((resolve) => {
      const child = spawn(this.binary(), argv, {
        cwd: input.worktreeDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < TRANSCRIPT_LIMIT) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < TRANSCRIPT_LIMIT) stderr += chunk.toString('utf8');
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({
          status: 'failed',
          failureReason: 'timeout',
          transcript: `${stdout}\n${stderr}`,
          usage: {},
        });
      }, input.limits.timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          status: 'failed',
          failureReason: 'sandbox_error',
          transcript: `${stderr}\n${err.message}`,
          usage: {},
          ...(isMissingBinary(err)
            ? { note: `${this.binary()} is not installed or not on PATH` }
            : {}),
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const parsed = this.preset.parse(stdout, stderr);
        const transcript = [parsed.text, stderr].filter(Boolean).join('\n').slice(-TRANSCRIPT_LIMIT);

        if (code !== 0) {
          resolve({
            status: 'failed',
            failureReason: 'sandbox_error',
            transcript: `${transcript}\n(exit code ${code})`,
            usage: parsed.usage,
          });
          return;
        }
        if (parsed.isError) {
          // The CLI ran fine but the agent itself reported failure — that is a
          // model-level failure, not a sandbox one, and the distinction drives
          // the engine's retry decision.
          resolve({
            status: 'failed',
            failureReason: 'model_error',
            transcript: `${transcript}\n${parsed.errorMessage ?? ''}`.trim(),
            usage: parsed.usage,
          });
          return;
        }
        resolve({ status: 'succeeded', transcript, usage: parsed.usage });
      });

      if (this.preset.promptDelivery === 'stdin') {
        child.stdin.write(prompt);
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  }
}

function isMissingBinary(err: NodeJS.ErrnoException): boolean {
  return err.code === 'ENOENT';
}
