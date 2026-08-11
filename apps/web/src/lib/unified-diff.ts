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
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== '\\') {
      const codePoint = value.codePointAt(index)!;
      bytes.push(...encoder.encode(String.fromCodePoint(codePoint)));
      if (codePoint > 0xffff) index++;
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === undefined) {
      bytes.push(0x5c);
      continue;
    }

    const simpleEscapes: Record<string, number> = {
      '\\': 0x5c,
      '"': 0x22,
      t: 0x09,
      n: 0x0a,
      r: 0x0d,
      b: 0x08,
      f: 0x0c,
      v: 0x0b,
      a: 0x07,
    };
    const simpleEscape = simpleEscapes[escaped];
    if (simpleEscape !== undefined) {
      bytes.push(simpleEscape);
      index++;
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && index + 1 + octal.length < value.length) {
        const next = value[index + 1 + octal.length]!;
        if (!/[0-7]/.test(next)) break;
        octal += next;
      }
      bytes.push(Number.parseInt(octal, 8) & 0xff);
      index += octal.length;
      continue;
    }

    bytes.push(...encoder.encode(escaped));
    index++;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function unquoteGitPath(raw: string): string | null {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = decodeQuotedPath(path.slice(1, -1));
  }
  if (path === '/dev/null') return null;
  return path.replace(/^[ab]\//, '');
}

function cleanPath(value: string): string | null {
  const path = value.trimStart();
  if (!path.startsWith('"')) return unquoteGitPath(path.split('\t', 1)[0]!);

  let escaped = false;
  for (let index = 1; index < path.length; index++) {
    if (!escaped && path[index] === '"') return unquoteGitPath(path.slice(0, index + 1));
    if (!escaped && path[index] === '\\') escaped = true;
    else escaped = false;
  }
  return unquoteGitPath(path);
}

function pathsFromGitHeader(line: string): [string | null, string | null] {
  const value = line.slice('diff --git '.length);
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
    if (quoted && character === '\\' && !escaped) escaped = true;
    else escaped = false;
  }
  if (token) tokens.push(token);
  if (tokens.length === 2) return [unquoteGitPath(tokens[0]!), unquoteGitPath(tokens[1]!)];

  // Unquoted spaces are ambiguous. The last b/ separator is the only stable
  // boundary available until the explicit file markers arrive.
  const separator = value.lastIndexOf(' b/');
  if (separator < 0) return [null, null];
  return [unquoteGitPath(value.slice(0, separator)), unquoteGitPath(value.slice(separator + 1))];
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

  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
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

    if (hunk && line === '\\ No newline at end of file') {
      hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
      continue;
    }

    const hunkComplete =
      hunk && oldLine >= hunk.oldStart + hunk.oldCount && newLine >= hunk.newStart + hunk.newCount;
    if (hunk && !hunkComplete) {
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
      } else {
        hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
      }
      continue;
    }
    if (hunkComplete) hunk = null;

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
      current.oldPath = unquoteGitPath(line.slice('rename from '.length));
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.newPath = unquoteGitPath(line.slice('rename to '.length));
      current.path = current.newPath ?? current.path;
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line.startsWith('new file mode ')) current.status = 'added';
    if (line.startsWith('deleted file mode ')) current.status = 'deleted';
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

    if (!hunk) {
      if (line) current.metadata.push(line);
      continue;
    }

    // Unknown hunk-adjacent content is retained above as metadata; reaching
    // here means this line belongs to file metadata rather than line content.
  }

  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
