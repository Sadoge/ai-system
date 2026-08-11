import { describe, expect, it } from 'vitest';
import { affectedFilesFromArtifact, artifactCopy, diffSummary } from './artifact-view';

describe('artifact presentation helpers', () => {
  it('collects affected files from plans, findings, and diffs without duplicates', () => {
    const content = {
      steps: [{ files: ['apps/web/page.tsx', 'apps/web/page.tsx'] }],
      findings: [{ filePath: 'apps/api/service.ts' }],
      diff: [
        'diff --git a/apps/web/page.tsx b/apps/web/page.tsx',
        '--- a/apps/web/page.tsx',
        '+++ b/apps/web/page.tsx',
      ].join('\n'),
    };

    expect(affectedFilesFromArtifact(content)).toEqual([
      'apps/web/page.tsx',
      'apps/api/service.ts',
    ]);
  });

  it('summarizes a unified diff without counting file headers as changed lines', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1,2 @@',
      '-old',
      '+new',
      '+another',
    ].join('\n');

    expect(diffSummary(diff)).toEqual({ files: ['a.ts'], additions: 2, deletions: 1 });
  });

  it('provides readable copy for known and future artifact kinds', () => {
    expect(artifactCopy('implementation_plan').title).toBe('Implementation plan');
    expect(artifactCopy('future_output').title).toBe('Future output');
  });
});
