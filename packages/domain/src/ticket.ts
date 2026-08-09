import { z } from 'zod';

// The normalized ticket shape every intake source (Jira, manual paste, file)
// must produce before a run starts. Source-specific fields stay in `raw`.
export const TicketSnapshot = z.object({
  source: z.enum(['jira', 'linear', 'azure_devops', 'manual', 'file']),
  externalKey: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(''),
  acceptanceCriteria: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  raw: z.record(z.unknown()).optional(),
});
export type TicketSnapshot = z.infer<typeof TicketSnapshot>;
