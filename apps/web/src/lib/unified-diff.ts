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
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function decodeQuotedPath(value: string): string {
  return value.replace(/\\([0-7]{1,3}|[\\"tnr])/g, (_match, escape: string) => {
    if (/^[0-7]+$/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    return { '\\': '\\', '"': '"', t: '\t', n: '\n', r: '\r' }[escape] ?? escape;
  });
}

function cleanPath(value: string): string | null {
  const trimmed = value.trimStart();
  let token = trimmed.split('\t', 1)[0]!.trim();
  if (token.startsWith('"')) {
    let escaped = false;
    for (let index = 1; index < token.length; index++) {
      if (!escaped && token[index] === '"') {
        token = decodeQuotedPath(token.slice(1, index));
        break;
      }
      escaped = !escaped && token[index] === '\\';
    }
  }
  if (token === '/dev/null') return null;
  return token.replace(/^[ab]\//, '');
}

function tokenizeGitHeader(value: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (!quoted && character === ' ') {
      if (token) tokens.push(token);
      token = '';
      continue;
    }
    token += character;
    if (character === '"' && !escaped) quoted = !quoted;
    escaped = quoted && character === '\\' && !escaped;
  }
  if (token) tokens.push(token);
  return tokens;
}

function pathsFromGitHeader(line: string): [string | null, string | null] {
  const value = line.slice('diff --git '.length);
  const tokens = tokenizeGitHeader(value);
  if (tokens.length === 2) return [cleanPath(tokens[0]!), cleanPath(tokens[1]!)];

  const separator = value.lastIndexOf(' b/');
  if (separator < 0) return [null, null];
  return [cleanPath(value.slice(0, separator)), cleanPath(value.slice(separator + 1))];
}

function fileId(path: string, index: number): string {
  return `diff-file-${index}-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** Parse the git-style unified patch emitted by the worker. Malformed sections
 * are retained as metadata where possible instead of taking down the run page. */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldLinesRead = 0;
  let newLinesRead = 0;

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

  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    if (line.startsWith('diff --git ')) {
      const [oldPath, newPath] = pathsFromGitHeader(line);
      current = startFile(oldPath, newPath);
      hunk = null;
      continue;
    }

    if (
      hunk &&
      line.startsWith('\\')
    ) {
      hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
      continue;
    }

    if (hunk && oldLinesRead >= hunk.oldCount && newLinesRead >= hunk.newCount) {
      hunk = null;
    }

    if (!current && line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      current = startFile(cleanPath(line.slice(4)), cleanPath(lines[index + 1]!.slice(4)));
    }
    if (!current) continue;

    if (!hunk && line.startsWith('--- ')) {
      current.oldPath = cleanPath(line.slice(4));
      continue;
    }
    if (!hunk && line.startsWith('+++ ')) {
      current.newPath = cleanPath(line.slice(4));
      current.path = current.newPath ?? current.oldPath ?? current.path;
      current.status =
        current.oldPath === null ? 'added' : current.newPath === null ? 'deleted' : current.status;
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.oldPath = line.slice('rename from '.length);
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.newPath = line.slice('rename to '.length);
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

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      oldLinesRead = 0;
      newLinesRead = 0;
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

    if (!hunk) {
      if (line) current.metadata.push(line);
      continue;
    }

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine });
      current.additions++;
      newLine++;
      newLinesRead++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'deletion', content: line.slice(1), oldLine, newLine: null });
      current.deletions++;
      oldLine++;
      oldLinesRead++;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', content: line.slice(1), oldLine, newLine });
      oldLine++;
      newLine++;
      oldLinesRead++;
      newLinesRead++;
    } else if (line === '') {
      hunk.lines.push({ kind: 'context', content: '', oldLine, newLine });
      oldLine++;
      newLine++;
      oldLinesRead++;
      newLinesRead++;
    }
  }

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
