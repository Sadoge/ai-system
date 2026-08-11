import { apiGet } from '@/lib/api';
import { ArtifactView, type ArtifactDetail } from './artifact-view';

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string; artifactId: string }>;
}) {
  const { id, artifactId } = await params;
  const artifact = await apiGet<ArtifactDetail>(`/runs/${id}/artifacts/${artifactId}`);

  return <ArtifactView artifact={artifact} />;
}
