import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import {
  artifacts,
  domainEvents,
  gateRequests,
  knowledgeItems,
  modelCalls,
  modelProfiles,
  pipelineRuns,
  projects,
  repositories,
  reviewFindings,
  stageExecutions,
  createDb,
  createPool,
  type Db,
} from '@ai-system/db';
import {
  TicketSnapshot,
  defaultMvpPolicy,
  defaultTeamPolicy,
  defaultTrivialPolicy,
  uuidv7,
  type GateDecisionKind,
  type KnowledgeKind,
} from '@ai-system/domain';
import { applyEvent, listTasks, resolveGate, startRun } from '@ai-system/orchestration';
import {
  addManualKnowledge,
  brainQuery,
  decideKnowledge,
  latestIndexSnapshot,
  type Embedder,
} from '@ai-system/brain';
import { fetchJiraTicket, jiraConfigFromEnv } from '@ai-system/integrations';
import {
  DrizzleCallLedger,
  LocalHashEmbeddingAdapter,
  ModelGateway,
  OpenAiEmbeddingAdapter,
  PLATFORM_DEFAULT_PROFILES,
} from '@ai-system/model-gateway';
import { DB } from './db.provider.js';

function buildEmbedder(): Embedder | undefined {
  const pool = createPool();
  const db = createDb(pool);
  // The OpenAI SDK throws at construction without a key, so it is only
  // registered when one exists; the local embedder always is.
  const gateway = new ModelGateway([], new DrizzleCallLedger(db), {
    embeddingAdapters: [
      ...(process.env.OPENAI_API_KEY ? [new OpenAiEmbeddingAdapter()] : []),
      new LocalHashEmbeddingAdapter(),
    ],
  });
  const profile = process.env.OPENAI_API_KEY
    ? PLATFORM_DEFAULT_PROFILES.embeddings!
    : { purpose: 'embeddings', primary: { provider: 'local', model: 'local-hash' }, fallbacks: [] };
  return {
    embed: async (texts) =>
      (await gateway.embed(profile, { texts, meta: { purpose: 'embeddings' } })).vectors,
  };
}

@Injectable()
export class ApiService {
  /**
   * Same deterministic local embedder the worker falls back to, so the brain
   * inspector and knowledge approval behave identically to a real run.
   */
  private readonly embedder: Embedder | undefined = buildEmbedder();

  constructor(@Inject(DB) private readonly db: Db) {}

  // ── projects & repositories ─────────────────────────────────────────

  async listProjects() {
    const projectRows = await this.db.select().from(projects);
    const repoRows = await this.db.select().from(repositories);
    return projectRows.map((p) => ({
      ...p,
      repositories: repoRows.filter((r) => r.projectId === p.id),
    }));
  }

  async registerRepository(input: {
    remoteUrl: string;
    name?: string | undefined;
    defaultBranch: string;
    testCommand?: string | undefined;
    projectId?: string | undefined;
  }) {
    const project = await this.pickProject(input.projectId);
    const id = uuidv7();
    await this.db.insert(repositories).values({
      id,
      organizationId: project.organizationId,
      projectId: project.id,
      name: input.name ?? input.remoteUrl.split('/').pop() ?? input.remoteUrl,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      settings: input.testCommand ? { testCommand: input.testCommand } : {},
    });
    return { repositoryId: id };
  }

  // ── runs ────────────────────────────────────────────────────────────

