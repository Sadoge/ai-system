import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { System, linkCls } from '@/lib/ui';
import { ArtifactView, artifactCopy } from './artifact-view';

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
  const copy = artifactCopy(artifact.kind);

  return (
    <main>
      <p className="mb-6">
        <Link href={`/runs/${id}`} className={`${linkCls} font-mono text-xs`}>
          ← back to the score
        </Link>
      </p>

      <System mark="A" title={copy.title} aside={artifact.kind}>
        <p className="annot mb-6 max-w-[65ch] text-sm text-ink-label">{copy.description}</p>
        <ArtifactView kind={artifact.kind} content={artifact.content} />
        <p className="mt-5 flex flex-col gap-1 border-t border-rule pt-3 font-mono text-xs text-ink-faint sm:flex-row sm:items-start">
          <span className="min-w-0 break-all">sha256 {artifact.contentHash}</span>
          <span className="shrink-0 text-ink-faint tnum sm:ml-3">
            {new Date(artifact.createdAt).toLocaleString()}
          </span>
        </p>
      </System>
    </main>
  );
}
