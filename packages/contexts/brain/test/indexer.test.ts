import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexRepository } from '../src/indexer.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brain-fixture-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'test'));
  writeFileSync(
    join(dir, 'src/greeter.ts'),
    `import { helper } from './helper.js';\nexport function greet(name: string) { return helper(name); }\nexport const VERSION = '1.0';\n`,
  );
  writeFileSync(join(dir, 'src/helper.ts'), `export function helper(n: string) { return 'hi ' + n; }\n`);
  writeFileSync(join(dir, 'test/greeter.test.ts'), `import { greet } from '../src/greeter.js';\n`);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

describe('indexRepository', () => {
  it('builds file map, roles, exports, and import edges', async () => {
    const dir = makeFixtureRepo();
    const index = await indexRepository(dir);

    expect(index.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const roles = Object.fromEntries(index.files.map((f) => [f.path, f.role]));
    expect(roles['src/greeter.ts']).toBe('source');
    expect(roles['test/greeter.test.ts']).toBe('test');
    expect(roles['README.md']).toBe('docs');
    expect(roles['package.json']).toBe('config');

    expect(index.symbols['src/greeter.ts']).toEqual(['greet', 'VERSION']);
    expect(index.imports['src/greeter.ts']).toEqual(['./helper.js']);
  });
});
