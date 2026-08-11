import { describe, expect, it } from 'vitest';
import { capHunkLines, groupHunkLines } from './diff-view-model';
import type { DiffHunk, DiffLine } from './unified-diff';

const context = (line: number): DiffLine => ({
  kind: 'context',
  content: `line ${line}`,
  oldLine: line,
  newLine: line,
});

const hunk = (header: string, lines: DiffLine[]): DiffHunk => ({
  header,
  oldStart: 1,
  oldCount: lines.length,
  newStart: 1,
  newCount: lines.length,
  lines,
});

describe('groupHunkLines', () => {
  it('keeps short context runs visible', () => {
    const input = hunk(
      '@@',
      Array.from({ length: 7 }, (_, index) => context(index + 1)),
    );
    expect(groupHunkLines(input)).toEqual([{ kind: 'visible', lines: input.lines }]);
  });

  it('collapses the middle of long unchanged runs without dropping lines', () => {
    const input = hunk(
      '@@',
      Array.from({ length: 12 }, (_, index) => context(index + 1)),
    );
    const groups = groupHunkLines(input);

    expect(groups.map((group) => [group.kind, group.lines.length])).toEqual([
      ['visible', 3],
      ['collapsed', 6],
      ['visible', 3],
    ]);
    expect(groups.flatMap((group) => group.lines)).toEqual(input.lines);
  });
});

describe('capHunkLines', () => {
  const first = hunk('@@ first @@', [context(1), context(2), context(3)]);
  const second = hunk('@@ second @@', [context(10), context(11), context(12)]);

  it('caps across hunk boundaries and reports the exact remainder', () => {
    const capped = capHunkLines([first, second], 4);

    expect(capped.hunks.map((item) => item.lines.length)).toEqual([3, 1]);
    expect(capped.remaining).toBe(2);
  });

  it('does not mutate the parsed diff', () => {
    const capped = capHunkLines([first, second], 5);

    expect(capped.hunks.map((item) => item.lines.length)).toEqual([3, 2]);
    expect(capped.hunks[1]!.lines[0]!.content).toBe('line 10');
    expect(second.lines).toHaveLength(3);
  });

  it('handles zero and oversized limits', () => {
    expect(capHunkLines([first], 0)).toEqual({ hunks: [], remaining: 3 });
    expect(capHunkLines([first], 10)).toMatchObject({ remaining: 0 });
  });
});
