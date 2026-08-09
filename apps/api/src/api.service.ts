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
  type Db,
} from '@ai-system/db';
import {
  TicketSnapshot,
  defaultMvpPolicy,
  defaultTrivialPolicy,
  uuidv7,
  type GateDecisionKind,
  type KnowledgeKind,
} from '@ai-system/domain';
import { resolveGate, startRun } from '@ai-system/orchestration';
import { addManualKnowledge } from '@ai-system/brain';
import { fetchJiraTicket, jiraConfigFromEnv } from '@ai-system/integrations';
import { DB } from './db.provider.js';

@Injectable()
export class ApiService {
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
    pipeline: 'trivial' | 'mvp';
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
    if (input.pipeline === 'mvp' && !repositoryId) {
      const repos = await this.db
        .select()
        .from(repositories)
        .where(eq(repositories.projectId, project.id))
        .limit(2);
      if (repos.length !== 1) throw new NotFoundException('pass repositoryId (0 or >1 repos registered)');
      repositoryId = repos[0]!.id;
    }
    const policy =
      input.pipeline === 'mvp' ? defaultMvpPolicy(input.automation) : defaultTrivialPolicy();
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
    const [stages, arts, findings, gates, cost] = await Promise.all([
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
    ]);
    return { ...run, stages, artifacts: arts, findings, gates, costUsd: cost };
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

  // ── knowledge ───────────────────────────────────────────────────────

  async listKnowledge() {
    return this.db.select().from(knowledgeItems).orderBy(desc(knowledgeItems.createdAt)).limit(200);
  }

  async addKnowledge(input: {
    kind: KnowledgeKind;
    title: string;
    content: string;
    projectId?: string | undefined;
  }) {
    const project = await this.pickProject(input.projectId);
    return addManualKnowledge(this.db, {
      organizationId: project.organizationId,
      projectId: project.id,
      kind: input.kind,
      title: input.title,
      content: input.content,
    });
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
