import { and, desc, eq } from 'drizzle-orm';
import { artifacts, type Db } from '@ai-system/db';
import type { ArtifactKind, GateKind } from '@ai-system/domain';

/**
 * The evidence a human needs to judge each gate (docs/05 §4). A gate that
 * arrives without its artifact is a gate answered on faith, so the mapping is
 * declared here rather than inlined at the call site — adding a gate should
 * force a decision about what a reviewer is supposed to read.
 *
 * `iteration_extension` is deliberately absent: no code path requests that
 * gate today (advance() resolves it, but pipelines.ts never returns it from
 * gateAfter), so there is nothing to enrich. Wiring it up is a behaviour
 * change for the engine, not a payload change.
 */
const GATE_EVIDENCE: Partial<Record<GateKind, ArtifactKind>> = {
  plan_approval: 'implementation_plan',
  pre_merge: 'integration_report',
  final_pr: 'pr_package',
};

export function evidenceKindFor(gate: GateKind): ArtifactKind | null {
  return GATE_EVIDENCE[gate] ?? null;
}

/** Attach the artifact a human needs to judge this gate (plan, integration, PR package). */
export async function enrichGatePayload(
  db: Db,
  runId: string,
  gate: GateKind,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const kind = evidenceKindFor(gate);
  if (!kind) return payload;
  const rows = await db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.kind, kind)))
    .orderBy(desc(artifacts.createdAt))
    .limit(1);
  // No artifact is not an error: the gate still opens, it just opens bare.
  return rows[0] ? { ...payload, artifactId: rows[0].id, artifactKind: kind } : payload;
}
