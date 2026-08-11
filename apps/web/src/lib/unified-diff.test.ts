import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './unified-diff';

describe('parseUnifiedDiff', () => {
  it('parses files, hunks, line numbers, and totals', () => {
    const parsed = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const oldValue = 2;
+const newValue = 2;
+const extra = 3;
 export { a };
`);

    expect(parsed).toMatchObject({ additions: 2, deletions: 1 });
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]).toMatchObject({ path: 'src/a.ts', status: 'modified' });
    expect(
      parsed.files[0]!.hunks[0]!.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    ).toEqual([
      ['context', 1, 1],
      ['deletion', 2, null],
      ['addition', null, 2],
      ['addition', null, 3],
      ['context', 3, 4],
    ]);
  });

  it('recognizes added, deleted, renamed, and binary files', () => {
    const parsed = parseUnifiedDiff(`diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+new
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/before.txt b/after.txt
similarity index 100%
rename from before.txt
rename to after.txt
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`);

    expect(parsed.files.map((file) => file.status)).toEqual([
      'added',
      'deleted',
      'renamed',
      'binary',
    ]);
    expect(parsed.files.map((file) => file.path)).toEqual([
      'new.txt',
      'old.txt',
      'after.txt',
      'logo.png',
    ]);
  });

  it('accepts a unified patch without a diff --git header', () => {
    const parsed = parseUnifiedDiff(`--- a/readme.md
+++ b/readme.md
@@ -1 +1 @@
-before
+after`);

    expect(parsed.files[0]).toMatchObject({ path: 'readme.md', additions: 1, deletions: 1 });
  });

  it('treats file-header lookalikes inside a hunk as source lines', () => {
    const parsed = parseUnifiedDiff(`diff --git a/migration.sql b/migration.sql
--- a/migration.sql
+++ b/migration.sql
@@ -8,3 +8,2 @@
 keep
--- deleted SQL comment
 after`);

    expect(parsed.files[0]).toMatchObject({
      path: 'migration.sql',
      oldPath: 'migration.sql',
      deletions: 1,
    });
    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'keep', oldLine: 8, newLine: 8 },
      { kind: 'deletion', content: '-- deleted SQL comment', oldLine: 9, newLine: null },
      { kind: 'context', content: 'after', oldLine: 10, newLine: 9 },
    ]);
  });

  it('keeps trimmed empty context lines and advances both counters', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -4,2 +4,2 @@

 after`);

    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: '', oldLine: 4, newLine: 4 },
      { kind: 'context', content: 'after', oldLine: 5, newLine: 5 },
    ]);
  });

  it('decodes quoted git paths and octal escapes', () => {
    const parsed =
      parseUnifiedDiff(`diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"
--- "a/src/quoted\\040file.ts"
+++ "b/src/quoted\\040file.ts"`);

    expect(parsed.files[0]!.path).toBe('src/quoted file.ts');
  });

  it('keeps mode changes and no-newline markers without changing totals', () => {
    const modeOnly = parseUnifiedDiff(`diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`);
    const changed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);

    expect(modeOnly.files[0]).toMatchObject({
      path: 'script.sh',
      additions: 0,
      deletions: 0,
      metadata: ['old mode 100644', 'new mode 100755'],
    });
    expect(changed).toMatchObject({ additions: 1, deletions: 1 });
    expect(changed.files[0]!.hunks[0]!.lines.filter((line) => line.kind === 'meta')).toHaveLength(
      2,
    );
  });

  it.each([
    [''],
    ['   \n\t'],
    ['this is not a diff\nand has no headers'],
    ['@@ not a hunk @@\n+not code'],
  ])('returns no files for empty or unrecognizable input %#', (patch) => {
    expect(parseUnifiedDiff(patch)).toEqual({ files: [], additions: 0, deletions: 0 });
  });

  it('does not throw or produce invalid counts for a truncated hunk', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@
-old`);

    expect(parsed).toMatchObject({ additions: 0, deletions: 1 });
    expect(Number.isNaN(parsed.files[0]!.deletions)).toBe(false);
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
