import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { AdapterCompletion, ChatMessage, ProviderAdapter } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 2_000_000;

export interface SubscriptionCliStatus {
  available: boolean;
  authenticated: boolean;
  detail: string;
}

export interface SubscriptionCliOptions {
  binary?: string;
  timeoutMs?: number;
  cwd?: string;
  /** Intended for tests and nonstandard CLI installations. */
  env?: Record<string, string>;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function promptFor(system: string | undefined, messages: ChatMessage[]): string {
  const sections = [
    ...(system ? [`## System instructions\n${system}`] : []),
    ...messages.map(
      (message) =>
        `## ${message.role === 'user' ? 'User' : 'Assistant'} message\n${message.content}`,
    ),
  ];
  return sections.join('\n\n');
}

function cliEnvironment(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [
    'PATH',
    'HOME',
    'LANG',
    'TERM',
    'TMPDIR',
    'USER',
    'SHELL',
    'CODEX_HOME',
    'CLAUDE_CONFIG_DIR',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

function runCli(
  binary: string,
  args: string[],
  stdin: string,
  options: SubscriptionCliOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd ?? tmpdir(),
      env: cliEnvironment(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        const detail =
          error.code === 'ENOENT' ? `${binary} is not installed or not on PATH` : error.message;
        reject(new Error(detail));
      });
    });
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = (stderr || stdout).trim().slice(-4_000);
        reject(
          new Error(
            `${binary} exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
          ),
        );
      });
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() =>
        reject(new Error(`${binary} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`)),
      );
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    // A CLI that exits before draining its stdin — a crash, an auth failure, a
    // refusal — makes this write fail with EPIPE. An unhandled 'error' on a
    // stream is thrown, so without this listener an early exit takes the whole
    // process down instead of rejecting. The child's own exit is already
    // diagnosed by the 'close'/'error' handlers above, which carry the exit
    // code and stderr; the write failure itself says nothing extra.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

function codexOutput(stdout: string): AdapterCompletion {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let reportedError = '';

  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        item?: { type?: string; text?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string } | string;
      };
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        text = event.item.text ?? text;
      }
      if (event.type === 'turn.completed') {
        inputTokens = event.usage?.input_tokens ?? inputTokens;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      }
      if (event.type === 'turn.failed' || event.type === 'error') {
        reportedError =
          typeof event.error === 'string'
            ? event.error
            : (event.error?.message ?? event.message ?? reportedError);
      }
    } catch {
      // Progress output from older CLI versions may not be JSON; ignore it.
    }
  }

  if (!text) {
    if (reportedError) throw new Error(reportedError);
    throw new Error('Codex CLI completed without a final agent message');
  }
  return { text, inputTokens, outputTokens };
}

/**
 * Completion adapter backed by `codex exec` and the user's saved ChatGPT login.
 * It deliberately omits API-key variables, uses an ephemeral read-only session,
 * and disables repository/user instructions so only the persisted agent prompt
 * influences the result.
 */
export class CodexSubscriptionAdapter implements ProviderAdapter {
  readonly provider = 'codex_cli';
  private readonly binary: string;

  constructor(private readonly options: SubscriptionCliOptions = {}) {
    this.binary = options.binary ?? 'codex';
  }

  async status(): Promise<SubscriptionCliStatus> {
    try {
      const result = await runCli(this.binary, ['login', 'status'], '', {
        ...this.options,
        timeoutMs: Math.min(this.options.timeoutMs ?? 15_000, 15_000),
      });
      const detail = `${result.stdout}\n${result.stderr}`.trim();
      return {
        available: true,
        authenticated: /logged in using chatgpt/i.test(detail),
        detail: detail || 'Codex CLI returned no authentication status',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        available: !/not installed|not on PATH/i.test(detail),
        authenticated: false,
        detail,
      };
    }
  }

  async complete(
    model: string,
    req: {
      system?: string;
      messages: ChatMessage[];
      maxTokens: number;
      temperature?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
    },
  ): Promise<AdapterCompletion> {
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '--json',
      ...(model !== 'default' ? ['--model', model] : []),
      ...(req.reasoningEffort
        ? ['--config', `model_reasoning_effort="${req.reasoningEffort}"`]
        : []),
      '-',
    ];
    try {
      return codexOutput(
        (await runCli(this.binary, args, promptFor(req.system, req.messages), this.options)).stdout,
      );
    } catch (error) {
      throw new Error(
        `Codex subscription provider failed. Run \`codex login\` and choose ChatGPT sign-in. ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}

function claudeOutput(stdout: string): AdapterCompletion {
  let data: {
    result?: string;
    is_error?: boolean;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    data = JSON.parse(stdout.trim()) as typeof data;
  } catch {
    throw new Error('Claude CLI returned invalid JSON');
  }
  if (data.is_error) throw new Error(data.result || 'Claude CLI reported an error');
  if (!data.result) throw new Error('Claude CLI completed without a result');
  return {
    text: data.result,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

/** Completion adapter backed by `claude -p` and the user's saved Claude login. */
export class ClaudeSubscriptionAdapter implements ProviderAdapter {
  readonly provider = 'claude_cli';
  private readonly binary: string;

  constructor(private readonly options: SubscriptionCliOptions = {}) {
    this.binary = options.binary ?? 'claude';
  }

  async status(): Promise<SubscriptionCliStatus> {
    try {
      const result = await runCli(this.binary, ['auth', 'status'], '', {
        ...this.options,
        timeoutMs: Math.min(this.options.timeoutMs ?? 15_000, 15_000),
      });
      const detail = `${result.stdout}\n${result.stderr}`.trim();
      let authenticated = false;
      try {
        authenticated = (JSON.parse(result.stdout) as { loggedIn?: boolean }).loggedIn === true;
      } catch {
        authenticated = /logged.?in/i.test(detail) && !/not logged.?in/i.test(detail);
      }
      return {
        available: true,
        authenticated,
        detail: detail || 'Claude CLI returned no authentication status',
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        available: !/not installed|not on PATH/i.test(detail),
        authenticated: false,
        detail,
      };
    }
  }

  async complete(
    model: string,
    req: {
      system?: string;
      messages: ChatMessage[];
      maxTokens: number;
      temperature?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
    },
  ): Promise<AdapterCompletion> {
    const args = [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'dontAsk',
      '--tools',
      '',
      '--no-session-persistence',
      '--safe-mode',
      ...(model !== 'default' ? ['--model', model] : []),
      ...(req.reasoningEffort ? ['--effort', req.reasoningEffort] : []),
    ];
    try {
      return claudeOutput(
        (await runCli(this.binary, args, promptFor(req.system, req.messages), this.options)).stdout,
      );
    } catch (error) {
      throw new Error(
        `Claude subscription provider failed. Run \`claude auth login\` first. ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}
