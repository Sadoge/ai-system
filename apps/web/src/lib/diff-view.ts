import type { DiffFile, DiffFileStatus, DiffHunk } from './diff';

export const DEFAULT_OPEN_FILE_LIMIT = 3;
export const LARGE_FILE_LINE_LIMIT = 400;

export type ChangeBarSegment = 'addition' | 'deletion' | 'neutral';

export interface VisibleHunks {
  hunks: DiffHunk[];
  remaining: number;
}

export function initialExpandedFiles(files: readonly DiffFile[]): Set<string> {
  return files.length <= DEFAULT_OPEN_FILE_LIMIT ? expandAll(files) : collapseAll();
}

export function toggleFile(expanded: ReadonlySet<string>, fileId: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(fileId)) next.delete(fileId);
  else next.add(fileId);
  return next;
}

export function expandAll(files: readonly DiffFile[]): Set<string> {
  return new Set(files.map((file) => file.id));
}

export function collapseAll(): Set<string> {
  return new Set();
}

const STATUS_LABELS: Record<DiffFileStatus, string> = {
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  modified: 'Modified',
};

export function fileStatusLabel(file: Pick<DiffFile, 'status' | 'binary'>): string {
  return `${STATUS_LABELS[file.status]}${file.binary ? ' binary' : ''}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function changeCountLabel(additions: number, deletions: number): string {
  return `${countLabel(additions, 'addition')} and ${countLabel(deletions, 'deletion')}`;
}

export function fileAccessibleLabel(
  file: Pick<
    DiffFile,
    'path' | 'oldPath' | 'newPath' | 'status' | 'binary' | 'additions' | 'deletions'
  >,
): string {
  const subject =
    file.status === 'renamed'
      ? `${file.oldPath ?? file.path} to ${file.newPath ?? file.path}`
      : file.path;
  const action = fileStatusLabel(file);
  if (file.binary) return `${action} file ${subject}`;
  return `${action} file ${subject}, ${changeCountLabel(file.additions, file.deletions)}`;
}

export function summaryAccessibleLabel(
  summary: Pick<
    { fileCount: number; additions: number; deletions: number },
    'fileCount' | 'additions' | 'deletions'
  >,
): string {
  if (summary.fileCount === 0) return 'No code changes';
  return `${countLabel(summary.fileCount, 'file')} changed, ${changeCountLabel(summary.additions, summary.deletions)}`;
}

export function truncatePath(path: string, maxLength = 56): string {
  if (path.length <= maxLength) return path;
  if (maxLength <= 1) return '…'.slice(0, maxLength);

  const slash = path.lastIndexOf('/');
  const basename = slash >= 0 ? path.slice(slash + 1) : path;
  if (basename.length + 2 >= maxLength) return `…/${basename}`;
  const availablePrefix = maxLength - basename.length - 2;
  return `${path.slice(0, availablePrefix)}…/${basename}`;
}

/** Splits a path for renderers that style its directory and basename separately. */
export function truncatePathParts(path: string, maxLength = 72): { head: string; tail: string } {
  const truncated = truncatePath(path, maxLength);
  const finalSlash = truncated.lastIndexOf('/');
  return {
    head: finalSlash < 0 ? '' : truncated.slice(0, finalSlash + 1),
    tail: truncated.slice(finalSlash + 1),
  };
}

export function changeBarSegments(
  additions: number,
  deletions: number,
  slots = 5,
): ChangeBarSegment[] {
  const safeSlots = Math.max(0, Math.floor(slots));
  const safeAdditions = Math.max(0, additions);
  const safeDeletions = Math.max(0, deletions);
  const total = safeAdditions + safeDeletions;
  if (safeSlots === 0) return [];
  if (total === 0) return Array<ChangeBarSegment>(safeSlots).fill('neutral');

  let additionSlots: number;
  let deletionSlots: number;
  if (total <= safeSlots) {
    additionSlots = safeAdditions;
    deletionSlots = safeDeletions;
  } else if (safeAdditions === 0) {
    additionSlots = 0;
    deletionSlots = safeSlots;
  } else if (safeDeletions === 0) {
    additionSlots = safeSlots;
    deletionSlots = 0;
  } else {
    additionSlots = Math.round((safeAdditions / total) * safeSlots);
    additionSlots = Math.max(1, Math.min(safeSlots - 1, additionSlots));
    deletionSlots = safeSlots - additionSlots;
  }

  const neutralSlots = Math.max(0, safeSlots - additionSlots - deletionSlots);
  return [
    ...Array<ChangeBarSegment>(additionSlots).fill('addition'),
    ...Array<ChangeBarSegment>(deletionSlots).fill('deletion'),
    ...Array<ChangeBarSegment>(neutralSlots).fill('neutral'),
  ];
}

export function sliceFileLines(hunks: readonly DiffHunk[], limit: number): VisibleHunks;
export function sliceFileLines<Line>(
  hunk: { lines: readonly Line[] },
  limit: number,
): { lines: Line[]; remaining: number };
export function sliceFileLines<Line>(
  input: readonly DiffHunk[] | { lines: readonly Line[] },
  limit: number,
): VisibleHunks | { lines: Line[]; remaining: number } {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (!isHunkList(input)) {
    const lines = input.lines.slice(0, safeLimit);
    return { lines, remaining: input.lines.length - lines.length };
  }

  const total = input.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  let available = safeLimit;
  const hunks: DiffHunk[] = [];
  for (const hunk of input) {
    if (available <= 0) break;
    const lines = hunk.lines.slice(0, available);
    if (lines.length > 0) hunks.push({ ...hunk, lines });
    available -= lines.length;
  }
  return { hunks, remaining: Math.max(0, total - safeLimit) };
}

function isHunkList<Line>(
  input: readonly DiffHunk[] | { lines: readonly Line[] },
): input is readonly DiffHunk[] {
  return Array.isArray(input);
}

export function visibleHunks(file: Pick<DiffFile, 'hunks'>, limit: number): VisibleHunks {
  return sliceFileLines(file.hunks, limit);
}
