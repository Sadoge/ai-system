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
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--config', `model_reasoning_effort="${effort}"`] : []),
  ],
  promptDelivery: 'stdin',
  versionArgs: ['--version'],
  // Saved Codex login is read through HOME/CODEX_HOME; API keys stay outside.
  envAllowlist: ['CODEX_HOME', 'LANG', 'TERM'],
  parse(stdout, stderr) {
    const lines = stdout.split('\n').filter((l) => l.trim().startsWith('{'));
    for (const line of lines.reverse()) {
      try {
        const data = JSON.parse(line) as {
          type?: string;
          text?: string;
          message?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          total_cost_usd?: number;
        };
        if (data.text || data.message) {
          return {
            text: data.text ?? data.message ?? '',
            isError: false,
            usage: {
              ...(data.total_cost_usd !== undefined ? { costUsd: data.total_cost_usd } : {}),
              ...(data.usage?.input_tokens !== undefined
                ? { inputTokens: data.usage.input_tokens }
                : {}),
              ...(data.usage?.output_tokens !== undefined
                ? { outputTokens: data.usage.output_tokens }
                : {}),
            },
          };
        }
      } catch {
        // Not a JSON line — fall through to the raw-text path.
      }
    }
    return { text: stdout || stderr, isError: false, usage: {} };
  },
};

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
