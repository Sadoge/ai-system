export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified' | 'binary';

export interface DiffFile {
  id: string;
  oldPath: string | null;
  newPath: string | null;
  path: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  metadata: string[];
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
  additions: number;
  deletions: number;
  state: 'empty' | 'parsed' | 'unparseable';
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function decodeGitPath(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return unquoted.replace(/\\([0-7]{3}|[abfnrtv\\"])/g, (_match, escape: string) => {
    if (/^[0-7]{3}$/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    const escapedCharacters: Record<string, string> = {
      a: '\x07',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      '"': '"',
    };
    return escapedCharacters[escape] ?? escape;
  });
}

function cleanPath(value: string): string | null {
  const token = value.split('\t', 1)[0]!.trim();
  if (token === '/dev/null') return null;
  return decodeGitPath(token).replace(/^[ab]\//, '');
}

function pathsFromGitHeader(line: string): [string | null, string | null] {
  const body = line.slice('diff --git '.length);
  const quoted = /^((?:"(?:\\.|[^"])*")) ((?:"(?:\\.|[^"])*"))$/.exec(body);
  if (quoted) return [cleanPath(quoted[1]!), cleanPath(quoted[2]!)];

  const separator = body.lastIndexOf(' b/');
  if (!body.startsWith('a/') || separator < 0) return [null, null];
  return [cleanPath(body.slice(0, separator)), cleanPath(body.slice(separator + 1))];
}

function fileId(path: string, index: number): string {
  return `diff-file-${index}-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** Parse the git-style unified patch emitted by the worker. Malformed sections
 * are retained as metadata where possible instead of taking down the run page. */
export function parseUnifiedDiff(patch: string | null | undefined): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const startFile = (oldPath: string | null, newPath: string | null): DiffFile => {
    const path = newPath ?? oldPath ?? `unknown-${files.length + 1}`;
    const file: DiffFile = {
      id: fileId(path, files.length),
      oldPath,
      newPath,
      path,
      status: oldPath === null ? 'added' : newPath === null ? 'deleted' : 'modified',
      additions: 0,
      deletions: 0,
      metadata: [],
      hunks: [],
    };
    files.push(file);
    return file;
  };

  if (!patch?.trim()) return { files, additions: 0, deletions: 0, state: 'empty' };

  const hunkComplete = () =>
    hunk !== null &&
    oldLine >= hunk.oldStart + hunk.oldCount &&
    newLine >= hunk.newStart + hunk.newCount;

  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    if (line.startsWith('diff --git ')) {
      const [oldPath, newPath] = pathsFromGitHeader(line);
      current = startFile(oldPath, newPath);
      hunk = null;
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (current && header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = {
        header: line,
        oldStart: oldLine,
        oldCount: Number(header[2] ?? 1),
        newStart: newLine,
        newCount: Number(header[4] ?? 1),
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }

    // A no-newline marker belongs to the preceding hunk even when that hunk's
    // declared line counts have just been satisfied.
    if (current && hunk && line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
      continue;
    }
    if (hunkComplete()) hunk = null;

    // Hunk bodies must win over file-header detection: a deleted SQL comment
    // such as "-- note" is encoded as "--- note" in a patch.
    if (current && hunk && line.startsWith('+')) {
      hunk.lines.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine });
      current.additions++;
      newLine++;
      continue;
    }
    if (current && hunk && line.startsWith('-')) {
      hunk.lines.push({ kind: 'deletion', content: line.slice(1), oldLine, newLine: null });
      current.deletions++;
      oldLine++;
      continue;
    }
    if (current && hunk && (line.startsWith(' ') || line === '')) {
      hunk.lines.push({ kind: 'context', content: line.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
      continue;
    }

    if (!current && line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      current = startFile(cleanPath(line.slice(4)), cleanPath(lines[index + 1]!.slice(4)));
    }
    if (!current) continue;

    if (line.startsWith('--- ')) {
      current.oldPath = cleanPath(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      current.newPath = cleanPath(line.slice(4));
      current.path = current.newPath ?? current.oldPath ?? current.path;
      current.status =
        current.oldPath === null ? 'added' : current.newPath === null ? 'deleted' : current.status;
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.oldPath = decodeGitPath(line.slice('rename from '.length));
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.newPath = decodeGitPath(line.slice('rename to '.length));
      current.path = current.newPath;
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line === 'GIT binary patch' || line.startsWith('Binary files ')) {
      current.status = 'binary';
      current.metadata.push(line);
      hunk = null;
      continue;
    }

    if (line) current.metadata.push(line);
  }

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    state: files.length > 0 ? 'parsed' : 'unparseable',
  };
}
