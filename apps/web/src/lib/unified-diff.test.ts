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

  it('keeps a deleted SQL comment in the hunk and preserves every line number', () => {
    const parsed =
      parseUnifiedDiff(`diff --git a/packages/db/migrations/001.sql b/packages/db/migrations/001.sql
--- a/packages/db/migrations/001.sql
+++ b/packages/db/migrations/001.sql
@@ -8,3 +8,2 @@
 before
--- SQL comment
 after`);

    const file = parsed.files[0]!;
    expect(file.path).toBe('packages/db/migrations/001.sql');
    expect(file.oldPath).toBe('packages/db/migrations/001.sql');
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'before', oldLine: 8, newLine: 8 },
      { kind: 'deletion', content: '-- SQL comment', oldLine: 9, newLine: null },
      { kind: 'context', content: 'after', oldLine: 10, newLine: 9 },
    ]);
  });

  it('treats a zero-length hunk line as empty context', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -4,3 +4,3 @@
 before

 after`);

    expect(parsed.files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'before', oldLine: 4, newLine: 4 },
      { kind: 'context', content: '', oldLine: 5, newLine: 5 },
      { kind: 'context', content: 'after', oldLine: 6, newLine: 6 },
    ]);
  });

  it('treats file-header-looking hunk lines as changed source', () => {
    const file =
      parseUnifiedDiff(`diff --git a/packages/db/migrations/a.sql b/packages/db/migrations/a.sql
--- a/packages/db/migrations/a.sql
+++ b/packages/db/migrations/a.sql
@@ -4,3 +4,3 @@
 keep
--- deleted SQL comment
+++ added token
 tail`).files[0]!;

    expect(file).toMatchObject({
      path: 'packages/db/migrations/a.sql',
      oldPath: 'packages/db/migrations/a.sql',
      newPath: 'packages/db/migrations/a.sql',
      additions: 1,
      deletions: 1,
    });
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'keep', oldLine: 4, newLine: 4 },
      { kind: 'deletion', content: '-- deleted SQL comment', oldLine: 5, newLine: null },
      { kind: 'addition', content: '++ added token', oldLine: null, newLine: 5 },
      { kind: 'context', content: 'tail', oldLine: 6, newLine: 6 },
    ]);
  });

  it('resets line numbers at every hunk and defaults omitted counts to one', () => {
    const file = parseUnifiedDiff(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -1 +1 @@ first
-one
+ONE
@@ -10,2 +10,3 @@ second
 ten
-eleven
+ELEVEN
+twelve`).files[0]!;

    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[0]).toMatchObject({ oldCount: 1, newCount: 1 });
    expect(
      file.hunks[1]!.lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })),
    ).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10 },
      { kind: 'deletion', oldLine: 11, newLine: null },
      { kind: 'addition', oldLine: null, newLine: 11 },
      { kind: 'addition', oldLine: null, newLine: 12 },
    ]);
  });

  it('keeps mode-only changes as metadata without inventing line changes', () => {
    const parsed = parseUnifiedDiff(`diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`);

    expect(parsed).toMatchObject({ additions: 0, deletions: 0, state: 'parsed' });
    expect(parsed.files[0]).toMatchObject({
      path: 'script.sh',
      metadata: ['old mode 100644', 'new mode 100755'],
      additions: 0,
      deletions: 0,
    });
  });

  it('represents no-newline markers without changing counts or line numbers', () => {
    const parsed = parseUnifiedDiff(`diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`);
    const lines = parsed.files[0]!.hunks[0]!.lines;

    expect(parsed).toMatchObject({ additions: 1, deletions: 1 });
    expect(lines.filter((line) => line.kind === 'meta')).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'deletion', oldLine: 1, newLine: null });
    expect(lines[2]).toMatchObject({ kind: 'addition', oldLine: null, newLine: 1 });
  });

  it.each([
    [
      'unquoted paths containing spaces',
      'diff --git a/src/my file.ts b/src/my file.ts',
      'src/my file.ts',
    ],
    [
      'quoted paths containing escapes',
      'diff --git "a/src/quoted\\040file.ts" "b/src/quoted\\040file.ts"',
      'src/quoted file.ts',
    ],
  ])('parses %s', (_name, header, path) => {
    expect(parseUnifiedDiff(`${header}\n--- a/${path}\n+++ b/${path}`).files[0]!.path).toBe(path);
  });

  it.each([[''], ['   \n\t'], [null], [undefined]])(
    'distinguishes empty input from unparseable content %#',
    (input) => {
      expect(parseUnifiedDiff(input)).toEqual({
        files: [],
        additions: 0,
        deletions: 0,
        state: 'empty',
      });
    },
  );

  it.each([
    ['truncated hunk', 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old'],
    ['non-matching hunk', 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ not a hunk @@\n+not code'],
    ['random blob', 'this is not a diff\nand has no headers'],
  ])('handles malformed input without throwing or producing NaN: %s', (_name, patch) => {
    expect(() => parseUnifiedDiff(patch)).not.toThrow();
    const parsed = parseUnifiedDiff(patch);
    expect(Number.isNaN(parsed.additions)).toBe(false);
    expect(Number.isNaN(parsed.deletions)).toBe(false);
  });

  it('marks nonempty content with no file structure as unparseable', () => {
    expect(parseUnifiedDiff('not a unified diff')).toMatchObject({
      files: [],
      state: 'unparseable',
    });
  });

  it('assigns distinct, stable ids when paths repeat', () => {
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
