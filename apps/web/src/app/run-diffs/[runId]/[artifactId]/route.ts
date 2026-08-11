import { apiGet, type ArtifactDetail } from '@/lib/api';
import { readDiffArtifactContent, type DiffArtifactContent } from '@/lib/diff-artifact';

interface DiffLoadResult {
  data: DiffArtifactContent | null;
  error?: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  const { runId, artifactId } = await params;

  try {
    const artifact = await apiGet<ArtifactDetail>(`/runs/${runId}/artifacts/${artifactId}`);
    if (artifact.kind !== 'diff') {
      const result: DiffLoadResult = {
        data: null,
        error: 'The selected artifact is not a diff.',
      };
      return Response.json(result, { status: 422 });
    }

    const data =
      typeof artifact.content === 'string'
        ? { diff: artifact.content }
        : readDiffArtifactContent(artifact.content);
    if (!data) {
      const result: DiffLoadResult = {
        data: null,
        error: 'The diff artifact content is unavailable or malformed.',
      };
      return Response.json(result, { status: 422 });
    }
    const result: DiffLoadResult = { data };
    return Response.json(result);
  } catch (error) {
    const result: DiffLoadResult = {
      data: null,
      error: error instanceof Error ? error.message : 'The diff artifact request failed.',
    };
    return Response.json(result, { status: 502 });
  }
}
