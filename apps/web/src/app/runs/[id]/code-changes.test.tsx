import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiffPresentation } from './code-changes';

describe('DiffPresentation', () => {
  it('shows stored non-empty content when it cannot be parsed', () => {
    const html = renderToStaticMarkup(
      <DiffPresentation
        runId="run-1"
        artifactId="artifact-1"
        content={{ diff: 'stored content that is not a unified patch' }}
      />,
    );

    expect(html).toContain('could not be parsed as a unified diff');
    expect(html).toContain('stored content that is not a unified patch');
    expect(html).not.toContain('contains no file changes');
  });

  it('reserves the no-file-changes message for whitespace-only patches', () => {
    const html = renderToStaticMarkup(
      <DiffPresentation runId="run-1" artifactId="artifact-1" content={{ diff: '  \n\t' }} />,
    );

    expect(html).toContain('contains no file changes');
    expect(html).not.toContain('could not be parsed');
  });
});
