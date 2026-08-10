import Link from 'next/link';
import { apiGet, type KnowledgeRow } from '@/lib/api';
import { decideKnowledgeAction } from '@/lib/actions';
import { Fermata, System, buttonCls, buttonDangerCls, inputCls, linkCls } from '@/lib/ui';

interface ProposalRow extends KnowledgeRow {
  scopeTags: string[];
  sourceRunId: string | null;
}

export default async function KnowledgeInboxPage() {
  const proposals = await apiGet<ProposalRow[]>('/knowledge?status=proposed');

  return (
    <main>
      <System mark="A" title="Proposed" aside={`${proposals.length}`}>
        <p className="annot mb-6 max-w-3xl text-sm leading-relaxed text-ink-label">
          Learned knowledge stays invisible to agents until you approve it. Editing before approval
          is encouraged — your version becomes canonical. Rejected proposals are kept so the
          distiller stops suggesting them.
        </p>

        {proposals.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            Nothing waiting. Proposals appear after runs complete.
          </p>
        ) : (
          <div className="space-y-6">
            {proposals.map((item) => (
              <form
                key={item.id}
                action={decideKnowledgeAction}
                className="border-l-2 border-mark pl-4"
              >
                <input type="hidden" name="knowledgeItemId" value={item.id} />
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Fermata className="shrink-0 text-mark" />
                  <span className="font-mono text-xs text-mark-bright">{item.kind}</span>
                  {item.sourceRunId && (
                    <Link href={`/runs/${item.sourceRunId}`} className={`${linkCls} text-xs`}>
                      from run {item.sourceRunId.slice(-8)}
                    </Link>
                  )}
                </div>
                <label className="block">
                  <span className="annot text-xs text-ink-label">Title</span>
                  <input
                    name="editedTitle"
                    defaultValue={item.title}
                    className={`${inputCls} mt-1 w-full`}
                  />
                </label>
                <label className="mt-3 block">
                  <span className="annot text-xs text-ink-label">Content</span>
                  <textarea
                    name="editedContent"
                    defaultValue={item.content}
                    rows={3}
                    className={`${inputCls} mt-1 w-full resize-y`}
                  />
                </label>
                {item.scopeTags?.length > 0 && (
                  <p className="annot mt-3 text-xs text-ink-faint">
                    Evidence: {item.scopeTags.join(' · ')}
                  </p>
                )}
                <div className="mt-4 flex gap-3">
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
        )}
      </System>
    </main>
  );
}
