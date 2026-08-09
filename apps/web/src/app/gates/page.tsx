import Link from 'next/link';
import { apiGet, type GateRow } from '@/lib/api';
import { resolveGateAction } from '@/lib/actions';
import { Section, buttonCls, buttonDangerCls, inputCls } from '@/lib/ui';

export default async function GatesPage() {
  const gates = await apiGet<GateRow[]>('/gates?status=pending');
  return (
    <main>
      <Section title={`Pending gates (${gates.length})`}>
        {gates.length === 0 && <p className="text-sm text-zinc-500">Nothing waiting on you.</p>}
        <div className="space-y-4">
          {gates.map((gate) => (
            <div key={gate.id} className="rounded border border-zinc-800 p-4">
              <p className="mb-3 text-sm">
                <span className="font-mono text-sky-300">{gate.gate}</span>
                {' on run '}
                <Link href={`/runs/${gate.runId}`} className="font-mono text-emerald-400 underline">
                  {gate.runId.slice(-8)}
                </Link>
                <span className="ml-2 text-xs text-zinc-600">
                  {new Date(gate.createdAt).toLocaleString()}
                </span>
              </p>
              <form action={resolveGateAction} className="flex items-center gap-3">
                <input type="hidden" name="gateId" value={gate.id} />
                <input name="comment" className={`${inputCls} flex-1`} placeholder="Comment" />
                <button type="submit" name="decision" value="approved" className={buttonCls}>
                  Approve
                </button>
                <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
                  Reject
                </button>
              </form>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
