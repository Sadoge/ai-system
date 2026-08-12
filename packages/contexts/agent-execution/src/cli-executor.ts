import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { renderCodingContinuationPrompt, renderCodingPrompt } from './prompt.js';
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
  /** Reasoning budget passed through to the CLI using its native flag/config. */
  effort?: 'low' | 'medium' | 'high' | undefined;
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
    if (input.signal?.aborted) return cancelledResult();
    const canResume =
      Boolean(input.resumeSessionId) &&
      Boolean(this.preset.buildResumeArgs) &&
      this.options.args === undefined;
    const prompt = canResume
      ? renderCodingContinuationPrompt(input.taskSpec)
      : renderCodingPrompt(input.taskSpec);
    // Always persisted next to the work, so a human can see exactly what ran.
    const promptFile = join(input.worktreeDir, '.ai-system-prompt.md');
    await writeFile(promptFile, prompt, 'utf8');

    const args = canResume
      ? this.preset.buildResumeArgs!({
          sessionId: input.resumeSessionId!,
          model: this.options.model,
          effort: this.options.effort,
        })
      : (this.options.args ??
        this.preset.buildArgs({ model: this.options.model, effort: this.options.effort }));
    const home = process.env.HOME ?? '';
    const path = [
      process.env.PNPM_HOME,
      home ? join(home, 'Library', 'pnpm') : undefined,
      home ? join(home, '.local', 'share', 'pnpm') : undefined,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH,
    ]
      .filter((part): part is string => Boolean(part))
      .join(':');
    const env: Record<string, string> = {
      PATH: path,
      HOME: home,
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
      let stdoutLines = '';
      let stderrLines = '';
      let sessionId = canResume ? input.resumeSessionId : undefined;
      let settled = false;
      const clocks: {
        heartbeat?: ReturnType<typeof setInterval>;
        timer?: ReturnType<typeof setTimeout>;
      } = {};
      let activityChain = Promise.resolve();
      const emit = (activity: Parameters<NonNullable<typeof input.onActivity>>[0]) => {
        if (!input.onActivity) return;
        activityChain = activityChain.then(() => input.onActivity!(activity)).catch(() => {});
      };
      const finish = async (result: AgentExecutionResult) => {
        if (settled) return;
        settled = true;
        if (clocks.timer) clearTimeout(clocks.timer);
        if (clocks.heartbeat) clearInterval(clocks.heartbeat);
        input.signal?.removeEventListener('abort', onAbort);
        await activityChain;
        resolve(result);
      };

      const onAbort = () => {
        emit({ kind: 'agent', message: `${this.cliName} was stopped by the operator` });
        child.kill('SIGKILL');
        void finish(cancelledResult(sessionId, `${stdout}\n${stderr}`));
      };

      emit({ kind: 'agent', message: `${this.cliName} process started` });
      if (canResume) emit({ kind: 'agent', message: `Resuming ${this.cliName} session` });
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < TRANSCRIPT_LIMIT) stdout += chunk.toString('utf8');
        stdoutLines += chunk.toString('utf8');
        const lines = stdoutLines.split('\n');
        stdoutLines = lines.pop() ?? '';
        for (const line of lines) {
          sessionId = this.preset.sessionId?.(line) ?? sessionId;
          const activity = this.preset.activity?.(line);
          if (activity) emit(activity);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (stderr.length < TRANSCRIPT_LIMIT) stderr += text;
        stderrLines += text;
        const lines = stderrLines.split('\n');
        stderrLines = lines.pop() ?? '';
        for (const line of lines) {
          const activity = diagnosticActivity(line);
          if (activity) emit(activity);
        }
      });

      clocks.heartbeat = setInterval(() => {
        emit({ kind: 'heartbeat', message: `${this.cliName} is still working` });
      }, 15_000);

      clocks.timer = setTimeout(() => {
        emit({
          kind: 'agent',
          message: `${this.cliName} exceeded its ${Math.ceil(input.limits.timeoutMs / 60_000)} minute limit and was stopped`,
        });
        child.kill('SIGKILL');
        void finish({
          status: 'failed',
          failureReason: 'timeout',
          transcript: `${stdout}\n${stderr}`,
          usage: {},
          ...(sessionId ? { sessionId } : {}),
        });
      }, input.limits.timeoutMs);

      child.on('error', (err) => {
        void finish({
          status: 'failed',
          failureReason: 'sandbox_error',
          transcript: `${stderr}\n${err.message}`,
          usage: {},
          ...(input.resumeSessionId ? { sessionId: input.resumeSessionId } : {}),
          ...(isMissingBinary(err)
            ? { note: `${this.binary()} is not installed or not on PATH` }
            : {}),
        });
      });

      child.on('close', (code) => {
        sessionId = this.preset.sessionId?.(stdoutLines) ?? sessionId;
        const finalActivity = this.preset.activity?.(stdoutLines);
        if (finalActivity) emit(finalActivity);
        const finalDiagnostic = diagnosticActivity(stderrLines);
        if (finalDiagnostic) emit(finalDiagnostic);
        const parsed = this.preset.parse(stdout, stderr);
        const transcript = [parsed.text, stderr]
          .filter(Boolean)
          .join('\n')
          .slice(-TRANSCRIPT_LIMIT);

        if (code !== 0) {
          if (wasInterrupted(stdout, stderr, parsed.errorMessage)) {
            void finish({
              status: 'failed',
              failureReason: 'cancelled',
              transcript: `${transcript}\n(exit code ${code})`,
              usage: parsed.usage,
              ...(sessionId ? { sessionId } : {}),
            });
            return;
          }
          void finish({
            status: 'failed',
            failureReason: 'sandbox_error',
            transcript: `${transcript}\n(exit code ${code})`,
            usage: parsed.usage,
            ...(sessionId ? { sessionId } : {}),
          });
          return;
        }
        if (parsed.isError) {
          // The CLI ran fine but the agent itself reported failure — that is a
          // model-level failure, not a sandbox one, and the distinction drives
          // the engine's retry decision.
          void finish({
            status: 'failed',
            failureReason: 'model_error',
            transcript: `${transcript}\n${parsed.errorMessage ?? ''}`.trim(),
            usage: parsed.usage,
            ...(sessionId ? { sessionId } : {}),
          });
          return;
        }
        void finish({
          status: 'succeeded',
          transcript,
          usage: parsed.usage,
          ...(sessionId ? { sessionId } : {}),
        });
      });

      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (input.signal?.aborted) onAbort();

      // Coding prompts are large, and a CLI that exits early — bad flags, an
      // expired login, an immediate refusal — closes stdin mid-write. That
      // surfaces as EPIPE, and an unhandled stream 'error' is thrown rather
      // than caught, which would kill the worker instead of failing the run.
      // The 'close'/'error' handlers above already report why the child left.
      child.stdin.on('error', () => {});
      if (!settled && this.preset.promptDelivery === 'stdin') {
        child.stdin.write(prompt);
        child.stdin.end();
      } else if (!settled) {
        child.stdin.end();
      }
    });
  }
}

function cancelledResult(sessionId?: string, transcript = ''): AgentExecutionResult {
  return {
    status: 'failed',
    failureReason: 'cancelled',
    transcript: transcript || 'Stopped by the operator.',
    usage: {},
    ...(sessionId ? { sessionId } : {}),
  };
}

function isMissingBinary(err: NodeJS.ErrnoException): boolean {
  return err.code === 'ENOENT';
}

function wasInterrupted(stdout: string, stderr: string, errorMessage?: string): boolean {
  return /turn(?:_|\s)+(?:was\s+)?(?:aborted|interrupted)|\binterrupted\b/i.test(
    `${stdout}\n${stderr}\n${errorMessage ?? ''}`,
  );
}

function diagnosticActivity(line: string): { kind: 'message'; message: string } | null {
  const compact = line.replace(/\s+/g, ' ').trim();
  if (!compact || !/\b(?:error|warn(?:ing)?)\b/i.test(compact)) return null;
  const redacted = compact
    .replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|PASSWORD|SECRET)[A-Z0-9_]*)=\S+/gi, '$1=[redacted]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]');
  return {
    kind: 'message',
    message: redacted.length > 240 ? `${redacted.slice(0, 239)}…` : redacted,
  };
}
