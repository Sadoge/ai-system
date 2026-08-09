import { eq } from 'drizzle-orm';
import { pipelineRuns, reviewFindings, type Db } from '@ai-system/db';
import { indexChunks } from './chunks.js';
import type { Embedder } from './embedding.js';

/**
 * Layer 3 (docs/08 §1): completed runs and their findings are *record*, not
 * rule — they need no approval, because retrieving them tells an agent what
 * happened before, never what it must do.
 */
export async function recordEpisode(
  db: Db,
  embedder: Embedder,
  input: { runId: string },
): Promise<{ indexed: number }> {
  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.runId));
  const run = runRows[0];
  if (!run) return { indexed: 0 };

  const ticket = run.ticket as { title?: string; description?: string };
  const findings = await db
    .select()
    .from(reviewFindings)
    .where(eq(reviewFindings.runId, run.id));

  let indexed = 0;
  await indexChunks(db, embedder, {
    organizationId: run.organizationId,
    projectId: run.projectId,
    sourceType: 'run',
    sourceId: run.id,
    title: `Past run: ${ticket.title ?? run.id}`,
    content: [
      ticket.description ?? '',
      `Outcome: ${run.status}. Complexity: ${run.complexity ?? 'unknown'}. Iterations: ${run.iterationCount}.`,
      findings.length > 0
        ? `Review raised: ${findings.map((f) => `${f.severity} — ${f.title}`).join('; ')}`
        : 'Review raised no findings.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  indexed++;

  // Blocking findings are indexed separately: "has this bitten us here before?"
  for (const finding of findings.filter((f) => f.severity === 'blocker' || f.severity === 'major')) {
    await indexChunks(db, embedder, {
      organizationId: run.organizationId,
      projectId: run.projectId,
      sourceType: 'finding',
      sourceId: finding.id,
      title: `Past finding (${finding.severity}): ${finding.title}`,
      content: `${finding.detail}\n\nFile: ${finding.filePath ?? 'n/a'}. Category: ${finding.category}.`,
    });
    indexed++;
  }
  return { indexed };
}
