import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff';

describe('parseUnifiedDiff', () => {
  it('aggregates multi-file and per-file statistics', () => {
    const patch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,1 @@
-old
 keep`;

    const result = parseUnifiedDiff(patch);

    expect(result).toMatchObject({ additions: 2, deletions: 2, fileCount: 2 });
    expect(
      result.files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    ).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 1 },
      { path: 'src/b.ts', additions: 0, deletions: 1 },
    ]);
  });

  it('resets line numbers at every hunk', () => {
    const patch = `diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1,2 +1,2 @@ first
 one
-two
+second
@@ -10,2 +10,3 @@ second
 ten
-eleven
+ELEVEN
+twelve`;

    const file = parseUnifiedDiff(patch).files[0]!;

    expect(file.hunks).toHaveLength(2);
    expect(
      file.hunks[1]!.lines.map(({ type, oldNumber, newNumber }) => ({
        type,
        oldNumber,
        newNumber,
      })),
    ).toEqual([
      { type: 'context', oldNumber: 10, newNumber: 10 },
      { type: 'deletion', oldNumber: 11, newNumber: null },
      { type: 'addition', oldNumber: null, newNumber: 11 },
      { type: 'addition', oldNumber: null, newNumber: 12 },
    ]);
  });

  it('defaults omitted hunk counts to one and captures the section heading', () => {
    const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@ export function answer()
-return 41;
+return 42;`;

    const hunk = parseUnifiedDiff(patch).files[0]!.hunks[0]!;

    expect(hunk).toMatchObject({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 });
    expect(hunk.section).toBe('export function answer()');
    expect(hunk.lines).toHaveLength(2);
  });

  it('recognizes added and deleted files with null opposite paths', () => {
    const patch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null`;

    const [added, deleted] = parseUnifiedDiff(patch).files;

    expect(added).toMatchObject({ status: 'added', oldPath: null, newPath: 'new.ts' });
    expect(deleted).toMatchObject({ status: 'deleted', oldPath: 'old.ts', newPath: null });
  });

  it('recognizes a rename and a rename containing edits', () => {
    const patch = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
diff --git a/before.ts b/after.ts
similarity index 80%
rename from before.ts
rename to after.ts
--- a/before.ts
+++ b/after.ts
@@ -1 +1 @@
-before
+after`;

    const [plainRename, editedRename] = parseUnifiedDiff(patch).files;

    expect(plainRename).toMatchObject({
      status: 'renamed',
      oldPath: 'old.ts',
      newPath: 'new.ts',
      additions: 0,
      deletions: 0,
    });
    expect(editedRename).toMatchObject({
      status: 'renamed',
      oldPath: 'before.ts',
      newPath: 'after.ts',
      additions: 1,
      deletions: 1,
    });
  });

  it('keeps both binary marker formats as zero-count files', () => {
    const patch = `diff --git a/image.png b/image.png
--- a/image.png
+++ b/image.png
Binary files a/image.png and b/image.png differ
diff --git a/archive.bin b/archive.bin
--- a/archive.bin
+++ b/archive.bin
GIT binary patch
literal 0
HcmV?d00001`;

    const result = parseUnifiedDiff(patch);

    expect(result).toMatchObject({ additions: 0, deletions: 0, fileCount: 2 });
    expect(
      result.files.map(({ binary, additions, deletions }) => ({ binary, additions, deletions })),
    ).toEqual([
      { binary: true, additions: 0, deletions: 0 },
      { binary: true, additions: 0, deletions: 0 },
    ]);
  });

  it('keeps a mode-change-only file without inventing line changes', () => {
    const patch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;

    const result = parseUnifiedDiff(patch);

    expect(result).toMatchObject({ additions: 0, deletions: 0, fileCount: 1 });
    expect(result.files[0]).toMatchObject({
      modeChange: { oldMode: '100644', newMode: '100755' },
      additions: 0,
      deletions: 0,
    });
  });

  it.each([
    [
      'modified',
      `diff --git a/x b/x
--- a/x
+++ b/x`,
    ],
    [
      'added',
      `diff --git a/x b/x
new file mode 100644
--- /dev/null
+++ b/x`,
    ],
    [
      'deleted',
      `diff --git a/x b/x
deleted file mode 100644
--- a/x
+++ /dev/null`,
    ],
    [
      'renamed',
      `diff --git a/x b/y
similarity index 100%
rename from x
rename to y`,
    ],
    [
      'binary',
      `diff --git a/x b/x
--- a/x
+++ b/x
Binary files a/x and b/x differ`,
    ],
    [
      'mode change',
      `diff --git a/x b/x
old mode 100644
new mode 100755`,
    ],
  ])('does not count file headers for a %s file', (_kind, patch) => {
    const result = parseUnifiedDiff(patch);

    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.files[0]!.additions).toBe(0);
    expect(result.files[0]!.deletions).toBe(0);
  });

  it('represents the no-newline marker without changing counts or line numbers', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`;

    const result = parseUnifiedDiff(patch);
    const lines = result.files[0]!.hunks[0]!.lines;

    expect(result).toMatchObject({ additions: 1, deletions: 1 });
    expect(lines.filter((line) => line.type === 'no-newline')).toEqual([
      {
        type: 'no-newline',
        content: '\\ No newline at end of file',
        oldNumber: null,
        newNumber: null,
      },
      {
        type: 'no-newline',
        content: '\\ No newline at end of file',
        oldNumber: null,
        newNumber: null,
      },
    ]);
    expect(lines[0]).toMatchObject({ type: 'deletion', oldNumber: 1, newNumber: null });
    expect(lines[2]).toMatchObject({ type: 'addition', oldNumber: null, newNumber: 1 });
  });

  it('parses unquoted paths containing spaces', () => {
    const patch = `diff --git a/src/my file.ts b/src/my file.ts
--- a/src/my file.ts
+++ b/src/my file.ts`;

    expect(parseUnifiedDiff(patch).files[0]!.path).toBe('src/my file.ts');
  });

  it('decodes quoted git paths and escapes', () => {
    const patch = `diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"
--- "a/src/quoted\\040file.ts"
+++ "b/src/quoted\\040file.ts"`;

    expect(parseUnifiedDiff(patch).files[0]!.path).toBe('src/quoted file.ts');
  });

  it.each([[''], ['   \n\t'], [null], [undefined]])(
    'returns zero results for empty input %#',
    (input) => {
      expect(parseUnifiedDiff(input)).toEqual({
        files: [],
        additions: 0,
        deletions: 0,
        fileCount: 0,
      });
    },
  );

  it.each([
    [
      'truncated hunk',
      `diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@
-old`,
    ],
    [
      'non-matching hunk header',
      `diff --git a/x b/x
--- a/x
+++ b/x
@@ not a hunk @@
+not code`,
    ],
    [
      'body before a hunk',
      `diff --git a/x b/x
--- a/x
+++ b/x
+not code yet
-also not code`,
    ],
    ['random blob', 'this is not a diff\nand has no headers'],
  ])('handles malformed input without throwing or producing NaN: %s', (_name, patch) => {
    expect(() => parseUnifiedDiff(patch)).not.toThrow();
    const result = parseUnifiedDiff(patch);

    expect(Number.isNaN(result.additions)).toBe(false);
    expect(Number.isNaN(result.deletions)).toBe(false);
    for (const file of result.files) {
      expect(Number.isNaN(file.additions)).toBe(false);
      expect(Number.isNaN(file.deletions)).toBe(false);
    }
  });

  it('assigns distinct, reproducible ids when paths repeat', () => {
    const patch = `diff --git a/x b/x
--- a/x
+++ b/x
diff --git a/x b/x
--- a/x
+++ b/x`;

    const first = parseUnifiedDiff(patch);
    const second = parseUnifiedDiff(patch);

    expect(first.files[0]!.id).not.toBe(first.files[1]!.id);
    expect(first.files.map((file) => file.id)).toEqual(second.files.map((file) => file.id));
  });
});
