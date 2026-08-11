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
@@ -4,3 +4,3 @@
---- remove the legacy table
-old value
+++ add the replacement table
+new value
 keep`);

    const file = parsed.files[0]!;
    expect(file.path).toBe('migration.sql');
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'deletion', content: '--- remove the legacy table', oldLine: 4, newLine: null },
      { kind: 'deletion', content: 'old value', oldLine: 5, newLine: null },
      { kind: 'addition', content: '++ add the replacement table', oldLine: null, newLine: 4 },
      { kind: 'addition', content: 'new value', oldLine: null, newLine: 5 },
      { kind: 'context', content: 'keep', oldLine: 6, newLine: 6 },
    ]);
  });

  it('preserves empty context lines after trailing whitespace is trimmed', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -8,2 +8,2 @@

 after`);

    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: '', oldLine: 8, newLine: 8 },
      { kind: 'context', content: 'after', oldLine: 9, newLine: 9 },
    ]);
  });

  it('decodes quoted paths and accepts unquoted paths containing spaces', () => {
    const parsed =
      parseUnifiedDiff(`diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"
--- "a/src/quoted\\040file.ts"
+++ "b/src/quoted\\040file.ts"
diff --git a/src/another file.ts b/src/another file.ts
--- a/src/another file.ts
+++ b/src/another file.ts`);

    expect(parsed.files.map((file) => file.path)).toEqual([
      'src/quoted file.ts',
      'src/another file.ts',
    ]);
  });

  it('retains mode changes and no-newline markers without changing totals', () => {
    const parsed = parseUnifiedDiff(`diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
--- a/script.sh
+++ b/script.sh
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);

    expect(parsed).toMatchObject({ additions: 1, deletions: 1 });
    expect(parsed.files[0]!.metadata).toEqual(['old mode 100644', 'new mode 100755']);
    expect(parsed.files[0]!.hunks[0]!.lines.filter((line) => line.kind === 'meta')).toEqual([
      { kind: 'meta', content: '\\ No newline at end of file', oldLine: null, newLine: null },
      { kind: 'meta', content: '\\ No newline at end of file', oldLine: null, newLine: null },
    ]);
  });

  it.each([
    ['truncated hunk', 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old'],
    ['invalid hunk header', 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ invalid @@\n+body'],
    ['random content', 'this is not a diff\nand has no headers'],
  ])('handles malformed input without throwing: %s', (_name, patch) => {
    expect(() => parseUnifiedDiff(patch)).not.toThrow();
    const parsed = parseUnifiedDiff(patch);
    expect(Number.isNaN(parsed.additions)).toBe(false);
    expect(Number.isNaN(parsed.deletions)).toBe(false);
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
