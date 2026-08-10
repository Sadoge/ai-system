import { apiGet, type KnowledgeRow } from '@/lib/api';
import { addKnowledgeAction } from '@/lib/actions';
import { System, buttonCls, inputCls } from '@/lib/ui';

const KINDS = [
  'architecture_rule',
  'convention',
  'adr',
  'pitfall',
  'pattern',
  'glossary',
  'business_rule',
];

export default async function KnowledgePage() {
  const items = await apiGet<KnowledgeRow[]>('/knowledge');

  return (
    <main>
      <System mark="A" title="Set a rule">
        <form action={addKnowledgeAction} className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Kind</span>
            <select name="kind" className={inputCls}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="annot text-xs text-ink-label">Title</span>
            <input name="title" required className={inputCls} />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            <span className="annot text-xs text-ink-label">Content</span>
            <input name="content" required className={inputCls} />
          </label>
          <button type="submit" className={buttonCls}>
            Add
          </button>
        </form>
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          Manual knowledge is approved immediately — you are the human in the loop. Learned
          proposals queue in the inbox for approval instead.
        </p>
      </System>

      <System mark="B" title="The canon" aside={`${items.length}`}>
        {items.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">Nothing set yet.</p>
        ) : (
          <ul className="border-t border-rule">
            {items.map((item) => (
              <li key={item.id} className="border-b border-rule px-1 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-cue-bright">{item.kind}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink">{item.title}</span>
                  <span className="font-mono text-xs text-ink-faint">
                    {item.origin} · {item.status}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.content}</p>
              </li>
            ))}
          </ul>
        )}
      </System>
    </main>
  );
}
