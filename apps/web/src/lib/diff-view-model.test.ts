import { describe, expect, it } from 'vitest';
import { groupHunkLines, visibleHunks } from './diff-view-model';
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

describe('visibleHunks', () => {
  it('caps lines across hunks and reports the remaining count', () => {
    const first = {
      header: '@@ -1,3 +1,3 @@',
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 3,
      lines: [context(1), context(2), context(3)],
    };
    const second = {
      ...first,
      header: '@@ -10,3 +10,3 @@',
      lines: [context(10), context(11), context(12)],
    };

    const result = visibleHunks({ hunks: [first, second] }, 4);
    expect(result.hunks.map((hunk) => hunk.lines.length)).toEqual([3, 1]);
    expect(result.remaining).toBe(2);
  });
});
