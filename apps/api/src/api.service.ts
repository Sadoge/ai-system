import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import {
  artifacts,
  createDb,
  createPool,
  domainEvents,
  gateRequests,
  knowledgeItems,
  modelCalls,
  modelCatalog,
  modelProfiles,
  organizations,
  pipelineRuns,
  projects,
  repositories,
  reviewFindings,
  stageExecutions,
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
import {
  applyEvent,
  compareEvalRun,
  listTasks,
  resolveGate,
  startEvalReplay,
  startRun,
} from '@ai-system/orchestration';
import {
  addManualKnowledge,
  brainQuery,
  decideKnowledge,
  latestIndexSnapshot,
  promoteKnowledge,
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
import {
  QuotaExceededError,
  assertCan,
  assertRunAllowed,
  auditToCsv,
  createApiKey,
  getQuotas,
  listApiKeys,
  listAudit,
  recordAudit,
  revokeApiKey,
  setQuotas,
  type OrgQuotas,
  type Principal,
  type Role,
} from '@ai-system/tenancy';
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
  private readonly embedder: Embedder | undefined = buildEmbedder();

  constructor(@Inject(DB) private readonly db: Db) {}

  // ── projects & repositories ─────────────────────────────────────────

  async listProjects(principal: Principal) {
    assertCan(principal.role, 'settings:read');
    const projectRows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, principal.organizationId));
    const repoRows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.organizationId, principal.organizationId));
    return projectRows.map((p) => ({
      ...p,
      repositories: repoRows.filter((r) => r.projectId === p.id),
    }));
  }

  async registerRepository(
    principal: Principal,
    input: {
      remoteUrl: string;
      name?: string | undefined;
      defaultBranch: string;
      testCommand?: string | undefined;
      executor?: string | undefined;
      executorModel?: string | undefined;
      reviewers?: string[] | undefined;
      projectId?: string | undefined;
    },
  ) {
    assertCan(principal.role, 'settings:write');
    const project = await this.pickProject(principal, input.projectId);
    const id = uuidv7();
    await this.db.insert(repositories).values({
      id,
      organizationId: principal.organizationId,
      projectId: project.id,
      name: input.name ?? input.remoteUrl.split('/').pop() ?? input.remoteUrl,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      settings: {
        ...(input.testCommand ? { testCommand: input.testCommand } : {}),
        ...(input.executor ? { executor: input.executor } : {}),
        ...(input.executorModel ? { executorModel: input.executorModel } : {}),
        ...(input.reviewers?.length ? { reviewers: input.reviewers } : {}),
      },
    });
    await recordAudit(this.db, {
      principal,
      action: 'repository.registered',
      subjectType: 'repository',
      subjectId: id,
      data: { remoteUrl: input.remoteUrl, executor: input.executor ?? 'default' },
    });
    return { repositoryId: id };
  }

  // ── runs ────────────────────────────────────────────────────────────

  async listRuns(principal: Principal, limit = 50) {
    assertCan(principal.role, 'run:read');
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
      .where(eq(pipelineRuns.organizationId, principal.organizationId))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(limit);
  }

  async startRun(
    principal: Principal,
    input: {
      ticket?: TicketSnapshot | undefined;
      jiraKey?: string | undefined;
      pipeline: 'trivial' | 'mvp' | 'team';
      automation: 'plan_gated' | 'autonomous';
      projectId?: string | undefined;
      repositoryId?: string | undefined;
    },
  ) {
    assertCan(principal.role, 'run:start');
    try {
      await assertRunAllowed(this.db, principal.organizationId);
    } catch (err: unknown) {
      if (err instanceof QuotaExceededError) throw new ForbiddenException(err.message);
      throw err;
    }

    let ticket = input.ticket;
    if (!ticket && input.jiraKey) {
      const jira = jiraConfigFromEnv();
      if (!jira) throw new NotFoundException('Jira is not configured (JIRA_BASE_URL/EMAIL/API_TOKEN)');
      ticket = await fetchJiraTicket(jira, input.jiraKey);
    }
    if (!ticket) throw new NotFoundException('no ticket provided');

    const project = await this.pickProject(principal, input.projectId);
    let repositoryId = input.repositoryId;
    if (input.pipeline !== 'trivial') {
      const repos = await this.db
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.projectId, project.id),
            eq(repositories.organizationId, principal.organizationId),
          ),
        );
      if (repositoryId) {
        if (!repos.some((r) => r.id === repositoryId)) {
          throw new NotFoundException('unknown repository for this organization');
        }
      } else {
        if (repos.length !== 1) throw new NotFoundException('pass repositoryId (0 or >1 repos registered)');
        repositoryId = repos[0]!.id;
      }
    }
    const policy =
      input.pipeline === 'team'
        ? defaultTeamPolicy(input.automation)
        : input.pipeline === 'mvp'
          ? defaultMvpPolicy(input.automation)
          : defaultTrivialPolicy();

    const result = await startRun(this.db, {
      organizationId: principal.organizationId,
      projectId: project.id,
      ...(repositoryId ? { repositoryId } : {}),
      ticket,
      policy,
    });
    await recordAudit(this.db, {
      principal,
      action: 'run.started',
      subjectType: 'pipeline_run',
      subjectId: result.runId,
      data: { pipeline: policy.pipeline, ticket: ticket.title },
    });
    return result;
  }

  async getRun(principal: Principal, runId: string) {
    const run = await this.requireRun(principal, runId);
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

  async getArtifact(principal: Principal, runId: string, artifactId: string) {
    await this.requireRun(principal, runId);
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.id, artifactId)));
    if (!rows[0]) throw new NotFoundException('unknown artifact');
    return rows[0];
  }

  async listEvents(principal: Principal, runId: string, afterId?: string) {
    await this.requireRun(principal, runId);
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

  // ── evaluation harness ──────────────────────────────────────────────

  async startEval(principal: Principal, sourceRunId: string) {
    assertCan(principal.role, 'run:start');
    await this.requireRun(principal, sourceRunId);
    const result = await startEvalReplay(this.db, {
      sourceRunId,
      organizationId: principal.organizationId,
    });
    await recordAudit(this.db, {
      principal,
      action: 'eval.started',
      subjectType: 'pipeline_run',
      subjectId: result.evalRunId,
      data: { sourceRunId },
    });
    return result;
  }

  async compareEval(principal: Principal, evalRunId: string) {
    await this.requireRun(principal, evalRunId);
    return compareEvalRun(this.db, { evalRunId, organizationId: principal.organizationId });
  }

  // ── gates ───────────────────────────────────────────────────────────

  async listGates(principal: Principal, status?: string) {
    assertCan(principal.role, 'run:read');
    return this.db
      .select({
        id: gateRequests.id,
        runId: gateRequests.runId,
        gate: gateRequests.gate,
        status: gateRequests.status,
        payload: gateRequests.payload,
        assignedToUserId: gateRequests.assignedToUserId,
        createdAt: gateRequests.createdAt,
      })
      .from(gateRequests)
      .innerJoin(pipelineRuns, eq(gateRequests.runId, pipelineRuns.id))
      .where(
        status
          ? and(
              eq(pipelineRuns.organizationId, principal.organizationId),
              eq(gateRequests.status, status),
            )
          : eq(pipelineRuns.organizationId, principal.organizationId),
      )
      .orderBy(desc(gateRequests.createdAt))
      .limit(100);
  }

  async assignGate(principal: Principal, gateRequestId: string, userId: string | null) {
    assertCan(principal.role, 'gate:decide');
    const gate = await this.requireGate(principal, gateRequestId);
    await this.db
      .update(gateRequests)
      .set({ assignedToUserId: userId })
      .where(eq(gateRequests.id, gate.id));
    await recordAudit(this.db, {
      principal,
      action: 'gate.assigned',
      subjectType: 'gate_request',
      subjectId: gate.id,
      data: { assignedToUserId: userId },
    });
    return { assigned: true };
  }

  async resolveGate(
    principal: Principal,
    gateRequestId: string,
    decision: GateDecisionKind,
    comment?: string,
  ) {
    assertCan(principal.role, 'gate:decide');
    const gate = await this.requireGate(principal, gateRequestId);
    await resolveGate(this.db, {
      gateRequestId: gate.id,
      decision,
      ...(comment !== undefined ? { comment } : {}),
      ...(principal.userId ? { decidedByUserId: principal.userId } : {}),
    });
    // Approvals are the decisions a human may later be asked to justify.
    await recordAudit(this.db, {
      principal,
      action: `gate.${decision}`,
      subjectType: 'gate_request',
      subjectId: gate.id,
      data: { gate: gate.gate, runId: gate.runId, comment: comment ?? null },
    });
    return { resolved: true };
  }

  // ── review findings ─────────────────────────────────────────────────

  async listFindings(principal: Principal, status?: string) {
    assertCan(principal.role, 'run:read');
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
      .where(
        status
          ? and(
              eq(pipelineRuns.organizationId, principal.organizationId),
              eq(reviewFindings.status, status),
            )
          : eq(pipelineRuns.organizationId, principal.organizationId),
      )
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

  async listKnowledge(principal: Principal, status?: string) {
    assertCan(principal.role, 'knowledge:read');
    return this.db
      .select()
      .from(knowledgeItems)
      .where(
        status
          ? and(
              eq(knowledgeItems.organizationId, principal.organizationId),
              eq(knowledgeItems.status, status),
            )
          : eq(knowledgeItems.organizationId, principal.organizationId),
      )
      .orderBy(desc(knowledgeItems.createdAt))
      .limit(200);
  }

  async addKnowledge(
    principal: Principal,
    input: {
      kind: KnowledgeKind;
      title: string;
      content: string;
      projectId?: string | undefined;
    },
  ) {
    assertCan(principal.role, 'knowledge:write');
    const project = await this.pickProject(principal, input.projectId);
    const result = await addManualKnowledge(
      this.db,
      {
        organizationId: principal.organizationId,
        projectId: project.id,
        kind: input.kind,
        title: input.title,
        content: input.content,
      },
      this.embedder,
    );
    await recordAudit(this.db, {
      principal,
      action: 'knowledge.added',
      subjectType: 'knowledge_item',
      subjectId: result.knowledgeItemId,
      data: { kind: input.kind, title: input.title },
    });
    return result;
  }

  async decideKnowledge(
    principal: Principal,
    input: {
      knowledgeItemId: string;
      decision: 'approved' | 'rejected';
      editedTitle?: string | undefined;
      editedContent?: string | undefined;
    },
  ) {
    assertCan(principal.role, 'knowledge:approve');
    const rows = await this.db
      .select()
      .from(knowledgeItems)
      .where(
        and(
          eq(knowledgeItems.id, input.knowledgeItemId),
          eq(knowledgeItems.organizationId, principal.organizationId),
        ),
      );
    if (!rows[0]) throw new NotFoundException('unknown knowledge item');

    const result = await decideKnowledge(this.db, input, this.embedder);
    await applyEvent(this.db, {
      name: input.decision === 'approved' ? 'knowledge.approved' : 'knowledge.rejected',
      payload: { knowledgeItemId: input.knowledgeItemId, title: rows[0].title },
    });
    await recordAudit(this.db, {
      principal,
      action: `knowledge.${input.decision}`,
      subjectType: 'knowledge_item',
      subjectId: input.knowledgeItemId,
      data: { title: rows[0].title, edited: input.editedContent !== undefined },
    });
    return result;
  }

  async promoteKnowledge(principal: Principal, knowledgeItemId: string) {
    assertCan(principal.role, 'knowledge:approve');
    await promoteKnowledge(
      this.db,
      { knowledgeItemId, organizationId: principal.organizationId },
      this.embedder,
    );
    await recordAudit(this.db, {
      principal,
      action: 'knowledge.promoted',
      subjectType: 'knowledge_item',
      subjectId: knowledgeItemId,
      data: { scope: 'organization' },
    });
    return { promoted: true };
  }

  /**
   * Retrieval tuning from outcomes (docs/10 Phase 4), the honest version:
   * for each approved rule, how did runs that actually received it fare?
   * Correlation, not causation — the numbers earn a closer look, they do not
   * pass judgment. Reads inline task_spec artifacts only, so S3-offloaded
   * bundles are excluded (noted in the response).
   */
  async knowledgeEffectiveness(principal: Principal) {
    assertCan(principal.role, 'knowledge:read');
    const result = await this.db.execute(sql`
      select
        ki.id,
        ki.title,
        ki.kind,
        (ki.project_id is null) as org_wide,
        count(distinct pr.id) filter (where pr.status = 'completed') as completed_runs,
        count(distinct pr.id) filter (where pr.status = 'failed') as failed_runs,
        coalesce(avg(pr.iteration_count), 0) as avg_iterations
      from knowledge_items ki
      left join artifacts a
        on a.kind = 'task_spec'
        and a.content is not null
        and exists (
          select 1 from jsonb_array_elements(a.content->'taskSpec'->'rules') r
          where r->>'title' = ki.title
        )
      left join pipeline_runs pr
        on pr.id = a.run_id
        and pr.status in ('completed', 'failed')
        and pr.eval_of_run_id is null
        and pr.organization_id = ${principal.organizationId}
      where ki.organization_id = ${principal.organizationId}
        and ki.status = 'approved'
      group by ki.id, ki.title, ki.kind
      order by (count(distinct pr.id)) desc, ki.created_at desc
    `);
    return (result.rows as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      orgWide: row.org_wide === true,
      completedRuns: Number(row.completed_runs ?? 0),
      failedRuns: Number(row.failed_runs ?? 0),
      avgIterations: Number(row.avg_iterations ?? 0),
    }));
  }

  async inspectBrain(
    principal: Principal,
    input: { projectId?: string; query: string; repositoryId?: string },
  ) {
    assertCan(principal.role, 'knowledge:read');
    const project = await this.pickProject(principal, input.projectId);
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

  // ── model profiles & catalog ────────────────────────────────────────

  async listModelProfiles(principal: Principal) {
    assertCan(principal.role, 'settings:read');
    return this.db
      .select()
      .from(modelProfiles)
      .where(
        or(
          eq(modelProfiles.organizationId, principal.organizationId),
          isNull(modelProfiles.organizationId),
        ),
      )
      .orderBy(desc(modelProfiles.createdAt))
      .limit(200);
  }

  async addModelProfile(
    principal: Principal,
    input: {
      purpose: string;
      provider: string;
      model: string;
      params: Record<string, unknown>;
      fallbacks: { provider: string; model: string }[];
      projectId?: string | undefined;
    },
  ) {
    assertCan(principal.role, 'settings:write');
    if (input.projectId) await this.pickProject(principal, input.projectId);
    const id = uuidv7();
    await this.db.insert(modelProfiles).values({
      id,
      organizationId: principal.organizationId,
      projectId: input.projectId ?? null,
      purpose: input.purpose,
      provider: input.provider,
      model: input.model,
      params: input.params,
      fallbacks: input.fallbacks,
    });
    await recordAudit(this.db, {
      principal,
      action: 'model_profile.added',
      subjectType: 'model_profile',
      subjectId: id,
      data: { purpose: input.purpose, provider: input.provider, model: input.model },
    });
    return { modelProfileId: id };
  }

  async listCatalog(principal: Principal) {
    assertCan(principal.role, 'settings:read');
    return this.db
      .select()
      .from(modelCatalog)
      .where(
        or(
          eq(modelCatalog.organizationId, principal.organizationId),
          isNull(modelCatalog.organizationId),
        ),
      )
      .orderBy(asc(modelCatalog.provider), asc(modelCatalog.model));
  }

  async upsertCatalogEntry(
    principal: Principal,
    input: {
      provider: string;
      model: string;
      inputPerMTokUsd: number;
      outputPerMTokUsd: number;
      capabilities?: Record<string, unknown> | undefined;
    },
  ) {
    assertCan(principal.role, 'settings:write');
    const id = uuidv7();
    await this.db
      .insert(modelCatalog)
      .values({
        id,
        organizationId: principal.organizationId,
        provider: input.provider,
        model: input.model,
        inputPerMTokUsd: input.inputPerMTokUsd.toFixed(6),
        outputPerMTokUsd: input.outputPerMTokUsd.toFixed(6),
        capabilities: input.capabilities ?? {},
      })
      .onConflictDoUpdate({
        target: [modelCatalog.organizationId, modelCatalog.provider, modelCatalog.model],
        set: {
          inputPerMTokUsd: input.inputPerMTokUsd.toFixed(6),
          outputPerMTokUsd: input.outputPerMTokUsd.toFixed(6),
          capabilities: input.capabilities ?? {},
        },
      });
    return { ok: true };
  }

  // ── analytics ───────────────────────────────────────────────────────

  /** Daily spend by provider — the shape a cost chart needs. */
  async costSeries(principal: Principal, days = 30) {
    assertCan(principal.role, 'run:read');
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db
      .select({
        day: sql<string>`date_trunc('day', ${modelCalls.createdAt})::date::text`,
        provider: modelCalls.provider,
        costUsd: sql<string>`sum(${modelCalls.costUsd})`,
        calls: sql<string>`count(*)`,
      })
      .from(modelCalls)
      .innerJoin(pipelineRuns, eq(modelCalls.runId, pipelineRuns.id))
      .where(
        and(
          eq(pipelineRuns.organizationId, principal.organizationId),
          gte(modelCalls.createdAt, since),
          isNull(pipelineRuns.evalOfRunId),
        ),
      )
      .groupBy(sql`1`, modelCalls.provider)
      .orderBy(sql`1`);
    return rows.map((r) => ({
      day: r.day,
      provider: r.provider,
      costUsd: Number(r.costUsd),
      calls: Number(r.calls),
    }));
  }

  /** Cost split by the purpose each call served (planning, review, coding, ...). */
  async costByPurpose(principal: Principal, days = 30) {
    assertCan(principal.role, 'run:read');
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db
      .select({
        purpose: modelCalls.purpose,
        costUsd: sql<string>`sum(${modelCalls.costUsd})`,
      })
      .from(modelCalls)
      .innerJoin(pipelineRuns, eq(modelCalls.runId, pipelineRuns.id))
      .where(
        and(
          eq(pipelineRuns.organizationId, principal.organizationId),
          gte(modelCalls.createdAt, since),
          isNull(pipelineRuns.evalOfRunId),
        ),
      )
      .groupBy(modelCalls.purpose)
      .orderBy(desc(sql`sum(${modelCalls.costUsd})`));
    return rows.map((r) => ({ purpose: r.purpose, costUsd: Number(r.costUsd) }));
  }

  /** Outcome analytics: what fraction of runs land, and what they cost to get there. */
  async runAnalytics(principal: Principal, days = 30) {
    assertCan(principal.role, 'run:read');
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.db
      .select({
        status: pipelineRuns.status,
        pipeline: sql<string>`${pipelineRuns.policySnapshot}->>'pipeline'`,
        count: sql<string>`count(*)`,
        avgIterations: sql<string>`avg(${pipelineRuns.iterationCount})`,
        avgMinutes: sql<string>`avg(extract(epoch from (${pipelineRuns.updatedAt} - ${pipelineRuns.createdAt}))/60)`,
      })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.organizationId, principal.organizationId),
          gte(pipelineRuns.createdAt, since),
          // Eval replays measure the platform; they are not delivery work.
          isNull(pipelineRuns.evalOfRunId),
        ),
      )
      .groupBy(pipelineRuns.status, sql`2`);

    const byStatus = rows.map((r) => ({
      status: r.status,
      pipeline: r.pipeline ?? 'unknown',
      count: Number(r.count),
      avgIterations: Number(r.avgIterations ?? 0),
      avgMinutes: Number(r.avgMinutes ?? 0),
    }));
    const finished = byStatus.filter((r) => ['completed', 'failed'].includes(r.status));
    const completed = finished.filter((r) => r.status === 'completed').reduce((n, r) => n + r.count, 0);
    const total = finished.reduce((n, r) => n + r.count, 0);
    return {
      byStatus,
      // Only finished runs count: in-flight runs would otherwise depress the rate.
      successRate: total > 0 ? completed / total : null,
      finishedRuns: total,
    };
  }

  // ── organization administration ─────────────────────────────────────

  async listApiKeys(principal: Principal) {
    assertCan(principal.role, 'org:admin');
    return listApiKeys(this.db, principal.organizationId);
  }

  async createApiKey(principal: Principal, input: { name: string; role: Role }) {
    assertCan(principal.role, 'org:admin');
    const created = await createApiKey(this.db, {
      organizationId: principal.organizationId,
      name: input.name,
      role: input.role,
    });
    await recordAudit(this.db, {
      principal,
      action: 'api_key.created',
      subjectType: 'api_key',
      subjectId: created.apiKeyId,
      data: { name: input.name, role: input.role, keyPrefix: created.keyPrefix },
    });
    // The plaintext is returned once here and never again.
    return created;
  }

  async revokeApiKey(principal: Principal, apiKeyId: string) {
    assertCan(principal.role, 'org:admin');
    await revokeApiKey(this.db, apiKeyId, principal.organizationId);
    await recordAudit(this.db, {
      principal,
      action: 'api_key.revoked',
      subjectType: 'api_key',
      subjectId: apiKeyId,
    });
    return { revoked: true };
  }

  async getOrganization(principal: Principal) {
    assertCan(principal.role, 'settings:read');
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, principal.organizationId));
    if (!rows[0]) throw new NotFoundException('unknown organization');
    return { ...rows[0], role: principal.role };
  }

  async setQuotas(principal: Principal, quotas: OrgQuotas) {
    assertCan(principal.role, 'org:admin');
    await setQuotas(this.db, principal.organizationId, quotas);
    await recordAudit(this.db, {
      principal,
      action: 'org.quotas_updated',
      subjectType: 'organization',
      subjectId: principal.organizationId,
      data: quotas as Record<string, unknown>,
    });
    return getQuotas(this.db, principal.organizationId);
  }

  async listAudit(principal: Principal, input: { days?: number; format?: string }) {
    assertCan(principal.role, 'org:admin');
    const since = input.days ? new Date(Date.now() - input.days * 86_400_000) : undefined;
    const rows = await listAudit(this.db, {
      organizationId: principal.organizationId,
      ...(since ? { since } : {}),
    });
    return input.format === 'csv' ? auditToCsv(rows) : rows;
  }

  // ── helpers ─────────────────────────────────────────────────────────

  /** Every run lookup goes through here, so cross-tenant access is impossible by construction. */
  private async requireRun(principal: Principal, runId: string) {
    assertCan(principal.role, 'run:read');
    const rows = await this.db
      .select()
      .from(pipelineRuns)
      .where(
        and(eq(pipelineRuns.id, runId), eq(pipelineRuns.organizationId, principal.organizationId)),
      );
    if (!rows[0]) throw new NotFoundException(`unknown run ${runId}`);
    return rows[0];
  }

  private async requireGate(principal: Principal, gateRequestId: string) {
    const rows = await this.db
      .select({
        id: gateRequests.id,
        runId: gateRequests.runId,
        gate: gateRequests.gate,
        status: gateRequests.status,
      })
      .from(gateRequests)
      .innerJoin(pipelineRuns, eq(gateRequests.runId, pipelineRuns.id))
      .where(
        and(
          eq(gateRequests.id, gateRequestId),
          eq(pipelineRuns.organizationId, principal.organizationId),
        ),
      );
    if (!rows[0]) throw new NotFoundException('unknown gate request');
    return rows[0];
  }

  private async pickProject(principal: Principal, projectId?: string) {
    if (projectId) {
      const rows = await this.db
        .select()
        .from(projects)
        .where(
          and(eq(projects.id, projectId), eq(projects.organizationId, principal.organizationId)),
        );
      if (!rows[0]) throw new NotFoundException(`unknown project ${projectId}`);
      return rows[0];
    }
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.organizationId, principal.organizationId))
      .limit(2);
    if (rows.length === 0) throw new NotFoundException('no projects — seed first');
    if (rows.length > 1) throw new NotFoundException('multiple projects — pass projectId');
    return rows[0]!;
  }
}
