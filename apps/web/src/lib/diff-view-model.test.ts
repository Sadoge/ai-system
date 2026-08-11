import { describe, expect, it } from 'vitest';
import { groupHunkLines, splitDiffHunks } from './diff-view-model';
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

describe('splitDiffHunks', () => {
  it('caps lines across hunks and reports the complete remainder', () => {
    const hunks = [
      { header: '@@ first @@', lines: [context(1), context(2), context(3)] },
      { header: '@@ second @@', lines: [context(10), context(11), context(12)] },
    ] as DiffHunk[];

    const split = splitDiffHunks(hunks, 4);

    expect(split.visible.map((hunk) => hunk.lines.length)).toEqual([3, 1]);
    expect(split.remaining.map((hunk) => hunk.lines.length)).toEqual([2]);
    expect(split.remainingLineCount).toBe(2);
    expect(hunks.map((hunk) => hunk.lines.length)).toEqual([3, 3]);
  });
});
