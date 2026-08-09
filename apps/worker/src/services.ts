import type { Db, pipelineRuns } from '@ai-system/db';
import type { Agents } from '@ai-system/agents';
import type { Embedder } from '@ai-system/brain';
import type { AgentExecutor } from '@ai-system/agent-execution';

/** Composition-root dependencies every stage handler receives. */
export interface StageServices {
  db: Db;
  /**
   * Agents for a specific run — model profiles resolve per run through the
   * cascade project > org > platform default (docs/07 §4).
   */
  agents: (run: typeof pipelineRuns.$inferSelect) => Promise<Agents>;
  executor: AgentExecutor;
  /** Absent only if embeddings are unavailable; retrieval degrades to structural + rules. */
  embedder: Embedder | undefined;
  /** Root for cached checkouts (repos/<id>) and run worktrees (worktrees/<runId>). */
  dataDir: string;
  codingTimeoutMs: number;
  githubToken: string | undefined;
}
