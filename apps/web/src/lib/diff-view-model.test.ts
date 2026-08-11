import { describe, expect, it } from 'vitest';
import { capHunkLines, groupHunkLines } from './diff-view-model';
import type { DiffHunk, DiffLine } from './unified-diff';

const context = (line: number): DiffLine => ({
  kind: 'context',
  content: `line ${line}`,
  oldLine: line,
  newLine: line,
});

const line = (kind: DiffLine['kind'], content: string): DiffLine => ({
  kind,
  content,
  oldLine: null,
  newLine: null,
});

const hunk = (lines: DiffLine[]): DiffHunk =>
  ({ header: '@@', oldStart: 1, oldCount: lines.length, newStart: 1, newCount: lines.length, lines }) as DiffHunk;

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

describe('capHunkLines', () => {
  it('caps across hunk boundaries and reports the exact remainder', () => {
    const first = hunk([
      line('context', 'one'),
      line('deletion', 'two'),
      line('addition', 'three'),
    ]);
    const second = hunk([line('context', 'ten'), line('addition', 'eleven')]);

    const capped = capHunkLines([first, second], 4);

    expect(capped.remaining).toBe(1);
    expect(capped.hunks.map((item) => item.lines.map((entry) => entry.content))).toEqual([
      ['one', 'two', 'three'],
      ['ten'],
    ]);
    expect(second.lines).toHaveLength(2);
  });

  it('handles zero and oversized limits', () => {
    const input = [hunk([line('context', 'one')])];
    expect(capHunkLines(input, 0)).toEqual({ hunks: [], remaining: 1 });
    expect(capHunkLines(input, 10)).toMatchObject({ remaining: 0 });
  });
});
