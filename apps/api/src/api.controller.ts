import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Principal, Role } from '@ai-system/tenancy';
import { ApiService } from './api.service.js';
import { AuthGuard } from './auth.js';
import { CurrentPrincipal } from './principal.decorator.js';
import {
  AddKnowledgeBody,
  AddModelProfileBody,
  AssignGateBody,
  CatalogEntryBody,
  CreateApiKeyBody,
  DecideKnowledgeBody,
  JiraWebhookBody,
  QuotasBody,
  RegisterRepoBody,
  ResolveGateBody,
  StartRunBody,
  parse,
} from './dto.js';

@Controller()
@UseGuards(AuthGuard)
export class ApiController {
  constructor(private readonly service: ApiService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  // ── organization ────────────────────────────────────────────────────

  @Get('organization')
  getOrganization(@CurrentPrincipal() principal: Principal) {
    return this.service.getOrganization(principal);
  }

  @Post('organization/quotas')
  setQuotas(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.setQuotas(principal, parse(QuotasBody, body));
  }

  @Get('api-keys')
  listApiKeys(@CurrentPrincipal() principal: Principal) {
    return this.service.listApiKeys(principal);
  }

  @Post('api-keys')
  createApiKey(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const parsed = parse(CreateApiKeyBody, body);
    return this.service.createApiKey(principal, { name: parsed.name, role: parsed.role as Role });
  }

  @Post('api-keys/:id/revoke')
  revokeApiKey(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.revokeApiKey(principal, id);
  }

  @Get('audit')
  listAudit(
    @CurrentPrincipal() principal: Principal,
    @Query('days') days?: string,
    @Query('format') format?: string,
  ) {
    return this.service.listAudit(principal, {
      ...(days ? { days: Number(days) } : {}),
      ...(format ? { format } : {}),
    });
  }

  // ── projects & repositories ─────────────────────────────────────────

  @Get('projects')
  listProjects(@CurrentPrincipal() principal: Principal) {
    return this.service.listProjects(principal);
  }

  @Post('repositories')
  registerRepository(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.registerRepository(principal, parse(RegisterRepoBody, body));
  }

  // ── runs ────────────────────────────────────────────────────────────

  @Get('runs')
  listRuns(@CurrentPrincipal() principal: Principal, @Query('limit') limit?: string) {
    return this.service.listRuns(principal, limit ? Number(limit) : undefined);
  }

  @Post('runs')
  startRun(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.startRun(principal, parse(StartRunBody, body));
  }

  @Get('runs/:id')
  getRun(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.getRun(principal, id);
  }

  @Get('runs/:id/artifacts/:artifactId')
  getArtifact(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getArtifact(principal, id, artifactId);
  }

  @Get('runs/:id/events')
  listEvents(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query('after') after?: string,
  ) {
    return this.service.listEvents(principal, id, after);
  }

  /**
   * Live run feed (docs/09: SSE for one-way streams). Emits batches of new
   * domain events; UUIDv7 event ids are the resume cursor.
   */
  @Sse('runs/:id/stream')
  streamEvents(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cursor: string | undefined;
      let stopped = false;
      const poll = async () => {
        try {
          const events = await this.service.listEvents(principal, id, cursor);
          if (events.length > 0) {
            cursor = events[events.length - 1]!.id;
            subscriber.next({ data: events });
          }
        } catch (err) {
          subscriber.error(err);
          return;
        }
        if (!stopped) timer = setTimeout(poll, 1500);
      };
      let timer = setTimeout(poll, 0);
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    });
  }

  @Post('runs/:id/eval')
  startEval(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.startEval(principal, id);
  }

  @Get('runs/:id/eval-compare')
  compareEval(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.compareEval(principal, id);
  }

  // ── gates ───────────────────────────────────────────────────────────

  @Get('gates')
  listGates(@CurrentPrincipal() principal: Principal, @Query('status') status?: string) {
    return this.service.listGates(principal, status);
  }

  @Post('gates/:id/assign')
  assignGate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = parse(AssignGateBody, body);
    return this.service.assignGate(principal, id, parsed.userId ?? null);
  }

  @Post('gates/:id/resolve')
  resolveGate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = parse(ResolveGateBody, body);
    return this.service.resolveGate(principal, id, parsed.decision, parsed.comment);
  }

  // ── review & knowledge ──────────────────────────────────────────────

  @Get('findings')
  listFindings(@CurrentPrincipal() principal: Principal, @Query('status') status?: string) {
    return this.service.listFindings(principal, status);
  }

  @Get('brain/inspect')
  inspectBrain(
    @CurrentPrincipal() principal: Principal,
    @Query('query') query: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.inspectBrain(principal, {
      query: query ?? '',
      ...(projectId ? { projectId } : {}),
    });
  }

  @Get('knowledge')
  listKnowledge(@CurrentPrincipal() principal: Principal, @Query('status') status?: string) {
    return this.service.listKnowledge(principal, status);
  }

  @Post('knowledge')
  addKnowledge(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.addKnowledge(principal, parse(AddKnowledgeBody, body));
  }

  @Post('knowledge/:id/decide')
  decideKnowledge(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = parse(DecideKnowledgeBody, body);
    return this.service.decideKnowledge(principal, {
      knowledgeItemId: id,
      decision: parsed.decision,
      editedTitle: parsed.editedTitle,
      editedContent: parsed.editedContent,
    });
  }

  @Post('knowledge/:id/promote')
  promoteKnowledge(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.service.promoteKnowledge(principal, id);
  }

  @Get('analytics/knowledge')
  knowledgeEffectiveness(@CurrentPrincipal() principal: Principal) {
    return this.service.knowledgeEffectiveness(principal);
  }

  // ── models ──────────────────────────────────────────────────────────

  @Get('model-profiles')
  listModelProfiles(@CurrentPrincipal() principal: Principal) {
    return this.service.listModelProfiles(principal);
  }

  @Post('model-profiles')
  addModelProfile(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.addModelProfile(principal, parse(AddModelProfileBody, body));
  }

  @Get('model-catalog')
  listCatalog(@CurrentPrincipal() principal: Principal) {
    return this.service.listCatalog(principal);
  }

  @Post('model-catalog')
  upsertCatalog(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.service.upsertCatalogEntry(principal, parse(CatalogEntryBody, body));
  }

  // ── analytics ───────────────────────────────────────────────────────

  @Get('analytics/cost')
  costSeries(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.service.costSeries(principal, days ? Number(days) : undefined);
  }

  @Get('analytics/cost-by-purpose')
  costByPurpose(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.service.costByPurpose(principal, days ? Number(days) : undefined);
  }

  @Get('analytics/runs')
  runAnalytics(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.service.runAnalytics(principal, days ? Number(days) : undefined);
  }

  // ── webhooks ────────────────────────────────────────────────────────

  /** Jira automation trigger: an issue webhook starts a run for its organization. */
  @Post('webhooks/jira')
  @Header('content-type', 'application/json')
  async jiraWebhook(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const parsed = parse(JiraWebhookBody, body);
    const { runId } = await this.service.startRun(principal, {
      jiraKey: parsed.issue.key,
      pipeline: 'mvp',
      automation: 'plan_gated',
    });
    return { runId };
  }
}
