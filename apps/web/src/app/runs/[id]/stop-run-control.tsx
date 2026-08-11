'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { stopRunAction } from '@/lib/actions';
import { buttonDangerCls, buttonQuietCls } from '@/lib/ui';

export function StopRunControl({ runId }: { runId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonDangerCls}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Stop run
      </button>
    );
  }

  return (
    <div
      className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto"
      aria-busy={isPending}
    >
      <span className="annot mr-1 text-sm text-ink-label">Stop active and queued work?</span>
      <button
        type="button"
        className={`${buttonDangerCls} disabled:cursor-wait disabled:opacity-60`}
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await stopRunAction(runId);
              setConfirming(false);
              router.refresh();
            } catch {
              setError('Could not stop the run. Refresh the page and try again.');
            }
          });
        }}
      >
        {isPending ? 'Stopping…' : 'Confirm stop'}
      </button>
      <button
        type="button"
        className={`${buttonQuietCls} disabled:cursor-wait disabled:opacity-60`}
        disabled={isPending}
        onClick={() => {
          setConfirming(false);
          setError(null);
        }}
      >
        Keep running
      </button>
      {error && (
        <span role="alert" className="basis-full font-mono text-xs text-mark-bright">
          {error}
        </span>
      )}
    </div>
  );
}
