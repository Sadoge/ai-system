export type AgentCliName = 'claude_code' | 'codex' | 'custom';

export interface CliUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface CliParseResult {
  text: string;
  usage: CliUsage;
  /** The CLI ran but reported a failure of its own (not a crash). */
  isError: boolean;
  errorMessage?: string;
}

export interface AgentCliPreset {
  name: AgentCliName;
  binary: string;
  /** Argv after the binary. Built per invocation so the model can be injected. */
  buildArgs(input: {
    model?: string | undefined;
    effort?: 'low' | 'medium' | 'high' | undefined;
  }): string[];
  /**
   * Prompts are long and contain arbitrary text, so `stdin` is the default:
   * it avoids shell quoting entirely and cannot hit ARG_MAX.
   */
  promptDelivery: 'stdin' | 'arg';
  /** Cheap liveness probe, e.g. `claude --version`. */
  versionArgs: string[];
  parse(stdout: string, stderr: string): CliParseResult;
  /** Parse one complete stdout line into safe live operator feedback. */
  activity?(line: string): { kind: 'agent' | 'tool' | 'message'; message: string } | null;
  /** Env vars forwarded into the sandbox, beyond PATH/HOME. Never repository credentials. */
  envAllowlist: string[];
}

/**
 * Claude Code in non-interactive mode. Flags and the JSON shape below were
 * verified against Claude Code 2.1.x: `--output-format json` emits a single
 * object with `result`, `is_error`, `total_cost_usd`, `usage` and `modelUsage`.
 */
export const CLAUDE_CODE_PRESET: AgentCliPreset = {
  name: 'claude_code',
  binary: 'claude',
  buildArgs: ({ model, effort }) => [
    '-p',
    '--output-format',
    'json',
    // The worktree is the sandbox; edits inside it should not prompt.
    '--permission-mode',
    'acceptEdits',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
  ],
  promptDelivery: 'stdin',
  versionArgs: ['--version'],
  // OAuth is subscription-backed; API keys are deliberately not forwarded.
  envAllowlist: ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'LANG', 'TERM'],
  parse(stdout, stderr) {
    try {
      const data = JSON.parse(stdout.trim()) as {
        result?: string;
        is_error?: boolean;
        total_cost_usd?: number;
        usage?: { input_tokens?: number; output_tokens?: number };
        modelUsage?: Record<string, unknown>;
      };
      const models = Object.keys(data.modelUsage ?? {});
      return {
        text: data.result ?? '',
        isError: data.is_error === true,
        ...(data.is_error === true ? { errorMessage: data.result ?? 'CLI reported an error' } : {}),
        usage: {
          ...(data.total_cost_usd !== undefined ? { costUsd: data.total_cost_usd } : {}),
          ...(data.usage?.input_tokens !== undefined
            ? { inputTokens: data.usage.input_tokens }
            : {}),
          ...(data.usage?.output_tokens !== undefined
            ? { outputTokens: data.usage.output_tokens }
            : {}),
          // Several models may be used in one session (e.g. a small model for
          // side tasks); report the priciest as the headline model.
          ...(models.length > 0 ? { model: pickCostliestModel(data.modelUsage!) } : {}),
        },
      };
    } catch {
      // Not JSON (older version, or --output-format text): the run still
      // happened, so keep the output rather than failing the task.
      return { text: stdout || stderr, isError: false, usage: {} };
    }
  },
};

/**
 * OpenAI Codex CLI in non-interactive `exec` mode.
 *
 * NOTE: unlike the Claude Code preset, these defaults were NOT verified
 * against a live binary in this environment (Codex was not installed). They
 * follow documented `codex exec` usage and are fully overridable per
 * repository (`settings.executorBinary` / `settings.executorArgs`) so a flag
 * change never requires a code change. Output is parsed leniently: the last
 * JSON object on a JSONL stream if present, otherwise raw text.
 */
