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

function cleanPath(value: string): string | null {
  const token = value.split('\t', 1)[0]!.trim();
  if (token === '/dev/null') return null;
  return decodeGitPath(token).replace(/^[ab]\//, '');
}

function decodeGitPath(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return unquoted.replace(/\\([0-7]{3}|[\\"])/g, (_match, escape: string) => {
    if (escape === '\\' || escape === '"') return escape;
    return String.fromCharCode(Number.parseInt(escape, 8));
  });
}

function pathsFromGitHeader(line: string): [string | null, string | null] {
  const match = /^diff --git (?:"a\/(.*)"|a\/(.*)) (?:"b\/(.*)"|b\/(.*))$/.exec(line);
  if (!match) return [null, null];
  return [decodeGitPath(match[1] ?? match[2] ?? ''), decodeGitPath(match[3] ?? match[4] ?? '')];
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

  const normalized = patch.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();

  const appendHunkLine = (line: string): boolean => {
    if (!current || !hunk) return false;
    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine });
      current.additions++;
      newLine++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'deletion', content: line.slice(1), oldLine, newLine: null });
      current.deletions++;
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      hunk.lines.push({
        kind: 'context',
        content: line === '' ? '' : line.slice(1),
        oldLine,
        newLine,
      });
      oldLine++;
      newLine++;
    } else if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
    } else {
      return false;
    }
    return true;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    if (line.startsWith('diff --git ')) {
      const [oldPath, newPath] = pathsFromGitHeader(line);
      current = startFile(oldPath, newPath);
      hunk = null;
      continue;
    }

    if (!current && line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      current = startFile(cleanPath(line.slice(4)), cleanPath(lines[index + 1]!.slice(4)));
    }
    if (!current) continue;

    // Hunk bodies take precedence over file markers: a deleted source line
    // beginning with "-- " is encoded as "--- ", and an added line beginning
    // with "++ " is encoded as "+++ ".
    if (appendHunkLine(line)) continue;

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

    if (line) current.metadata.push(line);
  }

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
