import type { DiffHunk, DiffLine } from './unified-diff';

export const LARGE_FILE_LINE_LIMIT = 400;

export type DiffLineGroup =
  { kind: 'visible'; lines: DiffLine[] } | { kind: 'collapsed'; lines: DiffLine[] };

export function capHunkLines(
  hunks: readonly DiffHunk[],
  limit = LARGE_FILE_LINE_LIMIT,
): { hunks: DiffHunk[]; remaining: number } {
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

/** Collapse only long, unchanged runs. Changed lines and their nearby context
 * remain visible, while the complete source stays available on demand. */
export function groupHunkLines(hunk: DiffHunk, contextLines = 3): DiffLineGroup[] {
  const groups: DiffLineGroup[] = [];
  let cursor = 0;

  while (cursor < hunk.lines.length) {
    if (hunk.lines[cursor]!.kind !== 'context') {
      const start = cursor;
      while (cursor < hunk.lines.length && hunk.lines[cursor]!.kind !== 'context') cursor++;
      groups.push({ kind: 'visible', lines: hunk.lines.slice(start, cursor) });
      continue;
    }

    const start = cursor;
    while (cursor < hunk.lines.length && hunk.lines[cursor]!.kind === 'context') cursor++;
    const run = hunk.lines.slice(start, cursor);
    if (run.length <= contextLines * 2 + 1) {
      groups.push({ kind: 'visible', lines: run });
    } else {
      groups.push({ kind: 'visible', lines: run.slice(0, contextLines) });
      groups.push({ kind: 'collapsed', lines: run.slice(contextLines, -contextLines) });
      groups.push({ kind: 'visible', lines: run.slice(-contextLines) });
    }
  }

  return mergeVisibleGroups(groups);
}

function mergeVisibleGroups(groups: DiffLineGroup[]): DiffLineGroup[] {
  const merged: DiffLineGroup[] = [];
  for (const group of groups) {
    const previous = merged.at(-1);
    if (group.kind === 'visible' && previous?.kind === 'visible') {
      previous.lines.push(...group.lines);
    } else {
      merged.push({ ...group, lines: [...group.lines] });
    }
  }
  return merged;
}

/** Return a stable prefix of a file's hunks without mutating the parser output. */
export function sliceFileHunks(
  hunks: readonly DiffHunk[],
  limit: number,
): { hunks: DiffHunk[]; remaining: number } {
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
