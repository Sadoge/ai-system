import { describe, expect, it } from 'vitest';
import { groupHunkLines, limitHunkLines } from './diff-view-model';
import type { DiffHunk, DiffLine } from './unified-diff';

const context = (line: number): DiffLine => ({
  kind: 'context',
  content: `line ${line}`,
  oldLine: line,
  newLine: line,
});

describe('groupHunkLines', () => {
  it('keeps short context runs visible', () => {
    const hunk = { lines: Array.from({ length: 7 }, (_, index) => context(index + 1)) } as DiffHunk;
    expect(groupHunkLines(hunk)).toEqual([{ kind: 'visible', lines: hunk.lines }]);
  });

  it('collapses the middle of long unchanged runs', () => {
    const hunk = {
      lines: Array.from({ length: 12 }, (_, index) => context(index + 1)),
    } as DiffHunk;
    const groups = groupHunkLines(hunk);
    expect(groups.map((group) => [group.kind, group.lines.length])).toEqual([
      ['visible', 3],
      ['collapsed', 6],
      ['visible', 3],
    ]);
    expect(groups.flatMap((group) => group.lines)).toEqual(hunk.lines);
  });
});

describe('limitHunkLines', () => {
  it('caps lines across hunks and reports the exact remainder', () => {
    const first = {
      header: '@@ -1,3 +1,3 @@',
      lines: Array.from({ length: 3 }, (_, index) => context(index + 1)),
    } as DiffHunk;
    const second = {
      header: '@@ -10,4 +10,4 @@',
      lines: Array.from({ length: 4 }, (_, index) => context(index + 10)),
    } as DiffHunk;

    const result = limitHunkLines([first, second], 5);

    expect(result.visible.map((hunk) => hunk.lines.length)).toEqual([3, 2]);
    expect(result.remaining.map((hunk) => hunk.lines.length)).toEqual([2]);
    expect(result.remainingLineCount).toBe(2);
    expect([...result.visible, ...result.remaining]).not.toContain(first);
    expect(first.lines).toHaveLength(3);
    expect(second.lines).toHaveLength(4);
  });
});
