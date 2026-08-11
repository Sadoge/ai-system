import { describe, expect, it } from 'vitest';
import { groupHunkLines, sliceFileHunks } from './diff-view-model';
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

  it('caps lines across hunks and reports the remainder', () => {
    const hunks = [
      {
        header: '@@ first @@',
        lines: Array.from({ length: 3 }, (_, index) => context(index + 1)),
      },
      {
        header: '@@ second @@',
        lines: Array.from({ length: 4 }, (_, index) => context(index + 4)),
      },
    ] as DiffHunk[];

    expect(sliceFileHunks(hunks, 5)).toMatchObject({
      remaining: 2,
      hunks: [{ lines: hunks[0]!.lines }, { lines: hunks[1]!.lines.slice(0, 2) }],
    });
  });
});
