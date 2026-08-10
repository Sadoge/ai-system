import Link from 'next/link';
import { apiGet, type GateRow } from '@/lib/api';
import { resolveGateAction } from '@/lib/actions';
import {
  Caesura,
  Fermata,
  System,
  buttonCls,
  buttonDangerCls,
  inputCls,
  linkCls,
} from '@/lib/ui';

export default async function GatesPage() {
  const gates = await apiGet<GateRow[]>('/gates?status=pending');

  return (
    <main>
      <System mark="A" title="Held for you" aside={`${gates.length}`}>
        {gates.length === 0 ? (
          <p className="annot py-6 text-sm text-ink-label">
            Nothing is waiting. Every voice is sounding or closed.
          </p>
        ) : (
          <div className="space-y-5">
            {gates.map((gate) => (
              <Caesura key={gate.id}>
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Fermata className="shrink-0 text-mark" />
                  <span className="font-mono text-sm text-mark-bright">{gate.gate}</span>
                  <span className="annot text-sm text-ink-label">on</span>
                  <Link href={`/runs/${gate.runId}`} className={`${linkCls} font-mono text-sm`}>
                    run {gate.runId.slice(-8)}
                  </Link>
                  <span className="ml-auto font-mono text-xs text-ink-faint tnum">
                    {new Date(gate.createdAt).toLocaleString()}
                  </span>
                </div>
                <form action={resolveGateAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="gateId" value={gate.id} />
                  <label className="flex min-w-56 flex-1 flex-col gap-1">
                    <span className="annot text-xs text-ink-label">
                      Comment — required to reject
                    </span>
                    <input name="comment" className={inputCls} placeholder="Why" />
                  </label>
                  <button type="submit" name="decision" value="approved" className={buttonCls}>
                    Approve
                  </button>
                  <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
                    Reject
                  </button>
                </form>
              </Caesura>
            ))}
          </div>
        )}
      </System>
    </main>
  );
}
