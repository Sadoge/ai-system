import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FileEntry, FileRole, RepoIndex } from './types.js';

const exec = promisify(execFile);

const PARSEABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MAX_PARSE_BYTES = 512 * 1024;

// Lightweight extraction, deliberately conservative: exports and import
// specifiers only. The shape is what matters — the tree-sitter indexer
// (docs/09) swaps in behind the same RepoIndex contract.
const EXPORT_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT_RE = /^import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/gm;

export async function indexRepository(checkoutDir: string): Promise<RepoIndex> {
  const { stdout: sha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: checkoutDir });
  const { stdout: fileList } = await exec('git', ['ls-files'], {
    cwd: checkoutDir,
    maxBuffer: 32 * 1024 * 1024,
  });
  const paths = fileList.split('\n').filter(Boolean);

  const files: FileEntry[] = [];
  const symbols: Record<string, string[]> = {};
  const imports: Record<string, string[]> = {};

  for (const path of paths) {
    let bytes: number;
    try {
      bytes = (await stat(join(checkoutDir, path))).size;
    } catch {
      continue; // deleted between ls-files and stat
    }
    files.push({ path, role: classify(path), bytes });

    if (PARSEABLE.test(path) && bytes <= MAX_PARSE_BYTES) {
      const content = await readFile(join(checkoutDir, path), 'utf8');
      const exported = [...content.matchAll(EXPORT_RE)].map((m) => m[1]!);
      const imported = [...content.matchAll(IMPORT_RE)].map((m) => m[1]!);
      if (exported.length > 0) symbols[path] = exported;
      if (imported.length > 0) imports[path] = imported;
    }
  }

  return { commitSha: sha.trim(), files, symbols, imports };
}

function classify(path: string): FileRole {
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(path) || /\.(test|spec)\.[jt]sx?$/.test(path)) {
    return 'test';
  }
  if (/(^|\/)(docs?)\//.test(path) || /\.(md|rst|adoc)$/.test(path)) return 'docs';
  if (/(^|\/)(dist|build|generated|__generated__)\//.test(path) || /\.lock$|-lock\.(json|yaml)$/.test(path)) {
    return 'generated';
  }
  if (
    /(^|\/)\..+rc(\.\w+)?$|\.(config|conf)\.[\w.]+$|^(package|tsconfig[^/]*|pyproject|Cargo|go)\.(json|toml|mod)$/.test(
      path,
    ) ||
    /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|Makefile)$/.test(path)
  ) {
    return 'config';
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|cs|php|swift|c|h|cpp|hpp)$/.test(path)) {
    return 'source';
  }
  return 'other';
}
