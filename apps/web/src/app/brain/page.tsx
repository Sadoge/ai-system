import { apiGet } from '@/lib/api';
import { System, buttonCls, inputCls } from '@/lib/ui';

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

function Fact({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={`border-l pl-2 font-mono text-xs ${
        warn ? 'border-hold text-hold-bright' : 'border-rule-strong text-ink-muted'
      }`}
    >
      {children}
    </span>
  );
}

function Retrieved({
  score,
  title,
  content,
}: {
  score: number;
  title: string;
  content: string;
}) {
  return (
    <li className="border-b border-rule py-3">
      <div className="flex items-baseline gap-3">
        <span className="shrink-0 font-mono text-xs text-ink-faint tnum">{score.toFixed(3)}</span>
        <span className="min-w-0 flex-1 text-sm text-ink">{title}</span>
      </div>
      <p className="mt-1 pl-12 text-sm leading-relaxed text-ink-muted">{content}</p>
    </li>
  );
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
      <System mark="A" title="Read the part">
        <p className="annot mb-5 max-w-3xl text-sm leading-relaxed text-ink-label">
          Shows exactly what the Context Assembler would put in an agent&apos;s prompt for a given
          task, and what it dropped to fit the token budget. Approved rules are always included and
          are never trimmed — only ranked material is.
        </p>
        <form className="flex flex-wrap items-end gap-3">
          <input
            name="query"
            defaultValue={query ?? ''}
            placeholder="Describe a task, e.g. add a median helper to the calculator"
            className={`${inputCls} min-w-64 flex-1`}
          />
          <button type="submit" className={buttonCls}>
            Inspect
          </button>
        </form>
      </System>

      {inspection && (
        <>
          <System mark="B" title="Selection">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Fact>repo index: {inspection.hasIndex ? 'yes' : 'none'}</Fact>
              <Fact>
                embeddings: {inspection.embedderAvailable ? 'available' : 'unavailable'}
              </Fact>
              <Fact>keywords: {inspection.keywords.join(', ') || '(none)'}</Fact>
              {inspection.trimmed.map((t) => (
                <Fact key={t.section} warn>
                  trimmed {t.dropped} from {t.section}
                </Fact>
              ))}
            </div>
          </System>

          <System mark="C" title="Always included" aside={`${inspection.rules.length}`}>
            {inspection.rules.length === 0 ? (
              <p className="annot py-3 text-sm text-ink-label">
                No approved rules for this project yet.
              </p>
            ) : (
              <ul className="border-t border-rule">
                {inspection.rules.map((r) => (
                  <li key={r.id} className="border-b border-rule py-3">
                    <div className="flex items-baseline gap-3">
                      <span className="shrink-0 font-mono text-xs text-cue-bright">{r.kind}</span>
                      <span className="min-w-0 flex-1 text-sm text-ink">{r.title}</span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{r.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </System>

          <System
            mark="D"
            title="Structural matches"
            aside={`${inspection.relevantFiles.length}`}
          >
            {inspection.relevantFiles.length === 0 ? (
              <p className="annot py-3 text-sm text-ink-label">No files matched the keywords.</p>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {inspection.relevantFiles.map((f) => (
                  <li key={f.path} className="text-ink-secondary">
                    {f.path}
                    {f.exports.length > 0 && (
                      <span className="text-ink-faint"> — {f.exports.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </System>

          <System mark="E" title="Semantic hits" aside={`${inspection.related.length}`}>
            {inspection.related.length === 0 ? (
              <p className="annot py-3 text-sm text-ink-label">Nothing retrieved.</p>
            ) : (
              <ul className="border-t border-rule">
                {inspection.related.map((h, i) => (
                  <Retrieved key={i} score={h.score} title={h.title} content={h.content} />
                ))}
              </ul>
            )}
          </System>

          <System mark="F" title="Episodic memory" aside={`${inspection.episodes.length}`}>
            {inspection.episodes.length === 0 ? (
              <p className="annot py-3 text-sm text-ink-label">No comparable past work yet.</p>
            ) : (
              <ul className="border-t border-rule">
                {inspection.episodes.map((h, i) => (
                  <Retrieved key={i} score={h.score} title={h.title} content={h.content} />
                ))}
              </ul>
            )}
          </System>
        </>
      )}
    </main>
  );
}
