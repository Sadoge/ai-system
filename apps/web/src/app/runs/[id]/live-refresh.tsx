'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Subscribes to the run's SSE feed (proxied through the Next server so the
 * API token never reaches the browser) and refreshes the page on new events.
 */
export function LiveRefresh({ runId, active }: { runId: string; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const source = new EventSource(`/stream/${runId}`);
    source.onmessage = () => router.refresh();
    source.onerror = () => {
      // Fall back to slow polling if the stream drops.
    };
    const fallback = setInterval(() => router.refresh(), 10_000);
    return () => {
      source.close();
      clearInterval(fallback);
    };
  }, [runId, active, router]);
  return null;
}
