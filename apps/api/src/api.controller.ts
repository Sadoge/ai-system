import { Body, Controller, Get, Param, Post, Query, Sse, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiService } from './api.service.js';
import {
  AddKnowledgeBody,
  AddModelProfileBody,
  JiraWebhookBody,
  RegisterRepoBody,
  ResolveGateBody,
  StartRunBody,
  parse,
} from './dto.js';

@Controller()
export class ApiController {
  constructor(private readonly service: ApiService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('projects')
  listProjects() {
    return this.service.listProjects();
  }

  @Post('repositories')
  registerRepository(@Body() body: unknown) {
    return this.service.registerRepository(parse(RegisterRepoBody, body));
  }

  @Get('runs')
  listRuns(@Query('limit') limit?: string) {
    return this.service.listRuns(limit ? Number(limit) : undefined);
  }

  @Post('runs')
  startRun(@Body() body: unknown) {
    return this.service.startRun(parse(StartRunBody, body));
  }

  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Get('runs/:id/artifacts/:artifactId')
  getArtifact(@Param('id') id: string, @Param('artifactId') artifactId: string) {
    return this.service.getArtifact(id, artifactId);
  }

  @Get('runs/:id/events')
  listEvents(@Param('id') id: string, @Query('after') after?: string) {
    return this.service.listEvents(id, after);
  }

  /**
   * Live run feed (docs/09: SSE for one-way streams). Emits batches of new
   * domain events; UUIDv7 event ids are the resume cursor.
   */
  @Sse('runs/:id/stream')
  streamEvents(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cursor: string | undefined;
      let stopped = false;
      const poll = async () => {
        try {
          const events = await this.service.listEvents(id, cursor);
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

  @Get('gates')
  listGates(@Query('status') status?: string) {
    return this.service.listGates(status);
  }

  @Post('gates/:id/resolve')
  resolveGate(@Param('id') id: string, @Body() body: unknown) {
    const parsed = parse(ResolveGateBody, body);
    return this.service.resolveGate(id, parsed.decision, parsed.comment);
  }

  @Get('knowledge')
  listKnowledge() {
    return this.service.listKnowledge();
  }

  @Post('knowledge')
  addKnowledge(@Body() body: unknown) {
    return this.service.addKnowledge(parse(AddKnowledgeBody, body));
  }

  @Get('model-profiles')
  listModelProfiles() {
    return this.service.listModelProfiles();
  }

  @Post('model-profiles')
  addModelProfile(@Body() body: unknown) {
    return this.service.addModelProfile(parse(AddModelProfileBody, body));
  }

  /** Jira automation trigger: an issue webhook starts an MVP run. */
  @Post('webhooks/jira')
  async jiraWebhook(@Body() body: unknown) {
    const parsed = parse(JiraWebhookBody, body);
    const { runId } = await this.service.startRun({
      jiraKey: parsed.issue.key,
      pipeline: 'mvp',
      automation: 'plan_gated',
    });
    return { runId };
  }
}
