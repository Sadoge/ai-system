import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Section } from '@/lib/ui';

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
      <p className="mb-4 text-sm">
        <Link href={`/runs/${id}`} className="text-zinc-500 hover:text-zinc-200">
          ← back to run
        </Link>
      </p>
      <Section title={artifact.kind}>
        <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-4 text-xs leading-relaxed">
          {JSON.stringify(artifact.content, null, 2)}
        </pre>
        <p className="mt-2 font-mono text-xs text-zinc-600">sha256 {artifact.contentHash}</p>
      </Section>
    </main>
  );
}
