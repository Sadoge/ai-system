import type { DiffFile, ParsedDiff } from '@/lib/diff';

export const DEFAULT_OPEN_FILE_LIMIT = 3;
export const LARGE_FILE_LINE_LIMIT = 400;

type DiffFileView = DiffFile & {
  additions: number;
  binary: boolean;
  deletions: number;
  displayPath?: string | null;
  id: string;
  newPath?: string | null;
  oldPath?: string | null;
  path?: string | null;
  status: string;
};

type ParsedDiffView = ParsedDiff & {
  additions?: number;
  deletions?: number;
  files: DiffFile[];
  totalAdditions?: number;
  totalDeletions?: number;
};

export function initialExpandedFiles(files: DiffFile[]): Set<string> {
  return files.length <= DEFAULT_OPEN_FILE_LIMIT ? expandAll(files) : collapseAll();
}

export function toggleFile(expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}

export function expandAll(files: DiffFile[]): Set<string> {
  return new Set(files.map((file) => (file as DiffFileView).id));
}

export function collapseAll(): Set<string> {
  return new Set<string>();
}

export function fileStatusLabel(file: DiffFile): string {
  const { binary, status } = file as DiffFileView;
  const normalizedStatus = status.toLowerCase();
  const label =
    normalizedStatus === 'added' || normalizedStatus === 'add'
      ? 'Added'
      : normalizedStatus === 'deleted' || normalizedStatus === 'delete'
        ? 'Deleted'
        : normalizedStatus === 'renamed' || normalizedStatus === 'rename'
          ? 'Renamed'
          : 'Modified';

  if (!binary) return label;
  if (label === 'Modified') return 'Binary';
  return `${label} (binary)`;
}

export function fileAccessibleLabel(file: DiffFile): string {
  const view = file as DiffFileView;
  const path = view.path ?? view.displayPath ?? view.newPath ?? view.oldPath ?? '';
  const parts = [path, fileStatusLabel(file)];

  if (fileStatusLabel(file).startsWith('Renamed') && view.oldPath) {
    parts.push(`renamed from ${view.oldPath}`);
  }

  if (view.binary) {
    parts.push('binary file, no line changes');
  } else {
    parts.push(pluralized(view.additions, 'addition'), pluralized(view.deletions, 'deletion'));
  }

  return parts.join(', ');
}

export function summaryAccessibleLabel(parsed: ParsedDiff): string {
  const view = parsed as ParsedDiffView;
  if (view.files.length === 0) return 'No files changed';

  const additions =
    view.additions ?? view.totalAdditions ?? sumFileChanges(view.files, 'additions');
  const deletions =
    view.deletions ?? view.totalDeletions ?? sumFileChanges(view.files, 'deletions');

  return [
    pluralized(view.files.length, 'file changed', 'files changed'),
    pluralized(additions, 'addition'),
    pluralized(deletions, 'deletion'),
  ].join(', ');
}

export function truncatePath(path: string, max = 72): { head: string; tail: string } {
  const finalSlash = path.lastIndexOf('/');
  const basename = path.slice(finalSlash + 1);
  const directory = path.slice(0, finalSlash + 1);

  if (path.length <= max || finalSlash === -1) return { head: directory, tail: basename };

  const segments = directory.slice(0, -1).split('/');
  const elision = '…/';
  let head = elision;

  while (segments.length > 0) {
    const candidate = `${elision}${segments.at(-1)}/${head.slice(elision.length)}`;
    if (candidate.length + basename.length > max) break;
    head = candidate;
    segments.pop();
  }

  return { head, tail: basename };
}

export function changeBarSegments(
  additions: number,
  deletions: number,
  slots = 5,
): { added: number; deleted: number; neutral: number } {
  const slotCount = Math.max(0, Math.floor(slots));
  const addedChanges = Math.max(0, additions);
  const deletedChanges = Math.max(0, deletions);
  const nonZeroSides = Number(addedChanges > 0) + Number(deletedChanges > 0);

  if (slotCount < nonZeroSides) {
    throw new RangeError(`At least ${nonZeroSides} slots are required for the non-zero changes`);
  }

  const total = addedChanges + deletedChanges;
  if (total === 0) return { added: 0, deleted: 0, neutral: slotCount };
  if (deletedChanges === 0) return { added: slotCount, deleted: 0, neutral: 0 };
  if (addedChanges === 0) return { added: 0, deleted: slotCount, neutral: 0 };

  const added = Math.min(
    slotCount - 1,
    Math.max(1, Math.round((addedChanges / total) * slotCount)),
  );
  return { added, deleted: slotCount - added, neutral: 0 };
}

export function sliceFileLines<Line>(
  hunk: { lines: readonly Line[] },
  shown: number,
): { lines: Line[]; remaining: number } {
  const shownCount = Math.max(0, Math.floor(shown));
  const lines = hunk.lines.slice(0, shownCount);

  return {
    lines,
    remaining: hunk.lines.length - lines.length,
  };
}

function pluralized(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sumFileChanges(files: DiffFile[], key: 'additions' | 'deletions'): number {
  return files.reduce((total, file) => total + (file as DiffFileView)[key], 0);
}
