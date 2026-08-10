import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { System, linkCls } from '@/lib/ui';

interface ArtifactDetail {
  id: string;
  kind: string;
  content: unknown;
  contentHash: string;
  createdAt: string;
}

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string; artifactId: string }>;
}) {
  const { id, artifactId } = await params;
  const artifact = await apiGet<ArtifactDetail>(`/runs/${id}/artifacts/${artifactId}`);

  return (
    <main>
      <p className="mb-6">
        <Link href={`/runs/${id}`} className={`${linkCls} font-mono text-xs`}>
          ← back to the score
        </Link>
      </p>

      <System mark="A" title={artifact.kind}>
        <pre className="overflow-x-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed text-ink-secondary">
          {JSON.stringify(artifact.content, null, 2)}
        </pre>
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
