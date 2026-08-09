import type { Db } from '@ai-system/db';
import type { Agents } from '@ai-system/agents';
import type { AgentExecutor } from '@ai-system/agent-execution';

/** Composition-root dependencies every stage handler receives. */
export interface StageServices {
  db: Db;
  agents: Agents;
  executor: AgentExecutor;
  /** Root for cached checkouts (repos/<id>) and run worktrees (worktrees/<runId>). */
  dataDir: string;
  codingTimeoutMs: number;
  githubToken: string | undefined;
}
