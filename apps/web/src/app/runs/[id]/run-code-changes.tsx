'use client';

import { useEffect, useState } from 'react';
import type { DiffArtifactContent } from '@/lib/diff-artifact';
import { DiffPresentation } from './code-changes';

interface DiffLoadResult {
  artifactId?: string;
  data: DiffArtifactContent | null;
  error?: string;
}

export function RunCodeChanges({ runId, artifactId }: { runId: string; artifactId?: string }) {
  const [result, setResult] = useState<DiffLoadResult>({ data: null });
  const [loading, setLoading] = useState(Boolean(artifactId));

  useEffect(() => {
    if (!artifactId) {
      setResult({ data: null });
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setResult({ data: null });
    void fetch(`/run-diffs/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as DiffLoadResult;
        if (!response.ok && !body.error)
          throw new Error(`The diff request failed (${response.status}).`);
        setResult({ ...body, artifactId });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          artifactId,
          data: null,
          error: error instanceof Error ? error.message : 'The diff artifact request failed.',
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [artifactId, runId]);

  if (artifactId && (loading || result.artifactId !== artifactId)) {
    return (
      <DiffPresentation
        runId={runId}
        artifactId={artifactId}
        content={null}
        error={undefined}
        loading
      />
    );
  }

  return (
    <DiffPresentation
      runId={runId}
      artifactId={artifactId}
      content={result.data}
      error={result.error}
    />
  );
}
