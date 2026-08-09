import Link from 'next/link';
import { apiGet, type KnowledgeRow } from '@/lib/api';
import { decideKnowledgeAction } from '@/lib/actions';
import { Section, buttonCls, buttonDangerCls, inputCls } from '@/lib/ui';

interface ProposalRow extends KnowledgeRow {
  scopeTags: string[];
  sourceRunId: string | null;
}

export default async function KnowledgeInboxPage() {
  const proposals = await apiGet<ProposalRow[]>('/knowledge?status=proposed');

  return (
    <main>
      <Section title={`Proposed knowledge (${proposals.length})`}>
        <p className="mb-4 text-xs text-zinc-600">
          Learned knowledge stays invisible to agents until you approve it. Editing before approval
          is encouraged — your version becomes canonical. Rejected proposals are kept so the
          distiller stops suggesting them.
        </p>
        {proposals.length === 0 && (
          <p className="text-sm text-zinc-500">Nothing waiting. Proposals appear after runs complete.</p>
        )}
        <div className="space-y-4">
          {proposals.map((item) => (
            <form
              key={item.id}
              action={decideKnowledgeAction}
              className="rounded border border-zinc-800 p-4"
            >
              <input type="hidden" name="knowledgeItemId" value={item.id} />
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-zinc-300">
                  {item.kind}
                </span>
                {item.sourceRunId && (
                  <Link href={`/runs/${item.sourceRunId}`} className="text-zinc-500 underline">
                    from run {item.sourceRunId.slice(-8)}
                  </Link>
                )}
              </div>
              <input
                name="editedTitle"
                defaultValue={item.title}
                className={`${inputCls} mb-2 w-full font-medium`}
              />
              <textarea
                name="editedContent"
                defaultValue={item.content}
                rows={3}
                className={`${inputCls} mb-2 w-full`}
              />
              {item.scopeTags?.length > 0 && (
                <p className="mb-3 text-xs text-zinc-600">
                  Evidence: {item.scopeTags.join(' · ')}
                </p>
              )}
              <div className="flex gap-3">
                <button type="submit" name="decision" value="approved" className={buttonCls}>
                  Approve
                </button>
                <button type="submit" name="decision" value="rejected" className={buttonDangerCls}>
                  Reject
                </button>
              </div>
            </form>
          ))}
        </div>
      </Section>
    </main>
  );
}
