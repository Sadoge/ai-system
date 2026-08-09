import { z } from 'zod';

export const FileRole = z.enum(['source', 'test', 'config', 'docs', 'generated', 'other']);
export type FileRole = z.infer<typeof FileRole>;

export const FileEntry = z.object({
  path: z.string(),
  role: FileRole,
  bytes: z.number().int().nonnegative(),
});
export type FileEntry = z.infer<typeof FileEntry>;

/**
 * Layer 1 structural index (docs/08 §1). Phase 1 extracts TS/JS symbols and
 * import edges with lightweight parsing; the tree-sitter indexer replaces the
 * extraction internals without changing this shape.
 */
export const RepoIndex = z.object({
  commitSha: z.string(),
  files: z.array(FileEntry),
  /** path → exported symbol names */
  symbols: z.record(z.array(z.string())),
  /** path → imported module specifiers */
  imports: z.record(z.array(z.string())),
});
export type RepoIndex = z.infer<typeof RepoIndex>;

export interface BrainNeed {
  structural?: { files?: string[]; keywords?: string[] };
  rules?: { scopeTags?: string[] };
  /** Ranked retrieval over curated knowledge (patterns, pitfalls, ADRs). */
  semantic?: { query: string; topK?: number };
  /** "Have we done something like this before?" — past runs and findings. */
  episodic?: { query: string; topK?: number };
}

export interface BrainHit {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  score: number;
}

export interface BrainRule {
  id: string;
  kind: string;
  title: string;
  content: string;
}

export interface BrainContext {
  fileMap: string;
  relevantFiles: { path: string; exports: string[] }[];
  rules: BrainRule[];
  /** Semantically retrieved knowledge (patterns, pitfalls, ADRs). */
  related: BrainHit[];
  /** Episodic memory: similar past runs and their review findings. */
  episodes: BrainHit[];
  /** What was dropped to fit the token budget, for the brain inspector. */
  trimmed: { section: string; dropped: number }[];
}
