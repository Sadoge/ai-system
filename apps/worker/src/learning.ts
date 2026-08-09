import { desc, eq } from 'drizzle-orm';
import { knowledgeItems, pipelineRuns, reviewFindings } from '@ai-system/db';
import { TicketSnapshot } from '@ai-system/domain';
import { applyEvent } from '@ai-system/orchestration';
import { proposeKnowledge, recordEpisode } from '@ai-system/brain';
import { ImplementationPlan } from '@ai-system/agents';
import { agentCtx, latestArtifact } from './mvp-stages.js';
import type { StageServices } from './services.js';

/**
 * The learning loop (docs/08 §3), triggered by run completion:
 *   1. record the episode (no approval — it is record, not rule)
 *   2. distill candidate knowledge, cited to evidence from this run
 *   3. queue proposals for a human; nothing becomes retrievable until approved
 * Failures here never affect the run: it has already completed.
 */
export async function distillKnowledge(
  services: StageServices,
  input: { runId: string },
): Promise<{ proposed: number }> {
  const { db } = services;
  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.runId));
  const run = runRows[0];
  if (!run) return { proposed: 0 };
  // Eval replays measure the platform; they must never teach it. Learning
  // from a replay would double-count the source run's lessons and pollute
  // episodic memory with near-duplicates.
  if (run.evalOfRunId) return { proposed: 0 };

  if (services.embedder) {
    await recordEpisode(db, services.embedder, { runId: run.id });
  }

  const ticket = TicketSnapshot.parse(run.ticket);
  const planArtifact = await latestArtifact(db, run.id, 'implementation_plan');
  const diffArtifact = await latestArtifact(db, run.id, 'diff');
  const findings = await db.select().from(reviewFindings).where(eq(reviewFindings.runId, run.id));

  const existing = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.status, 'approved'))
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(50);
  const rejected = await db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.status, 'rejected'))
    .orderBy(desc(knowledgeItems.createdAt))
    .limit(50);

  const agents = await services.agents(run);
  const result = await agents.distill(
    {
      ticket,
      plan: planArtifact ? ImplementationPlan.parse(planArtifact.content) : null,
      diff: (diffArtifact?.content as { diff?: string })?.diff ?? '',
      findings: findings.map((f) => ({
        severity: f.severity,
        category: f.category,
        title: f.title,
        detail: f.detail,
      })),
      iterationCount: run.iterationCount,
      existingRules: existing.map((r) => ({ title: r.title, content: r.content })),
      rejected: rejected.map((r) => ({ title: r.title })),
    },
    agentCtx(run),
  );

  for (const proposal of result.proposals) {
    const { knowledgeItemId } = await proposeKnowledge(db, {
      organizationId: run.organizationId,
      projectId: run.projectId,
      kind: proposal.kind,
      title: proposal.title,
      content: proposal.content,
      sourceRunId: run.id,
      evidence: proposal.evidence,
    });
    await applyEvent(db, {
      name: 'knowledge.proposed',
      payload: {
        runId: run.id,
        knowledgeItemId,
        kind: proposal.kind,
        title: proposal.title,
      },
    });
  }
  return { proposed: result.proposals.length };
}
