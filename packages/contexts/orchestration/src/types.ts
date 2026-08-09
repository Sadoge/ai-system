import type {
  DomainEvent,
  GateKind,
  PolicySnapshot,
  RunStatus,
  StageKind,
  TaskStatus,
} from '@ai-system/domain';

/** A task DAG node as the engine sees it. Loaded with the run, inside the same transaction. */
export interface TaskSnapshot {
  id: string;
  status: TaskStatus;
  dependsOn: string[];
  attemptCount: number;
  maxAttempts: number;
}

/** Everything advance() may read about a run. Loaded in the same transaction that applies the result. */
export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  currentStage: StageKind | null;
  version: number;
  policy: PolicySnapshot;
  iterationCount: number;
  /** Empty for pipelines without a task DAG (trivial, mvp_linear). */
  tasks: TaskSnapshot[];
}

/** Side effects the engine requests. The runtime writes them to the outbox; the dispatcher enqueues them. */
export type Command =
  | { kind: 'execute_stage'; runId: string; stage: StageKind }
  | { kind: 'execute_task'; runId: string; taskId: string }
  | { kind: 'request_gate'; runId: string; gate: GateKind; payload?: Record<string, unknown> };

export type AdvanceResult =
  | {
      outcome: 'transitioned';
      status: RunStatus;
      currentStage: StageKind | null;
      commands: Command[];
      error?: string;
      /** Set when the transition consumed or granted an iteration (docs/05 §5). */
      iterationCount?: number;
      /**
       * Complexity specialization of the frozen policy — written exactly once,
       * when classification lands.
       */
      policyPatch?: Partial<PolicySnapshot>;
      /** Task status changes the runtime must persist alongside the transition. */
      taskUpdates?: { taskId: string; status: TaskStatus }[];
    }
  | {
      /** Event is not applicable in the current state (duplicate delivery, stale event). A safe no-op. */
      outcome: 'ignored';
      reason: string;
    };

export type EngineEvent = DomainEvent;
