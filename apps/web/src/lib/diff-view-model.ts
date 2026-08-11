import type { DiffHunk, DiffLine } from './unified-diff';

export const LARGE_FILE_LINE_LIMIT = 400;

export type DiffLineGroup =
  { kind: 'visible'; lines: DiffLine[] } | { kind: 'collapsed'; lines: DiffLine[] };

export interface CappedHunks {
  hunks: DiffHunk[];
  remaining: number;
}

/** Return a non-mutating prefix of a file's hunks for bounded initial render. */
export function capHunks(hunks: readonly DiffHunk[], limit = LARGE_FILE_LINE_LIMIT): CappedHunks {
  return visibleHunks({ hunks }, limit);
}

export function visibleHunks(
  file: { hunks: readonly DiffHunk[] },
  limit = LARGE_FILE_LINE_LIMIT,
): CappedHunks {
  const safeLimit = Math.max(0, Math.floor(limit));
  const total = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  let available = safeLimit;
  const hunks: DiffHunk[] = [];

  for (const hunk of file.hunks) {
    if (available <= 0) break;
    const lines = hunk.lines.slice(0, available);
    if (lines.length > 0) hunks.push({ ...hunk, lines });
    available -= lines.length;
  }

  return { hunks, remaining: Math.max(0, total - safeLimit) };
}

/** Compatibility form used by the viewer when it already has the hunk list. */
export function sliceFileHunks(
  hunks: readonly DiffHunk[],
  limit = LARGE_FILE_LINE_LIMIT,
): CappedHunks {
  return capHunks(hunks, limit);
}

export interface SplitDiffHunks {
  visible: DiffHunk[];
  remaining: DiffHunk[];
  remainingLineCount: number;
}

/** Split a file at a line budget without mutating the parsed patch. A hunk
 * crossing the boundary is repeated so the revealed tail keeps its context. */
export function splitDiffHunks(hunks: readonly DiffHunk[], limit: number): SplitDiffHunks {
  const visible: DiffHunk[] = [];
  const remaining: DiffHunk[] = [];
  let budget = Math.max(0, Math.floor(limit));

  for (const hunk of hunks) {
    const visibleLines = hunk.lines.slice(0, budget);
    const remainingLines = hunk.lines.slice(visibleLines.length);
    if (visibleLines.length > 0) visible.push({ ...hunk, lines: visibleLines });
    if (remainingLines.length > 0) remaining.push({ ...hunk, lines: remainingLines });
    budget -= visibleLines.length;
  }

  return {
    visible,
    remaining,
    remainingLineCount: remaining.reduce((total, hunk) => total + hunk.lines.length, 0),
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