export const CODEX_PRESET: AgentCliPreset = {
  name: 'codex',
  binary: 'codex',
  buildArgs: ({ model, effort }) => [
    'exec',
    // Let the agent edit files in the worktree without prompting.
    '--full-auto',
    // JSONL exposes structured progress while the process is still running.
    '--json',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--config', `model_reasoning_effort="${effort}"`] : []),
  ],
  promptDelivery: 'stdin',
  versionArgs: ['--version'],
  // Saved Codex login is read through HOME/CODEX_HOME; API keys stay outside.
  envAllowlist: ['CODEX_HOME', 'LANG', 'TERM'],
  parse(stdout, stderr) {
    let text = '';
    let errorMessage = '';
    const usage: CliUsage = {};
    const lines = stdout.split('\n').filter((line) => line.trim().startsWith('{'));
    for (const line of lines) {
      try {
        const data = JSON.parse(line) as {
          type?: string;
          text?: string;
          message?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          total_cost_usd?: number;
          item?: { type?: string; text?: string };
        };
        if (data.item?.type === 'agent_message' && data.item.text) text = data.item.text;
        else if (data.text || (data.type !== 'error' && data.message)) {
          text = data.text ?? data.message ?? text;
        }
        if (data.type === 'error' && data.message) errorMessage = data.message;
        if (data.total_cost_usd !== undefined) usage.costUsd = data.total_cost_usd;
        if (data.usage?.input_tokens !== undefined) usage.inputTokens = data.usage.input_tokens;
        if (data.usage?.output_tokens !== undefined) usage.outputTokens = data.usage.output_tokens;
      } catch {
        // Not a JSON line — fall through to the raw-text path.
      }
    }
    if (text || errorMessage || Object.keys(usage).length > 0) {
      return {
        text: text || errorMessage,
        isError: Boolean(errorMessage),
        ...(errorMessage ? { errorMessage } : {}),
        usage,
      };
    }
    return { text: stdout || stderr, isError: false, usage: {} };
  },
  activity(line) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        item?: {
          type?: string;
          text?: string;
          command?: string;
          server?: string;
          tool?: string;
          query?: string;
        };
      };
      if (event.type === 'thread.started') {
        return { kind: 'agent', message: 'Codex session started' };
      }
      if (event.type === 'turn.started') {
        return { kind: 'agent', message: 'Analyzing the task' };
      }
      if (event.type === 'turn.completed') {
        return { kind: 'agent', message: 'Finishing the agent run' };
      }
      if (event.type === 'error' && event.message) {
        return { kind: 'message', message: safeSummary(event.message) };
      }
      const item = event.item;
      if (!item) return null;
      if (item.type === 'agent_message' && item.text) {
        return { kind: 'message', message: safeSummary(item.text) };
      }
      if (item.type === 'command_execution' && event.type === 'item.started') {
        return {
          kind: 'tool',
          message: item.command
            ? `Running ${safeCommand(item.command)}`
            : 'Running a workspace command',
        };
      }
      if (item.type === 'mcp_tool_call' && event.type === 'item.started') {
        const target = [item.server, item.tool].filter(Boolean).join(' / ');
        return { kind: 'tool', message: target ? `Calling ${target}` : 'Calling a connected tool' };
      }
      if (item.type === 'web_search' && event.type === 'item.started') {
        return {
          kind: 'tool',
          message: item.query ? `Searching for ${safeSummary(item.query)}` : 'Searching the web',
        };
      }
      if (item.type === 'file_change') {
        return { kind: 'tool', message: 'Editing workspace files' };
      }
      return null;
    } catch {
      return null;
    }
  },
};

function safeSummary(value: string, limit = 240): string {
  const firstLine = value.replace(/\s+/g, ' ').trim();
  return firstLine.length > limit ? `${firstLine.slice(0, limit - 1)}…` : firstLine;
}

function safeCommand(value: string): string {
  const redacted = value
    .replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|PASSWORD|SECRET)[A-Z0-9_]*)=\S+/gi, '$1=[redacted]')
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]');
  return safeSummary(redacted, 180);
}

function pickCostliestModel(modelUsage: Record<string, unknown>): string {
  let best = '';
  let bestCost = -1;
  for (const [model, usage] of Object.entries(modelUsage)) {
    const cost = (usage as { costUSD?: number }).costUSD ?? 0;
    if (cost > bestCost) {
      bestCost = cost;
      best = model;
    }
  }
  return best;
}

export const AGENT_CLI_PRESETS: Record<Exclude<AgentCliName, 'custom'>, AgentCliPreset> = {
  claude_code: CLAUDE_CODE_PRESET,
  codex: CODEX_PRESET,
};

export function presetFor(name: string): AgentCliPreset {
  const preset = AGENT_CLI_PRESETS[name as Exclude<AgentCliName, 'custom'>];
  if (!preset) throw new Error(`unknown agent CLI preset "${name}"`);
  return preset;
}
