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

  it('resets line numbers at every hunk and defaults omitted counts to one', () => {
    const parsed = parseUnifiedDiff(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@ first
-one
+ONE
@@ -10,2 +10,3 @@ second
 ten
-eleven
+ELEVEN
+twelve`);

    expect(parsed.files[0]!.hunks[0]).toMatchObject({
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: 1,
    });
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

  it('treats header-looking hunk body lines as code', () => {
    const parsed = parseUnifiedDiff(`diff --git a/migration.sql b/migration.sql
--- a/migration.sql
+++ b/migration.sql
@@ -4,2 +4 @@
--- remove the legacy column
 SELECT 1;`);
    const file = parsed.files[0]!;

    expect(file.path).toBe('migration.sql');
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'deletion', content: '-- remove the legacy column', oldLine: 4, newLine: null },
      { kind: 'context', content: 'SELECT 1;', oldLine: 5, newLine: 4 },
    ]);
  });

  it('keeps trimmed empty context lines in sync', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,2 +1,2 @@

 after`);

    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: '', oldLine: 1, newLine: 1 },
      { kind: 'context', content: 'after', oldLine: 2, newLine: 2 },
    ]);
  });

  it('retains no-newline markers without changing counts or line numbers', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);

    expect(parsed).toMatchObject({ additions: 1, deletions: 1 });
    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'deletion', content: 'old', oldLine: 1, newLine: null },
      {
        kind: 'meta',
        content: '\\ No newline at end of file',
        oldLine: null,
        newLine: null,
      },
      { kind: 'addition', content: 'new', oldLine: null, newLine: 1 },
      {
        kind: 'meta',
        content: '\\ No newline at end of file',
        oldLine: null,
        newLine: null,
      },
    ]);
  });

  it('decodes quoted git paths and accepts unquoted paths containing spaces', () => {
    const parsed =
      parseUnifiedDiff(`diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"
--- "a/src/quoted\\040file.ts"
+++ "b/src/quoted\\040file.ts"
diff --git a/src/plain file.ts b/src/plain file.ts
--- a/src/plain file.ts
+++ b/src/plain file.ts`);

    expect(parsed.files.map((file) => file.path)).toEqual([
      'src/quoted file.ts',
      'src/plain file.ts',
    ]);
  });

  it('retains mode-only changes and assigns stable, distinct ids', () => {
    const patch = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;
    const first = parseUnifiedDiff(patch);
    const second = parseUnifiedDiff(patch);

    expect(first.files).toHaveLength(2);
    expect(first.files[0]).toMatchObject({
      status: 'modified',
      additions: 0,
      deletions: 0,
      metadata: ['old mode 100644', 'new mode 100755'],
    });
    expect(first.files[0]!.id).not.toBe(first.files[1]!.id);
    expect(first.files.map((file) => file.id)).toEqual(second.files.map((file) => file.id));
  });

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
    ['random blob', 'this is not a diff\nand has no headers'],
  ])('handles malformed input without throwing or producing NaN: %s', (_name, patch) => {
    expect(() => parseUnifiedDiff(patch)).not.toThrow();
    const parsed = parseUnifiedDiff(patch);
    expect(Number.isNaN(parsed.additions)).toBe(false);
    expect(Number.isNaN(parsed.deletions)).toBe(false);
  });
});
