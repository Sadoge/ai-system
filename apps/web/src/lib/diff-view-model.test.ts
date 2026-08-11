import { describe, expect, it } from 'vitest';
import { capHunks, groupHunkLines } from './diff-view-model';
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

describe('capHunks', () => {
  it('caps across hunk boundaries without mutating the parsed diff', () => {
    const first = { header: '@@ first', lines: [context(1), context(2)] } as DiffHunk;
    const second = {
      header: '@@ second',
      lines: [context(10), context(11), context(12)],
    } as DiffHunk;

    const capped = capHunks([first, second], 4);

    expect(capped.remaining).toBe(1);
    expect(capped.hunks.map((hunk) => hunk.lines.length)).toEqual([2, 2]);
    expect(capped.hunks[1]!.lines[0]!.content).toBe('line 10');
    expect(second.lines).toHaveLength(3);
  });
});
