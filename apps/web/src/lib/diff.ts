export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export type DiffLineType = 'context' | 'addition' | 'deletion' | 'no-newline';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  section?: string;
  lines: DiffLine[];
}

export interface ModeChange {
  oldMode: string | null;
  newMode: string | null;
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

interface MutableFile extends Omit<DiffFile, 'id'> {
  oldMode: string | null;
  newMode: string | null;
}

const EMPTY_DIFF: ParsedDiff = {
  files: [],
  additions: 0,
  deletions: 0,
  fileCount: 0,
};

function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;

  let decoded = '';
  for (let index = 1; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '"') break;
    if (character !== '\\') {
      decoded += character;
      continue;
    }

    const escaped = trimmed[index + 1];
    if (escaped === undefined) break;
    const escapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
    };
    if (escaped in escapes) {
      decoded += escapes[escaped];
      index += 1;
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      const octal = trimmed.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? '';
      decoded += String.fromCharCode(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    decoded += escaped;
    index += 1;
  }
  return decoded;
}

function stripPrefix(path: string): string {
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
}

function pathFromHeader(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '/dev/null') return null;

  const path = trimmed.startsWith('"')
    ? decodeGitPath(trimmed)
    : trimmed.split('\t', 1)[0]!.trimEnd();
  return stripPrefix(path);
}

function quotedToken(value: string, start: number): { token: string; end: number } | null {
  if (value[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    if (!escaped && value[index] === '"') {
      return { token: value.slice(start, index + 1), end: index + 1 };
    }
    if (!escaped && value[index] === '\\') escaped = true;
    else escaped = false;
  }
  return null;
}

function pathsFromDiffHeader(value: string): [string, string] | null {
  if (value.startsWith('"')) {
    const first = quotedToken(value, 0);
    if (!first) return null;
    const secondStart = value.slice(first.end).search(/\S/) + first.end;
    const second = quotedToken(value, secondStart);
    if (!second) return null;
    return [stripPrefix(decodeGitPath(first.token)), stripPrefix(decodeGitPath(second.token))];
  }

  const boundary = value.lastIndexOf(' b/');
  if (boundary < 0) return null;
  return [stripPrefix(value.slice(0, boundary)), stripPrefix(value.slice(boundary + 1))];
}

function createFile(paths: [string, string] | null): MutableFile {
  const [oldPath, newPath] = paths ?? [null, null];
  return {
    path: newPath ?? oldPath ?? '',
    oldPath,
    newPath,
    status: 'modified',
    binary: false,
    modeChange: null,
    additions: 0,
    deletions: 0,
    hunks: [],
    oldMode: null,
    newMode: null,
  };
}

function finishFile(file: MutableFile): Omit<DiffFile, 'id'> {
  const renamed = file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath;
  const status: DiffFileStatus =
    file.oldPath === null
      ? 'added'
      : file.newPath === null
        ? 'deleted'
        : renamed
          ? 'renamed'
          : 'modified';
  const modeChange =
    file.oldMode !== null || file.newMode !== null
      ? { oldMode: file.oldMode, newMode: file.newMode }
      : null;
  return {
    path: file.newPath ?? file.oldPath ?? file.path,
    oldPath: file.oldPath,
    newPath: file.newPath,
    status,
    binary: file.binary,
    modeChange,
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks,
  };
}

export function parseUnifiedDiff(input: string | null | undefined): ParsedDiff {
  if (!input?.trim()) return { ...EMPTY_DIFF, files: [] };

  const files: Array<Omit<DiffFile, 'id'>> = [];
  let file: MutableFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;

  const flushFile = () => {
    if (!file) return;
    const finished = finishFile(file);
    if (finished.path || finished.hunks.length > 0 || finished.binary || finished.modeChange) {
      files.push(finished);
    }
    file = null;
    hunk = null;
  };

  for (const line of input.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      file = createFile(pathsFromDiffHeader(line.slice('diff --git '.length)));
      continue;
    }

    if (!file && line.startsWith('--- ')) file = createFile(null);
    if (!file) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: ?(.*))?$/);
      if (!match) {
        hunk = null;
        continue;
      }
      oldNumber = Number.parseInt(match[1]!, 10);
      newNumber = Number.parseInt(match[3]!, 10);
      const section = match[5]?.trim();
      hunk = {
        header: line,
        oldStart: oldNumber,
        oldCount: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
        newStart: newNumber,
        newCount: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
        ...(section ? { section } : {}),
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }

    if (hunk) {
      if (line === '\\ No newline at end of file') {
        hunk.lines.push({ type: 'no-newline', content: line, oldNumber: null, newNumber: null });
      } else if (line.startsWith('+')) {
        hunk.lines.push({
          type: 'addition',
          content: line.slice(1),
          oldNumber: null,
          newNumber,
        });
        file.additions += 1;
        newNumber += 1;
      } else if (line.startsWith('-')) {
        hunk.lines.push({
          type: 'deletion',
          content: line.slice(1),
          oldNumber,
          newNumber: null,
        });
        file.deletions += 1;
        oldNumber += 1;
      } else if (line.startsWith(' ')) {
        hunk.lines.push({
          type: 'context',
          content: line.slice(1),
          oldNumber,
          newNumber,
        });
        oldNumber += 1;
        newNumber += 1;
      }
      continue;
    }

    if (line.startsWith('--- ')) {
      file.oldPath = pathFromHeader(line.slice(4));
    } else if (line.startsWith('+++ ')) {
      file.newPath = pathFromHeader(line.slice(4));
    } else if (line.startsWith('rename from ')) {
      file.oldPath = decodeGitPath(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      file.newPath = decodeGitPath(line.slice('rename to '.length));
    } else if (line.startsWith('old mode ')) {
      file.oldMode = line.slice('old mode '.length).trim();
    } else if (line.startsWith('new mode ')) {
      file.newMode = line.slice('new mode '.length).trim();
    } else if (line.startsWith('new file mode ')) {
      file.newMode = line.slice('new file mode '.length).trim();
    } else if (line.startsWith('deleted file mode ')) {
      file.oldMode = line.slice('deleted file mode '.length).trim();
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      file.binary = true;
    }
  }
  flushFile();

  const identifiedFiles = files.map((parsedFile, index) => ({
    ...parsedFile,
    id: `${index}:${parsedFile.path}`,
  }));
  return {
    files: identifiedFiles,
    additions: identifiedFiles.reduce((sum, item) => sum + item.additions, 0),
    deletions: identifiedFiles.reduce((sum, item) => sum + item.deletions, 0),
    fileCount: identifiedFiles.length,
  };
}
