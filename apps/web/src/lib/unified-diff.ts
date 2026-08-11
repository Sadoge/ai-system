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

interface PendingHunk extends DiffHunk {
  nextOldLine: number;
  nextNewLine: number;
}

interface PendingFile {
  fallbackOldPath: string | null;
  fallbackNewPath: string | null;
  markerOldPath: string | null;
  markerNewPath: string | null;
  sawOldMarker: boolean;
  sawNewMarker: boolean;
  renameFrom: string | null;
  renameTo: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  metadata: string[];
  hunks: PendingHunk[];
  activeHunk: PendingHunk | null;
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

function cleanPath(raw: string): string | null {
  let value = raw.trimStart();
  if (value.startsWith('"')) {
    let escaped = false;
    for (let index = 1; index < value.length; index++) {
      if (!escaped && value[index] === '"') {
        value = decodeQuotedPath(value.slice(1, index));
        break;
      }
      if (!escaped && value[index] === '\\') escaped = true;
      else escaped = false;
    }
  } else {
    value = value.split('\t', 1)[0]!.trim();
  }
  if (value === '/dev/null') return null;
  return value.replace(/^[ab]\//, '');
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

  const separator = value.lastIndexOf(' b/');
  return separator >= 0
    ? [cleanPath(value.slice(0, separator)), cleanPath(value.slice(separator + 1))]
    : [null, null];
}

function newPendingFile(header?: string): PendingFile {
  const [fallbackOldPath, fallbackNewPath] = header ? pathsFromGitHeader(header) : [null, null];
  return {
    fallbackOldPath,
    fallbackNewPath,
    markerOldPath: null,
    markerNewPath: null,
    sawOldMarker: false,
    sawNewMarker: false,
    renameFrom: null,
    renameTo: null,
    status: 'modified',
    additions: 0,
    deletions: 0,
    metadata: [],
    hunks: [],
    activeHunk: null,
  };
}

function appendHunkLine(file: PendingFile, line: string): boolean {
  const hunk = file.activeHunk;
  if (!hunk) return false;

  if (line === '\\ No newline at end of file') {
    hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
    return true;
  }
  const complete =
    hunk.nextOldLine >= hunk.oldStart + hunk.oldCount &&
    hunk.nextNewLine >= hunk.newStart + hunk.newCount;
  if (complete) {
    file.activeHunk = null;
    return false;
  }
  if (line.startsWith('+')) {
    hunk.lines.push({
      kind: 'addition',
      content: line.slice(1),
      oldLine: null,
      newLine: hunk.nextNewLine++,
    });
    file.additions++;
  } else if (line.startsWith('-')) {
    hunk.lines.push({
      kind: 'deletion',
      content: line.slice(1),
      oldLine: hunk.nextOldLine++,
      newLine: null,
    });
    file.deletions++;
  } else if (line.startsWith(' ') || line === '') {
    hunk.lines.push({
      kind: 'context',
      content: line === '' ? '' : line.slice(1),
      oldLine: hunk.nextOldLine++,
      newLine: hunk.nextNewLine++,
    });
  } else {
    hunk.lines.push({ kind: 'meta', content: line, oldLine: null, newLine: null });
  }
  return true;
}

/** Parse git-style unified patches without allowing malformed sections to take
 * down the run page. Content that has no recognizable file remains detectable
 * by the presentation layer as an unparseable, non-empty patch. */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  if (!patch.trim()) return { files: [], additions: 0, deletions: 0 };

  const files: DiffFile[] = [];
  const idCounts = new Map<string, number>();
  let current: PendingFile | null = null;

  const finishFile = () => {
    if (!current) return;
    const oldPath =
      current.renameFrom ??
      (current.sawOldMarker ? current.markerOldPath : current.fallbackOldPath);
    const newPath =
      current.renameTo ?? (current.sawNewMarker ? current.markerNewPath : current.fallbackNewPath);
    const path = newPath ?? oldPath ?? `unknown-${files.length + 1}`;
    const baseId = `${oldPath ?? '/dev/null'}\u0000${newPath ?? '/dev/null'}`;
    const occurrence = (idCounts.get(baseId) ?? 0) + 1;
    idCounts.set(baseId, occurrence);
    const status =
      current.status === 'binary'
        ? 'binary'
        : current.status === 'renamed'
          ? 'renamed'
          : current.sawOldMarker && oldPath === null
            ? 'added'
            : current.sawNewMarker && newPath === null
              ? 'deleted'
              : current.status;
    files.push({
      id: `diff-file-${files.length}-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${occurrence}`,
      oldPath,
      newPath,
      path,
      status,
      additions: current.additions,
      deletions: current.deletions,
      metadata: current.metadata,
      hunks: current.hunks.map(({ nextOldLine: _old, nextNewLine: _new, ...hunk }) => hunk),
    });
    current = null;
  };

  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      current = newPendingFile(line);
      continue;
    }
    if (!current && (line.startsWith('--- ') || HUNK_HEADER.test(line))) {
      current = newPendingFile();
    }
    if (!current) continue;

    const hunkHeader = HUNK_HEADER.exec(line);
    if (hunkHeader) {
      const oldStart = Number(hunkHeader[1]);
      const newStart = Number(hunkHeader[3]);
      const hunk: PendingHunk = {
        header: line,
        oldStart,
        oldCount: Number(hunkHeader[2] ?? 1),
        newStart,
        newCount: Number(hunkHeader[4] ?? 1),
        lines: [],
        nextOldLine: oldStart,
        nextNewLine: newStart,
      };
      current.hunks.push(hunk);
      current.activeHunk = hunk;
      continue;
    }

    // Hunk content must win over file-header lookalikes such as a deleted SQL
    // comment (`--- comment` in patch form).
    if (appendHunkLine(current, line)) continue;

    if (line.startsWith('--- ')) {
      current.markerOldPath = cleanPath(line.slice(4));
      current.sawOldMarker = true;
    } else if (line.startsWith('+++ ')) {
      current.markerNewPath = cleanPath(line.slice(4));
      current.sawNewMarker = true;
    } else if (line.startsWith('rename from ')) {
      current.renameFrom = cleanPath(line.slice('rename from '.length));
      current.status = 'renamed';
      current.metadata.push(line);
    } else if (line.startsWith('rename to ')) {
      current.renameTo = cleanPath(line.slice('rename to '.length));
      current.status = 'renamed';
      current.metadata.push(line);
    } else if (line.startsWith('new file mode ')) {
      current.status = 'added';
      current.metadata.push(line);
    } else if (line.startsWith('deleted file mode ')) {
      current.status = 'deleted';
      current.metadata.push(line);
    } else if (
      line === 'GIT binary patch' ||
      /^(?:Binary files|Files) .+ and .+ differ$/.test(line)
    ) {
      current.status = 'binary';
      current.metadata.push(line);
    } else if (line) {
      current.metadata.push(line);
    }
  }

  finishFile();
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
