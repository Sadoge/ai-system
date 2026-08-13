export type RunDetailSection = 'gates' | 'tasks' | 'artifacts' | 'events';

export const SECTION_CAPS = {
  gates: Number.POSITIVE_INFINITY,
  tasks: 12,
  artifacts: 12,
  events: 15,
} as const satisfies Record<RunDetailSection, number>;

// Source of truth: packages/domain/src/enums.ts. apps/web does not declare the
// domain package, so keep the fail-safe unknown branch non-terminal.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const RUNNING_STATUSES = new Set([
  'created',
  'classifying',
  'researching',
  'planning',
  'decomposing',
  'executing',
  'integrating',
  'reviewing',
  'testing',
  'documenting',
  'packaging',
  'running',
]);
const ATTENTION_STATUSES = new Set([
  'awaiting_split',
  'awaiting_plan_approval',
  'awaiting_pre_merge',
  'awaiting_iteration_gate',
  'awaiting_final_approval',
  'paused',
]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function statusTone(
  status: string,
): 'running' | 'attention' | 'success' | 'failed' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (ATTENTION_STATUSES.has(status)) return 'attention';
  if (RUNNING_STATUSES.has(status)) return 'running';
  return 'neutral';
}

interface SummarisableRun {
  gates?: { id: string; gate: string; status: string }[] | null;
  tasks?: { id: string; title: string; status: string }[] | null;
  artifacts?: unknown[] | null;
  events?: unknown[] | null;
}

export type AttentionItem =
  { kind: 'gate'; id: string; label: string } | { kind: 'task'; id: string; label: string };

export function summariseRun(run: SummarisableRun) {
  const gates = run.gates ?? [];
  const tasks = run.tasks ?? [];
  const artifacts = run.artifacts ?? [];
  const events = run.events ?? [];
  const needsAttention: AttentionItem[] = [
    ...gates
      .filter((gate) => gate.status === 'pending')
      .map((gate) => ({ kind: 'gate' as const, id: gate.id, label: gate.gate })),
    ...tasks
      .filter((task) => task.status === 'failed' || task.status === 'blocked')
      .map((task) => ({ kind: 'task' as const, id: task.id, label: task.title })),
  ];

  return {
    counts: {
      gates: gates.length,
      tasks: tasks.length,
      artifacts: artifacts.length,
      events: events.length,
    },
    needsAttention,
  };
}

export function defaultSectionOpen({
  section,
  status,
  itemCount,
  needsAttention,
}: {
  section: RunDetailSection;
  status: string;
  itemCount: number;
  needsAttention: AttentionItem[];
}): boolean {
  if (section === 'gates') {
    return !isTerminalStatus(status) || needsAttention.some((item) => item.kind === 'gate');
  }
  if (section === 'tasks') {
    return !isTerminalStatus(status) || needsAttention.some((item) => item.kind === 'task');
  }
  if (section === 'artifacts') return itemCount > 0;
  return status === 'failed';
}

export function capRows<T>(rows: readonly T[], cap: number, showAll: boolean) {
  if (showAll || !Number.isFinite(cap)) return { visible: [...rows], remaining: 0 };
  const visible = rows.slice(0, cap);
  return { visible, remaining: Math.max(0, rows.length - visible.length) };
}
