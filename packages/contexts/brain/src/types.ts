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
}
