import Link from 'next/link';
import { System, linkCls } from '@/lib/ui';
import { DiffViewer } from '../../diff-viewer';

export interface ArtifactDetail {
  id: string;
  runId: string;
  kind: string;
  content: unknown;
  contentHash: string;
  createdAt: string;
}

export function ArtifactView({ artifact }: { artifact: ArtifactDetail }) {
  const content = typeof artifact?.content === 'string' ? artifact.content : '';

  return (
    <main>
      <p className="mb-6">
        <Link href={`/runs/${artifact.runId}`} className={`${linkCls} font-mono text-xs`}>
          ← back to the score
        </Link>
      </p>

      <System mark="A" title={artifact.kind}>
        {artifact.kind === 'diff' && content ? (
          <DiffViewer patch={content} />
        ) : (
          <pre className="overflow-x-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed text-ink-secondary">
            {JSON.stringify(artifact.content, null, 2)}
          </pre>
        )}
        <p className="mt-3 font-mono text-xs text-ink-faint">
          sha256 {artifact.contentHash}
          <span className="ml-3 text-ink-faint tnum">
            {new Date(artifact.createdAt).toLocaleString()}
          </span>
        </p>
      </System>
    </main>
  );
}
