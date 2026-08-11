import type { DiffFile, DiffFileStatus, DiffHunk } from './diff';

export type ChangeBarSegment = 'addition' | 'deletion' | 'neutral';

export interface VisibleHunks {
  hunks: DiffHunk[];
  remaining: number;
}

export function initialExpandedFiles(files: readonly DiffFile[]): Set<string> {
  return files.length <= 3 ? new Set(files.map((file) => file.id)) : new Set();
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
  if (basename.length + 2 >= maxLength) {
    return `…/${basename}`;
  }
  const availablePrefix = maxLength - basename.length - 2;
  return `${path.slice(0, availablePrefix)}…/${basename}`;
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

export function sliceFileLines(hunks: readonly DiffHunk[], limit: number): VisibleHunks {
  const safeLimit = Math.max(0, Math.floor(limit));
  const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  let available = safeLimit;
  const visible: DiffHunk[] = [];

  for (const hunk of hunks) {
    if (available <= 0) break;
    const lines = hunk.lines.slice(0, available);
    if (lines.length > 0) visible.push({ ...hunk, lines });
    available -= lines.length;
  }

  return { hunks: visible, remaining: Math.max(0, total - safeLimit) };
}

export function visibleHunks(file: Pick<DiffFile, 'hunks'>, limit: number): VisibleHunks {
  return sliceFileLines(file.hunks, limit);
}
