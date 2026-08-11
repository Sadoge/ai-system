import type { ArtifactDetail } from '@/lib/api';
import { readDiffArtifactContent } from '@/lib/diff-artifact';
import { DiffPresentation } from '../../code-changes';

export function ArtifactView({ artifact, runId }: { artifact: ArtifactDetail; runId: string }) {
  if (artifact.kind === 'diff') {
    const content =
      typeof artifact.content === 'string'
        ? { diff: artifact.content }
        : readDiffArtifactContent(artifact.content);
    return (
      <DiffPresentation
        runId={runId}
        artifactId={artifact.id}
        content={content}
        error={content ? undefined : 'The diff artifact content is unavailable or malformed.'}
        showArtifactLink={false}
      />
    );
  }

  return (
    <pre className="overflow-x-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed text-ink-secondary">
      {JSON.stringify(artifact.content, null, 2)}
    </pre>
  );
}
