export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export type DiffLineType = 'context' | 'addition' | 'deletion' | 'meta' | 'no-newline';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  id: string;
  header: string;
  section: string | null;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Compatibility aliases used by the diff renderer. */
  oldLines: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ModeChange {
  oldMode: string | null;
  newMode: string | null;
  /** Compatibility aliases used by the existing run view. */
  from: string | null;
  to: string | null;
}

export interface DiffFile {
  id: string;
  path: string;
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  binary: boolean;
  modeChange: ModeChange | null;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
  additions: number;
  deletions: number;
  fileCount: number;
}

interface PendingHunk extends Omit<DiffHunk, 'id'> {
  nextOldNumber: number;
  nextNewNumber: number;
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
  sawRename: boolean;
  sawSimilarity: boolean;
  explicitlyAdded: boolean;
  explicitlyDeleted: boolean;
  binary: boolean;
  oldMode: string | null;
  newMode: string | null;
  additions: number;
  deletions: number;
  hunks: PendingHunk[];
  activeHunk: PendingHunk | null;
}

const EMPTY_DIFF: ParsedDiff = { files: [], additions: 0, deletions: 0, fileCount: 0 };
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function decodeQuotedPath(value: string): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character !== '\\') {
      const codePoint = value.codePointAt(index)!;
      bytes.push(...encoder.encode(String.fromCodePoint(codePoint)));
      if (codePoint > 0xffff) index += 1;
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
      index += 1;
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
    index += 1;
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

function headerPath(raw: string): string | null {
  const value = raw.trimStart();
  if (!value.startsWith('"')) return unquoteGitPath(value.split('\t', 1)[0]!);

  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    if (!escaped && value[index] === '"') return unquoteGitPath(value.slice(0, index + 1));
    if (!escaped && value[index] === '\\') escaped = true;
    else escaped = false;
  }
  return unquoteGitPath(value);
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

function fallbackPaths(header: string): [string | null, string | null] {
  const value = header.slice('diff --git '.length);
  const tokens = tokenizeGitHeader(value);
  if (tokens.length === 2) return [unquoteGitPath(tokens[0]!), unquoteGitPath(tokens[1]!)];

  // Unquoted spaces are ambiguous. Rename and file-marker paths take precedence.
  const separator = value.lastIndexOf(' b/');
  if (separator >= 0) {
    return [unquoteGitPath(value.slice(0, separator)), unquoteGitPath(value.slice(separator + 1))];
  }
  return [null, null];
}

function newPendingFile(header?: string): PendingFile {
  const [fallbackOldPath, fallbackNewPath] = header ? fallbackPaths(header) : [null, null];
  return {
    fallbackOldPath,
    fallbackNewPath,
    markerOldPath: null,
    markerNewPath: null,
    sawOldMarker: false,
    sawNewMarker: false,
    renameFrom: null,
    renameTo: null,
    sawRename: false,
    sawSimilarity: false,
    explicitlyAdded: false,
    explicitlyDeleted: false,
    binary: false,
    oldMode: null,
    newMode: null,
    additions: 0,
    deletions: 0,
    hunks: [],
    activeHunk: null,
  };
}

function appendMeta(file: PendingFile, content: string): void {
  file.activeHunk?.lines.push({ type: 'meta', content, oldNumber: null, newNumber: null });
}

function lineCountsAreComplete(hunk: PendingHunk): boolean {
  return (
    hunk.nextOldNumber >= hunk.oldStart + hunk.oldCount &&
    hunk.nextNewNumber >= hunk.newStart + hunk.newCount
  );
}

function appendHunkLine(file: PendingFile, line: string): boolean {
  const hunk = file.activeHunk;
  if (!hunk) return false;

  if (line === '\\ No newline at end of file') {
    hunk.lines.push({ type: 'no-newline', content: line, oldNumber: null, newNumber: null });
    return true;
  }
  if (lineCountsAreComplete(hunk)) {
    file.activeHunk = null;
    return false;
  }
  if (line.startsWith('+')) {
    hunk.lines.push({
      type: 'addition',
      content: line.slice(1),
      oldNumber: null,
      newNumber: hunk.nextNewNumber,
    });
    hunk.nextNewNumber += 1;
    file.additions += 1;
    return true;
  }
  if (line.startsWith('-')) {
    hunk.lines.push({
      type: 'deletion',
      content: line.slice(1),
      oldNumber: hunk.nextOldNumber,
      newNumber: null,
    });
    hunk.nextOldNumber += 1;
    file.deletions += 1;
    return true;
  }
  if (line.startsWith(' ') || line === '') {
    hunk.lines.push({
      type: 'context',
      content: line === '' ? '' : line.slice(1),
      oldNumber: hunk.nextOldNumber,
      newNumber: hunk.nextNewNumber,
    });
    hunk.nextOldNumber += 1;
    hunk.nextNewNumber += 1;
    return true;
  }
  appendMeta(file, line);
  return true;
}

function resolveStatus(
  file: PendingFile,
  oldPath: string | null,
  newPath: string | null,
): DiffFileStatus {
  if (file.explicitlyAdded || (file.sawOldMarker && oldPath === null && newPath !== null)) {
    return 'added';
  }
  if (file.explicitlyDeleted || (file.sawNewMarker && newPath === null && oldPath !== null)) {
    return 'deleted';
  }
  if (file.sawRename || (file.sawSimilarity && oldPath !== newPath)) return 'renamed';
  return 'modified';
}

export function parseUnifiedDiff(patch: string | null | undefined): ParsedDiff {
  if (!patch?.trim()) return { ...EMPTY_DIFF, files: [] };

  const files: DiffFile[] = [];
  const idCounts = new Map<string, number>();
  let currentFile: PendingFile | null = null;

  const finishFile = (): void => {
    if (!currentFile) return;
    const oldPath =
      currentFile.renameFrom ??
      (currentFile.sawOldMarker ? currentFile.markerOldPath : currentFile.fallbackOldPath);
    const newPath =
      currentFile.renameTo ??
      (currentFile.sawNewMarker ? currentFile.markerNewPath : currentFile.fallbackNewPath);
    const baseId = `${oldPath ?? '/dev/null'}\u0000${newPath ?? '/dev/null'}`;
    const occurrence = (idCounts.get(baseId) ?? 0) + 1;
    idCounts.set(baseId, occurrence);
    const id = occurrence === 1 ? baseId : `${baseId}#${occurrence}`;
    const hunks: DiffHunk[] = currentFile.hunks.map(
      ({ nextOldNumber: _old, nextNewNumber: _new, ...hunk }) => ({
        ...hunk,
        id: `${id}@${hunk.oldStart},${hunk.newStart}`,
      }),
    );
    const modeChange =
      currentFile.oldMode !== null || currentFile.newMode !== null
        ? {
            oldMode: currentFile.oldMode,
            newMode: currentFile.newMode,
            from: currentFile.oldMode,
            to: currentFile.newMode,
          }
        : null;

    files.push({
      id,
      path: newPath ?? oldPath ?? '',
      oldPath,
      newPath,
      status: resolveStatus(currentFile, oldPath, newPath),
      binary: currentFile.binary,
      modeChange,
      additions: currentFile.additions,
      deletions: currentFile.deletions,
      hunks,
    });
    currentFile = null;
  };

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      currentFile = newPendingFile(line);
      continue;
    }
    if (!currentFile && (line.startsWith('--- ') || line.startsWith('@@'))) {
      currentFile = newPendingFile();
    }
    if (!currentFile) continue;

    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      if (!match) {
        appendMeta(currentFile, line);
        continue;
      }
      const oldStart = Number(match[1]);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      const section = match[5]!.trim();
      const hunk: PendingHunk = {
        header: line,
        section: section || null,
        oldStart,
        oldCount,
        newStart,
        newCount,
        oldLines: oldCount,
        newLines: newCount,
        lines: [],
        nextOldNumber: oldStart,
        nextNewNumber: newStart,
      };
      currentFile.hunks.push(hunk);
      currentFile.activeHunk = hunk;
      continue;
    }

    if (appendHunkLine(currentFile, line)) continue;

    if (line.startsWith('--- ')) {
      currentFile.markerOldPath = headerPath(line.slice(4));
      currentFile.sawOldMarker = true;
    } else if (line.startsWith('+++ ')) {
      currentFile.markerNewPath = headerPath(line.slice(4));
      currentFile.sawNewMarker = true;
    } else if (line.startsWith('rename from ')) {
      currentFile.renameFrom = unquoteGitPath(line.slice('rename from '.length));
      currentFile.sawRename = true;
    } else if (line.startsWith('rename to ')) {
      currentFile.renameTo = unquoteGitPath(line.slice('rename to '.length));
      currentFile.sawRename = true;
    } else if (line.startsWith('similarity index ')) {
      currentFile.sawSimilarity = true;
    } else if (line.startsWith('new file mode ')) {
      currentFile.explicitlyAdded = true;
      currentFile.newMode = line.slice('new file mode '.length).trim();
    } else if (line.startsWith('deleted file mode ')) {
      currentFile.explicitlyDeleted = true;
      currentFile.oldMode = line.slice('deleted file mode '.length).trim();
    } else if (line.startsWith('old mode ')) {
      currentFile.oldMode = line.slice('old mode '.length).trim();
    } else if (line.startsWith('new mode ')) {
      currentFile.newMode = line.slice('new mode '.length).trim();
    } else if (
      line === 'GIT binary patch' ||
      /^(?:Binary files|Files) .+ and .+ differ$/.test(line)
    ) {
      currentFile.binary = true;
    }
  }

  finishFile();
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return { files, additions, deletions, fileCount: files.length };
}
