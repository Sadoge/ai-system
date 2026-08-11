import { describe, expect, it } from 'vitest';
import type { DiffFile } from './diff';
import { parseUnifiedDiff } from './diff';
import {
  changeBarSegments,
  collapseAll,
  expandAll,
  fileAccessibleLabel,
  fileStatusLabel,
  initialExpandedFiles,
  sliceFileLines,
  summaryAccessibleLabel,
  toggleFile,
  truncatePath,
  visibleHunks,
} from './diff-view';

function files(count: number): DiffFile[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index}`,
    path: `file-${index}.ts`,
    oldPath: `file-${index}.ts`,
    newPath: `file-${index}.ts`,
    status: 'modified',
    binary: false,
    modeChange: null,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
}

describe('file expansion state', () => {
  it.each([1, 2, 3])('initially opens all of %i files', (count) => {
    const input = files(count);
    expect(initialExpandedFiles(input)).toEqual(new Set(input.map((file) => file.id)));
  });

  it.each([4, 5])('initially opens none of %i files', (count) => {
    expect(initialExpandedFiles(files(count))).toEqual(new Set());
  });

  it('toggles files independently without mutating its input', () => {
    const original = new Set(['file-0']);
    const opened = toggleFile(original, 'file-1');
    const closed = toggleFile(opened, 'file-0');

    expect(original).toEqual(new Set(['file-0']));
    expect(opened).toEqual(new Set(['file-0', 'file-1']));
    expect(closed).toEqual(new Set(['file-1']));
  });

  it('expands and collapses all files', () => {
    const input = files(4);
    expect(expandAll(input)).toEqual(new Set(input.map((file) => file.id)));
    expect(collapseAll()).toEqual(new Set());
  });
});

describe('diff labels', () => {
  it.each([
    ['modified', false, 'Modified'],
    ['added', false, 'Added'],
    ['deleted', false, 'Deleted'],
    ['renamed', false, 'Renamed'],
    ['modified', true, 'Modified binary'],
    ['added', true, 'Added binary'],
    ['deleted', true, 'Deleted binary'],
    ['renamed', true, 'Renamed binary'],
  ] as const)('labels %s files when binary is %s', (status, binary, expected) => {
    expect(fileStatusLabel({ status, binary })).toBe(expected);
  });

  it('uses singular and plural counts in a file label', () => {
    expect(
      fileAccessibleLabel({
        path: 'src/a.ts',
        oldPath: 'src/a.ts',
        newPath: 'src/a.ts',
        status: 'modified',
        binary: false,
        additions: 1,
        deletions: 2,
      }),
    ).toBe('Modified file src/a.ts, 1 addition and 2 deletions');
  });

  it('describes renames with both paths', () => {
    expect(
      fileAccessibleLabel({
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        newPath: 'src/new.ts',
        status: 'renamed',
        binary: false,
        additions: 0,
        deletions: 0,
      }),
    ).toBe('Renamed file src/old.ts to src/new.ts, 0 additions and 0 deletions');
  });

  it('describes binary files without meaningless line counts', () => {
    expect(
      fileAccessibleLabel({
        path: 'logo.png',
        oldPath: 'logo.png',
        newPath: 'logo.png',
        status: 'modified',
        binary: true,
        additions: 0,
        deletions: 0,
      }),
    ).toBe('Modified binary file logo.png');
  });

  it('summarizes changes accessibly, including singular and empty cases', () => {
    expect(summaryAccessibleLabel({ fileCount: 1, additions: 1, deletions: 2 })).toBe(
      '1 file changed, 1 addition and 2 deletions',
    );
    expect(summaryAccessibleLabel({ fileCount: 2, additions: 3, deletions: 1 })).toBe(
      '2 files changed, 3 additions and 1 deletion',
    );
    expect(summaryAccessibleLabel({ fileCount: 0, additions: 0, deletions: 0 })).toBe(
      'No code changes',
    );
  });
});

describe('diff presentation helpers', () => {
  it('keeps short paths unchanged and preserves the basename when truncating', () => {
    expect(truncatePath('src/a.ts')).toBe('src/a.ts');

    const truncated = truncatePath('packages/a/very/long/path/to/component.tsx', 24);
    expect(truncated.length).toBeLessThanOrEqual(24);
    expect(truncated).toMatch(/component\.tsx$/);
    expect(truncated).toContain('…/');
  });

  it('fills exactly the requested change-bar slots', () => {
    const segments = changeBarSegments(8, 2, 7);
    expect(segments).toHaveLength(7);
    expect(segments).toContain('addition');
    expect(segments).toContain('deletion');
  });

  it('gives a one-line change a visible block', () => {
    expect(changeBarSegments(1, 0, 5)).toEqual([
      'addition',
      'neutral',
      'neutral',
      'neutral',
      'neutral',
    ]);
    expect(changeBarSegments(100, 1, 5)).toContain('deletion');
  });

  it('uses only neutral slots for an unchanged file', () => {
    expect(changeBarSegments(0, 0, 5)).toEqual(Array(5).fill('neutral'));
  });

  it('returns a cross-hunk prefix and an accurate remaining count', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@ first
 one
-two
+TWO
@@ -10,2 +10,2 @@ second
 ten
-eleven
+ELEVEN`;
    const file = parseUnifiedDiff(patch).files[0]!;

    const sliced = sliceFileLines(file.hunks, 4);
    expect(sliced.hunks).toHaveLength(2);
    expect(sliced.hunks.map((hunk) => hunk.lines.length)).toEqual([3, 1]);
    expect(sliced.remaining).toBe(2);
    expect(sliced.hunks[1]!.lines[0]!.content).toBe('ten');
    expect(file.hunks.map((hunk) => hunk.lines.length)).toEqual([3, 3]);
  });

  it('exposes the same prefix through visibleHunks', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,3 +1,3 @@
 one
 two
 three`;
    const file = parseUnifiedDiff(patch).files[0]!;

    expect(visibleHunks(file, 2)).toMatchObject({
      remaining: 1,
      hunks: [{ lines: [{ content: 'one' }, { content: 'two' }] }],
    });
  });
});
