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
  valid: boolean;
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
    if (simpleEscapes[escaped] !== undefined) {
      bytes.push(simpleEscapes[escaped]);
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

function cleanPath(value: string): string | null {
  const trimmed = value.trimStart();
  let token: string;
  if (trimmed.startsWith('"')) {
    let escaped = false;
    let closingQuote = -1;
    for (let index = 1; index < trimmed.length; index++) {
      if (!escaped && trimmed[index] === '"') {
        closingQuote = index;
        break;
      }
      if (!escaped && trimmed[index] === '\\') escaped = true;
      else escaped = false;
    }
    token = closingQuote >= 0 ? decodeQuotedPath(trimmed.slice(1, closingQuote)) : trimmed;
  } else {
    token = trimmed.split('\t', 1)[0]!.trim();
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
    if (quoted && character === '\\' && !escaped) escaped = true;
    else escaped = false;
  }
  if (token) tokens.push(token);
  return tokens;
}

function pathsFromGitHeader(line: string): [string | null, string | null] {
  const value = line.slice('diff --git '.length);
  const tokens = tokenizeGitHeader(value);
  if (tokens.length === 2) return [cleanPath(tokens[0]!), cleanPath(tokens[1]!)];

  // Unquoted paths containing spaces are ambiguous. The final b/ marker is
  // the best boundary available; the ---/+++ markers can refine it later.
  const separator = value.lastIndexOf(' b/');
  if (separator >= 0) {
    return [cleanPath(value.slice(0, separator)), cleanPath(value.slice(separator + 1))];
  }
  return [null, null];
}

function fileId(path: string, index: number): string {
  return `diff-file-${index}-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** Parse the git-style unified patch emitted by the worker. Malformed sections
 * are retained as metadata where possible instead of taking down the run page. */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  if (!patch.trim()) return { files: [], additions: 0, deletions: 0, valid: true };

  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let valid = true;

  const hunkIsComplete = () =>
    hunk !== null &&
    oldLine >= hunk.oldStart + hunk.oldCount &&
    newLine >= hunk.newStart + hunk.newCount;

  const finishHunk = () => {
    if (hunk && !hunkIsComplete()) valid = false;
    hunk = null;
  };

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
      finishHunk();
      const [oldPath, newPath] = pathsFromGitHeader(line);
      current = startFile(oldPath, newPath);
      continue;
    }

    if (!current && line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      current = startFile(cleanPath(line.slice(4)), cleanPath(lines[index + 1]!.slice(4)));
    }
    if (!current) continue;

    // A hunk body takes precedence over file markers. For example, deleting
    // the source line "-- SQL comment" is encoded as "--- SQL comment".
    if (hunk) {
      if (line === '\\ No newline at end of file') {
        hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
        continue;
      }
      if (!hunkIsComplete()) {
        if (line.startsWith('+')) {
          hunk.lines.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine });
          current.additions++;
          newLine++;
          continue;
        }
        if (line.startsWith('-')) {
          hunk.lines.push({ kind: 'deletion', content: line.slice(1), oldLine, newLine: null });
          current.deletions++;
          oldLine++;
          continue;
        }
        if (line.startsWith(' ') || line === '') {
          hunk.lines.push({
            kind: 'context',
            content: line === '' ? '' : line.slice(1),
            oldLine,
            newLine,
          });
          oldLine++;
          newLine++;
          continue;
        }
        hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
        valid = false;
        continue;
      }
      hunk = null;
    }

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
      current.oldPath = cleanPath(line.slice('rename from '.length));
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.newPath = cleanPath(line.slice('rename to '.length));
      current.path = current.newPath ?? current.path;
      current.status = 'renamed';
      current.metadata.push(line);
      continue;
    }
    if (line === 'GIT binary patch' || /^(?:Binary files|Files) .+ and .+ differ$/.test(line)) {
      current.status = 'binary';
      current.metadata.push(line);
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
    if (line.startsWith('@@')) valid = false;
    if (line) current.metadata.push(line);
  }

  finishHunk();
  if (files.length === 0) valid = false;
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    valid,
  };
}
