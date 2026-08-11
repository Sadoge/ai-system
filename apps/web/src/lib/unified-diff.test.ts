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

  it('treats --- and +++ prefixes inside a hunk as changed source lines', () => {
    const parsed = parseUnifiedDiff(`diff --git a/migration.sql b/migration.sql
--- a/migration.sql
+++ b/migration.sql
@@ -8,3 +8,3 @@
 keep
--- old migration comment
+++ new migration comment
 after`);

    expect(parsed.files[0]).toMatchObject({
      path: 'migration.sql',
      oldPath: 'migration.sql',
      newPath: 'migration.sql',
      additions: 1,
      deletions: 1,
    });
    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'keep', oldLine: 8, newLine: 8 },
      { kind: 'deletion', content: '-- old migration comment', oldLine: 9, newLine: null },
      { kind: 'addition', content: '++ new migration comment', oldLine: null, newLine: 9 },
      { kind: 'context', content: 'after', oldLine: 10, newLine: 10 },
    ]);
  });

  it('keeps trimmed empty context lines and advances both counters', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -4,3 +4,3 @@
 before

 after`);

    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'before', oldLine: 4, newLine: 4 },
      { kind: 'context', content: '', oldLine: 5, newLine: 5 },
      { kind: 'context', content: 'after', oldLine: 6, newLine: 6 },
    ]);
  });

  it('resets line numbers at every hunk', () => {
    const parsed = parseUnifiedDiff(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@
-one
+ONE
@@ -10,2 +10,3 @@
 ten
-eleven
+ELEVEN
+twelve`);

    expect(
      parsed.files[0]!.hunks[1]!.lines.map(({ kind, oldLine, newLine }) => ({
        kind,
        oldLine,
        newLine,
      })),
    ).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10 },
      { kind: 'deletion', oldLine: 11, newLine: null },
      { kind: 'addition', oldLine: null, newLine: 11 },
      { kind: 'addition', oldLine: null, newLine: 12 },
    ]);
  });

  it('preserves no-newline markers without changing counts', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);

    expect(parsed).toMatchObject({ additions: 1, deletions: 1, valid: true });
    expect(parsed.files[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual([
      'deletion',
      'meta',
      'addition',
      'meta',
    ]);
  });

  it('keeps mode-only changes as file metadata', () => {
    const parsed = parseUnifiedDiff(`diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`);

    expect(parsed.files[0]).toMatchObject({
      path: 'script.sh',
      additions: 0,
      deletions: 0,
      metadata: ['old mode 100644', 'new mode 100755'],
    });
  });

  it('decodes quoted paths and accepts unquoted paths containing spaces', () => {
    const quoted =
      parseUnifiedDiff(`diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"
--- "a/src/quoted\\040file.ts"
+++ "b/src/quoted\\040file.ts"`);
    const unquoted = parseUnifiedDiff(`diff --git a/src/my file.ts b/src/my file.ts
--- a/src/my file.ts
+++ b/src/my file.ts`);

    expect(quoted.files[0]!.path).toBe('src/quoted file.ts');
    expect(unquoted.files[0]!.path).toBe('src/my file.ts');
  });

  it('marks malformed or truncated non-empty content as invalid', () => {
    const random = parseUnifiedDiff('this is not a diff\nand has no headers');
    const truncated = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@
-old`);

    expect(random).toMatchObject({ files: [], valid: false });
    expect(truncated).toMatchObject({ valid: false });
  });

  it('assigns distinct reproducible ids when paths repeat', () => {
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
