import type { DiffHunk, DiffLine } from './unified-diff';

export type DiffLineGroup =
  { kind: 'visible'; lines: DiffLine[] } | { kind: 'collapsed'; lines: DiffLine[] };

export const DIFF_FILE_LINE_LIMIT = 400;

export interface LimitedHunks {
  visible: DiffHunk[];
  remaining: DiffHunk[];
  remainingLineCount: number;
}

/** Bound the initial render while retaining the complete patch for an explicit reveal. */
export function limitHunkLines(
  hunks: readonly DiffHunk[],
  limit = DIFF_FILE_LINE_LIMIT,
): LimitedHunks {
  const safeLimit = Math.max(0, Math.floor(limit));
  const visible: DiffHunk[] = [];
  const remaining: DiffHunk[] = [];
  let available = safeLimit;

  for (const hunk of hunks) {
    const visibleLines = hunk.lines.slice(0, available);
    const remainingLines = hunk.lines.slice(visibleLines.length);
    if (visibleLines.length > 0) visible.push({ ...hunk, lines: visibleLines });
    if (remainingLines.length > 0) remaining.push({ ...hunk, lines: remainingLines });
    available -= visibleLines.length;
  }

  return {
    visible,
    remaining,
    remainingLineCount: remaining.reduce((sum, hunk) => sum + hunk.lines.length, 0),
  };
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
