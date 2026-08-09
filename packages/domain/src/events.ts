import { z } from 'zod';
import { ArtifactKind, Complexity, GateDecisionKind, GateKind, StageKind } from './enums.js';
import { TicketSnapshot } from './ticket.js';

/**
 * The published language (docs/05 §3). Every payload is a Zod schema; the
 * engine and every consumer parse before acting — unvalidated JSON never
 * crosses a context boundary.
 */
export const EventPayloads = {
  'run.created': z.object({
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    ticket: TicketSnapshot,
  }),
  'run.stage.started': z.object({
    runId: z.string().uuid(),
    stageExecutionId: z.string().uuid(),
    stage: StageKind,
  }),
  'run.stage.completed': z.object({
    runId: z.string().uuid(),
    stageExecutionId: z.string().uuid(),
    stage: StageKind,
    artifactIds: z.array(z.string().uuid()).default([]),
  }),
  'run.stage.failed': z.object({
    runId: z.string().uuid(),
    stageExecutionId: z.string().uuid(),
    stage: StageKind,
    reason: z.string(),
  }),
  'run.complexity.classified': z.object({
    runId: z.string().uuid(),
    complexity: Complexity,
  }),
  'run.gate.requested': z.object({
    runId: z.string().uuid(),
    gateRequestId: z.string().uuid(),
    gate: GateKind,
  }),
  'run.gate.resolved': z.object({
    runId: z.string().uuid(),
    gateRequestId: z.string().uuid(),
    gate: GateKind,
    decision: GateDecisionKind,
    comment: z.string().optional(),
  }),
  'run.cancelled': z.object({
    runId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  'run.paused': z.object({
    runId: z.string().uuid(),
    reason: z.string(),
  }),
  'run.resumed': z.object({
    runId: z.string().uuid(),
  }),
  'artifact.created': z.object({
    runId: z.string().uuid(),
    artifactId: z.string().uuid(),
    kind: ArtifactKind,
  }),
  'model.call.completed': z.object({
    modelCallId: z.string().uuid(),
    runId: z.string().uuid().optional(),
    agentRunId: z.string().uuid().optional(),
    provider: z.string(),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  'budget.exhausted': z.object({
    runId: z.string().uuid(),
    limitUsd: z.number(),
    spentUsd: z.number(),
  }),
} as const;

export type EventName = keyof typeof EventPayloads;
export const EVENT_NAMES = Object.keys(EventPayloads) as EventName[];

export type EventPayload<N extends EventName> = z.infer<(typeof EventPayloads)[N]>;

export type DomainEvent = {
  [N in EventName]: { name: N; payload: EventPayload<N> };
}[EventName];

export function parseEvent(name: string, payload: unknown): DomainEvent {
  const schema = (EventPayloads as Record<string, z.ZodTypeAny>)[name];
  if (!schema) throw new Error(`Unknown domain event: ${name}`);
  return { name: name as EventName, payload: schema.parse(payload) } as DomainEvent;
}
