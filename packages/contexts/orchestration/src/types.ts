import type { DomainEvent, GateKind, PolicySnapshot, RunStatus, StageKind } from '@ai-system/domain';

/** Everything advance() may read about a run. Loaded in the same transaction that applies the result. */
export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  currentStage: StageKind | null;
  version: number;
  policy: PolicySnapshot;
  iterationCount: number;
}

/** Side effects the engine requests. The runtime writes them to the outbox; the dispatcher enqueues them. */
export type Command =
  | { kind: 'execute_stage'; runId: string; stage: StageKind }
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
    }
  | {
      /** Event is not applicable in the current state (duplicate delivery, stale event). A safe no-op. */
      outcome: 'ignored';
      reason: string;
    };

export type EngineEvent = DomainEvent;
