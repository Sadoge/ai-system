import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import {
  GateDecisionKind,
  KnowledgeKind,
  ReviewSpecialty,
  TicketSnapshot,
} from '@ai-system/domain';

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

export const DecideKnowledgeBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  editedTitle: z.string().min(1).optional(),
  editedContent: z.string().min(1).optional(),
});

export const RegisterRepoBody = z.object({
  remoteUrl: z.string().min(1),
  name: z.string().optional(),
  defaultBranch: z.string().default('main'),
  testCommand: z.string().optional(),
  /** Which coding agent runs this repository's tasks. */
  executor: z.enum(['claude_code', 'codex', 'api_loop', 'scripted']).optional(),
  executorModel: z.string().optional(),
  executorEffort: z.enum(['low', 'medium', 'high']).optional(),
  reviewers: z.array(ReviewSpecialty).optional(),
  projectId: z.string().uuid().optional(),
});

export const AddModelProfileBody = z.object({
  purpose: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  params: z
    .object({
      reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
      maxTokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .passthrough()
    .default({}),
  fallbacks: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
        params: z
          .object({ reasoningEffort: z.enum(['low', 'medium', 'high']).optional() })
          .optional(),
      }),
    )
    .default([]),
  projectId: z.string().uuid().optional(),
});

export const AssignGateBody = z.object({
  userId: z.string().uuid().nullable().optional(),
});

export const CreateApiKeyBody = z.object({
  name: z.string().min(1),
  role: z.enum(['viewer', 'member', 'admin', 'owner']).default('member'),
});

export const QuotasBody = z.object({
  maxConcurrentRuns: z.number().int().positive().optional(),
  monthlyBudgetUsd: z.number().positive().optional(),
  requestsPerMinute: z.number().int().positive().optional(),
});

export const CatalogEntryBody = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  inputPerMTokUsd: z.number().nonnegative(),
  outputPerMTokUsd: z.number().nonnegative(),
  capabilities: z.record(z.unknown()).optional(),
});

export const JiraWebhookBody = z.object({
  issue: z.object({ key: z.string() }).passthrough(),
});

export const CreateWebhookBody = z.object({
  url: z.string().url(),
  description: z.string().optional(),
  /** Event names, or prefixes ending in `.*`. Empty means every event. */
  events: z.array(z.string()).optional(),
});

export const WebhookActiveBody = z.object({ active: z.boolean() });
