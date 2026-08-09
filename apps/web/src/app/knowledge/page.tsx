import { apiGet, type KnowledgeRow } from '@/lib/api';
import { addKnowledgeAction } from '@/lib/actions';
import { Section, buttonCls, inputCls } from '@/lib/ui';

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
      <Section title="Add knowledge">
        <form action={addKnowledgeAction} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Kind</label>
            <select name="kind" className={inputCls}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Title</label>
            <input name="title" required className={inputCls} />
          </div>
          <div className="flex min-w-72 flex-1 flex-col gap-1">
            <label className="text-xs text-zinc-500">Content</label>
            <input name="content" required className={inputCls} />
          </div>
          <button type="submit" className={buttonCls}>
            Add
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-600">
          Manual knowledge is approved immediately — you are the human in the loop. Learned
          proposals (Phase 2) will queue here for approval instead.
        </p>
      </Section>

      <Section title={`Knowledge base (${items.length})`}>
        <div className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {items.map((item) => (
            <div key={item.id} className="px-4 py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
                  {item.kind}
                </span>
                <span className="font-medium">{item.title}</span>
                <span className="ml-auto font-mono text-xs text-zinc-600">
                  {item.origin} · {item.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-400">{item.content}</p>
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-4 py-6 text-sm text-zinc-500">No knowledge yet.</p>
          )}
        </div>
      </Section>
    </main>
  );
}