  async listRuns(limit = 50) {
    return this.db
      .select({
        id: pipelineRuns.id,
        status: pipelineRuns.status,
        currentStage: pipelineRuns.currentStage,
        complexity: pipelineRuns.complexity,
        iterationCount: pipelineRuns.iterationCount,
        ticket: pipelineRuns.ticket,
        policySnapshot: pipelineRuns.policySnapshot,
        createdAt: pipelineRuns.createdAt,
        updatedAt: pipelineRuns.updatedAt,
      })
      .from(pipelineRuns)
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit);
  }

  async startRun(input: {
    ticket?: TicketSnapshot | undefined;
    jiraKey?: string | undefined;
    pipeline: 'trivial' | 'mvp' | 'team';
    automation: 'plan_gated' | 'autonomous';
    projectId?: string | undefined;
    repositoryId?: string | undefined;
  }) {
    let ticket = input.ticket;
    if (!ticket && input.jiraKey) {
      const jira = jiraConfigFromEnv();
      if (!jira) throw new NotFoundException('Jira is not configured (JIRA_BASE_URL/EMAIL/API_TOKEN)');
      ticket = await fetchJiraTicket(jira, input.jiraKey);
    }
    if (!ticket) throw new NotFoundException('no ticket provided');

    const project = await this.pickProject(input.projectId);
    let repositoryId = input.repositoryId;
    if (input.pipeline !== 'trivial' && !repositoryId) {
      const repos = await this.db
        .select()
        .from(repositories)
        .where(eq(repositories.projectId, project.id))
        .limit(2);
      if (repos.length !== 1) throw new NotFoundException('pass repositoryId (0 or >1 repos registered)');
      repositoryId = repos[0]!.id;
    }
    const policy =
      input.pipeline === 'team'
        ? defaultTeamPolicy(input.automation)
        : input.pipeline === 'mvp'
          ? defaultMvpPolicy(input.automation)
          : defaultTrivialPolicy();
    return startRun(this.db, {
      organizationId: project.organizationId,
      projectId: project.id,
      ...(repositoryId ? { repositoryId } : {}),
      ticket,
      policy,
    });
  }

  async getRun(runId: string) {
    const runRows = await this.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
    const run = runRows[0];
    if (!run) throw new NotFoundException(`unknown run ${runId}`);
    const [stages, arts, findings, gates, cost, taskRows] = await Promise.all([
      this.db
        .select()
        .from(stageExecutions)
        .where(eq(stageExecutions.runId, runId))
        .orderBy(asc(stageExecutions.createdAt)),
      this.db
        .select({
          id: artifacts.id,
          kind: artifacts.kind,
          contentHash: artifacts.contentHash,
          createdAt: artifacts.createdAt,
        })
        .from(artifacts)
        .where(eq(artifacts.runId, runId))
        .orderBy(asc(artifacts.createdAt)),
      this.db
        .select()
        .from(reviewFindings)
        .where(eq(reviewFindings.runId, runId))
        .orderBy(asc(reviewFindings.createdAt)),
      this.db
        .select()
        .from(gateRequests)
        .where(eq(gateRequests.runId, runId))
        .orderBy(asc(gateRequests.createdAt)),
      this.runCostUsd(runId),
      listTasks(this.db, runId),
    ]);
    return { ...run, stages, artifacts: arts, findings, gates, costUsd: cost, tasks: taskRows };
  }

  async getArtifact(runId: string, artifactId: string) {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.id, artifactId)));
    if (!rows[0]) throw new NotFoundException('unknown artifact');
    return rows[0];
  }

  async listEvents(runId: string, afterId?: string) {
    return this.db
      .select()
      .from(domainEvents)
      .where(
        afterId
          ? and(eq(domainEvents.runId, runId), gt(domainEvents.id, afterId))
          : eq(domainEvents.runId, runId),
      )
      .orderBy(asc(domainEvents.id))
      .limit(500);
  }

  async runCostUsd(runId: string): Promise<number> {
    const rows = await this.db
      .select({ total: sql<string>`coalesce(sum(${modelCalls.costUsd}), 0)` })
      .from(modelCalls)
      .where(eq(modelCalls.runId, runId));
    return Number(rows[0]?.total ?? 0);
  }

  // ── gates ───────────────────────────────────────────────────────────

  async listGates(status?: string) {
    const rows = await this.db
      .select()
      .from(gateRequests)
      .where(status ? eq(gateRequests.status, status) : undefined)
      .orderBy(desc(gateRequests.createdAt))
      .limit(100);
    return rows;
  }

  async resolveGate(gateRequestId: string, decision: GateDecisionKind, comment?: string) {
    await resolveGate(this.db, {
      gateRequestId,
      decision,
      ...(comment !== undefined ? { comment } : {}),
    });
    return { resolved: true };
  }

  // ── review findings across runs ──────────────────────────────────────

  /** Findings dashboard: every finding with its run, newest first. */
  async listFindings(status?: string) {
    const rows = await this.db
      .select({
        id: reviewFindings.id,
        runId: reviewFindings.runId,
        severity: reviewFindings.severity,
        category: reviewFindings.category,
        title: reviewFindings.title,
        detail: reviewFindings.detail,
        filePath: reviewFindings.filePath,
        status: reviewFindings.status,
        createdAt: reviewFindings.createdAt,
        ticket: pipelineRuns.ticket,
      })
      .from(reviewFindings)
      .innerJoin(pipelineRuns, eq(reviewFindings.runId, pipelineRuns.id))
      .where(status ? eq(reviewFindings.status, status) : undefined)
      .orderBy(desc(reviewFindings.createdAt))
      .limit(200);

    const byCategory = new Map<string, number>();
    for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
    return {
      findings: rows,
      byCategory: [...byCategory.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ── knowledge ───────────────────────────────────────────────────────

  async listKnowledge(status?: string) {
    return this.db
      .select()
      .from(knowledgeItems)
      .where(status ? eq(knowledgeItems.status, status) : undefined)
      .orderBy(desc(knowledgeItems.createdAt))
      .limit(200);
  }

  /** The approval inbox decision. Approving embeds the item; rejecting keeps it as a negative example. */
  async decideKnowledge(input: {
    knowledgeItemId: string;
    decision: 'approved' | 'rejected';
    editedTitle?: string | undefined;
    editedContent?: string | undefined;
  }) {
    const result = await decideKnowledge(this.db, input, this.embedder);
    const rows = await this.db
      .select({ title: knowledgeItems.title })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, input.knowledgeItemId));
    await applyEvent(this.db, {
      name: input.decision === 'approved' ? 'knowledge.approved' : 'knowledge.rejected',
      payload: { knowledgeItemId: input.knowledgeItemId, title: rows[0]?.title ?? '' },
    });
    return result;
  }

  /**
   * Brain inspector (docs/08 §6): show exactly what the Context Assembler
   * would select for a given query, and what it dropped to fit the budget.
   */
  async inspectBrain(input: { projectId?: string; query: string; repositoryId?: string }) {
    const project = await this.pickProject(input.projectId);
    const repoRows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, project.id))
      .limit(1);
    const repo = repoRows[0];
    const index = repo ? await latestIndexSnapshot(this.db, repo.id) : null;
    const keywords = [
      ...new Set(
        input.query
          .toLowerCase()
          .split(/[^a-z0-9_]+/)
          .filter((w) => w.length > 3),
      ),
    ].slice(0, 12);

    const context = await brainQuery(this.db, {
      projectId: project.id,
      ...(repo ? { repositoryId: repo.id } : {}),
      index,
      need: {
        structural: { keywords },
        rules: {},
        semantic: { query: input.query },
        episodic: { query: input.query },
      },
      ...(this.embedder ? { embedder: this.embedder } : {}),
    });
    return {
      query: input.query,
      keywords,
      hasIndex: index !== null,
      embedderAvailable: this.embedder !== undefined,
      ...context,
    };
  }

  async addKnowledge(input: {
    kind: KnowledgeKind;
    title: string;
    content: string;
    projectId?: string | undefined;
  }) {
    const project = await this.pickProject(input.projectId);
    return addManualKnowledge(
      this.db,
      {
        organizationId: project.organizationId,
        projectId: project.id,
        kind: input.kind,
        title: input.title,
        content: input.content,
      },
      this.embedder,
    );
  }

  // ── model profiles ──────────────────────────────────────────────────

  async listModelProfiles() {
    return this.db.select().from(modelProfiles).orderBy(desc(modelProfiles.createdAt)).limit(200);
  }

  async addModelProfile(input: {
    purpose: string;
    provider: string;
    model: string;
    params: Record<string, unknown>;
    fallbacks: { provider: string; model: string }[];
    projectId?: string | undefined;
    organizationId?: string | undefined;
  }) {
    const id = uuidv7();
    await this.db.insert(modelProfiles).values({
      id,
      organizationId: input.organizationId ?? null,
      projectId: input.projectId ?? null,
      purpose: input.purpose,
      provider: input.provider,
      model: input.model,
      params: input.params,
      fallbacks: input.fallbacks,
    });
    return { modelProfileId: id };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private async pickProject(projectId?: string) {
    if (projectId) {
      const rows = await this.db.select().from(projects).where(eq(projects.id, projectId));
      if (!rows[0]) throw new NotFoundException(`unknown project ${projectId}`);
      return rows[0];
    }
    const rows = await this.db.select().from(projects).limit(2);
    if (rows.length === 0) throw new NotFoundException('no projects — seed first');
    if (rows.length > 1) throw new NotFoundException('multiple projects — pass projectId');
    return rows[0]!;
  }
}
