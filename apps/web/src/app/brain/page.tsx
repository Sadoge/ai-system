import { apiGet } from '@/lib/api';
import { Section, inputCls, buttonCls } from '@/lib/ui';

interface Inspection {
  query: string;
  keywords: string[];
  hasIndex: boolean;
  embedderAvailable: boolean;
  fileMap: string;
  relevantFiles: { path: string; exports: string[] }[];
  rules: { id: string; kind: string; title: string; content: string }[];
  related: { title: string; content: string; score: number }[];
  episodes: { title: string; content: string; score: number }[];
  trimmed: { section: string; dropped: number }[];
}

export default async function BrainInspectorPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>;
}) {
  const { query } = await searchParams;
  const inspection = query
    ? await apiGet<Inspection>(`/brain/inspect?query=${encodeURIComponent(query)}`)
    : null;

  return (
    <main>
      <Section title="Brain inspector">
        <p className="mb-3 text-xs text-zinc-600">
          Shows exactly what the Context Assembler would put in an agent&apos;s prompt for a given
          task, and what it dropped to fit the token budget. Approved rules are always included and
          are never trimmed — only ranked material is.
        </p>
        <form className="flex gap-3">
          <input
            name="query"
            defaultValue={query ?? ''}
            placeholder="Describe a task, e.g. add a median helper to the calculator"
            className={`${inputCls} flex-1`}
          />
          <button type="submit" className={buttonCls}>
            Inspect
          </button>
        </form>
      </Section>

      {inspection && (
        <>
          <Section title="Selection">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded border border-zinc-800 px-2 py-1">
                repo index: {inspection.hasIndex ? 'yes' : 'none'}
              </span>
              <span className="rounded border border-zinc-800 px-2 py-1">
                embeddings: {inspection.embedderAvailable ? 'available' : 'unavailable'}
              </span>
              <span className="rounded border border-zinc-800 px-2 py-1">
                keywords: {inspection.keywords.join(', ') || '(none)'}
              </span>
              {inspection.trimmed.map((t) => (
                <span key={t.section} className="rounded border border-amber-800 px-2 py-1 text-amber-300">
                  trimmed {t.dropped} from {t.section}
                </span>
              ))}
            </div>
          </Section>

          <Section title={`Rules always included (${inspection.rules.length})`}>
            <ul className="space-y-1 text-sm">
              {inspection.rules.map((r) => (
                <li key={r.id} className="rounded border border-zinc-800 px-3 py-2">
                  <span className="font-mono text-xs text-emerald-400">{r.kind}</span>{' '}
                  <span className="font-medium">{r.title}</span>
                  <p className="text-zinc-400">{r.content}</p>
                </li>
              ))}
              {inspection.rules.length === 0 && (
                <li className="text-sm text-zinc-500">No approved rules for this project yet.</li>
              )}
            </ul>
          </Section>

          <Section title={`Structural matches (${inspection.relevantFiles.length})`}>
            <ul className="space-y-1 font-mono text-xs">
              {inspection.relevantFiles.map((f) => (
                <li key={f.path} className="text-zinc-300">
                  {f.path}
                  {f.exports.length > 0 && (
                    <span className="text-zinc-600"> — {f.exports.join(', ')}</span>
                  )}
                </li>
              ))}
              {inspection.relevantFiles.length === 0 && (
                <li className="text-zinc-500">No files matched the keywords.</li>
              )}
            </ul>
          </Section>

          <Section title={`Semantic hits (${inspection.related.length})`}>
            <ul className="space-y-1 text-sm">
              {inspection.related.map((h, i) => (
                <li key={i} className="rounded border border-zinc-800 px-3 py-2">
                  <span className="font-mono text-xs text-zinc-500">{h.score.toFixed(3)}</span>{' '}
                  <span className="font-medium">{h.title}</span>
                  <p className="text-zinc-400">{h.content}</p>
                </li>
              ))}
              {inspection.related.length === 0 && (
                <li className="text-sm text-zinc-500">Nothing retrieved.</li>
              )}
            </ul>
          </Section>

          <Section title={`Episodic memory (${inspection.episodes.length})`}>
            <ul className="space-y-1 text-sm">
              {inspection.episodes.map((h, i) => (
                <li key={i} className="rounded border border-zinc-800 px-3 py-2">
                  <span className="font-mono text-xs text-zinc-500">{h.score.toFixed(3)}</span>{' '}
                  <span className="font-medium">{h.title}</span>
                  <p className="text-zinc-400">{h.content}</p>
                </li>
              ))}
              {inspection.episodes.length === 0 && (
                <li className="text-sm text-zinc-500">No comparable past work yet.</li>
              )}
            </ul>
          </Section>
        </>
      )}
    </main>
  );
}
