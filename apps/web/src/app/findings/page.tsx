import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { SeverityMark, System, linkCls } from '@/lib/ui';

interface FindingsResponse {
  findings: {
    id: string;
    runId: string;
    severity: string;
    category: string;
    title: string;
    detail: string;
    filePath: string | null;
    status: string;
    createdAt: string;
    ticket: { title?: string };
  }[];
  byCategory: { category: string; count: number }[];
}

export default async function FindingsPage() {
  const { findings, byCategory } = await apiGet<FindingsResponse>('/findings');
  const open = findings.filter((f) => f.status === 'open');
  const maxCount = Math.max(0, ...byCategory.map((r) => r.count));

  return (
    <main>
      <System mark="A" title="Recurring marks">
        {byCategory.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {byCategory.map((row) => (
              <li key={row.category} className="flex items-center gap-4">
                <span className="w-44 shrink-0 truncate font-mono text-xs text-ink-muted">
                  {row.category}
                </span>
                <span className="h-2 flex-1 bg-ground-band">
                  <span
                    className="block h-2 bg-mark-deep"
                    style={{ width: `${maxCount > 0 ? Math.max(2, (row.count / maxCount) * 100) : 0}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-xs text-ink-muted tnum">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="annot mt-4 max-w-2xl text-sm leading-relaxed text-ink-label">
          A category that keeps recurring is the signal the learning loop watches for — it usually
          means a convention is missing from the Project Brain.
        </p>
      </System>

      <System
        mark="B"
        title="The margin"
        aside={`${open.length} open of ${findings.length}`}
      >
        {findings.length === 0 ? (
          <p className="annot py-4 text-sm text-ink-label">
            Nothing yet — marks appear after a review stage runs.
          </p>
        ) : (
          <ul className="space-y-6">
            {findings.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 border-l border-rule pl-4 sm:flex-row sm:gap-4">
                <div className="shrink-0 pt-0.5 sm:w-28">
                  <SeverityMark severity={f.severity} />
                  <p className="mt-1 font-mono text-micro text-ink-faint">{f.status}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    {f.title}
                    <span className="ml-2 font-mono text-xs text-ink-faint">{f.category}</span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{f.detail}</p>
                  <p className="mt-1.5 text-xs text-ink-faint">
                    {f.filePath && <span className="mr-2 font-mono">{f.filePath}</span>}
                    <Link href={`/runs/${f.runId}`} className={linkCls}>
                      {f.ticket?.title ?? f.runId.slice(-8)}
                    </Link>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </System>
    </main>
  );
}
