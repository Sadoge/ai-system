import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { GateDecisionKind, KnowledgeKind, TicketSnapshot } from '@ai-system/domain';

// Zod is the request contract (docs/09 §2); every body is parsed before use.
export function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({ message: 'validation failed', issues: result.error.issues });
  }
  return result.data;
}

export const StartRunBody = z
  .object({
    ticket: TicketSnapshot.optional(),
    jiraKey: z.string().optional(),
    pipeline: z.enum(['trivial', 'mvp', 'team']).default('mvp'),
    automation: z.enum(['plan_gated', 'autonomous']).default('plan_gated'),
    projectId: z.string().uuid().optional(),
    repositoryId: z.string().uuid().optional(),
  })
  .refine((b) => b.ticket !== undefined || b.jiraKey !== undefined, {
    message: 'either ticket or jiraKey is required',
  });

export const ResolveGateBody = z.object({
  decision: GateDecisionKind,
  comment: z.string().optional(),
});

export const AddKnowledgeBody = z.object({
  kind: KnowledgeKind,
  title: z.string().min(1),
  content: z.string().min(1),
  projectId: z.string().uuid().optional(),
});

export const RegisterRepoBody = z.object({
  remoteUrl: z.string().min(1),
  name: z.string().optional(),
  defaultBranch: z.string().default('main'),
  testCommand: z.string().optional(),
  projectId: z.string().uuid().optional(),
});

export const AddModelProfileBody = z.object({
  purpose: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  fallbacks: z.array(z.object({ provider: z.string(), model: z.string() })).default([]),
  projectId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

export const JiraWebhookBody = z.object({
  issue: z.object({ key: z.string() }).passthrough(),
});
