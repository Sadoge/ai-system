import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { Section, SeverityBadge } from '@/lib/ui';

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

  return (
    <main>
      <Section title="Findings by category">
        {byCategory.length === 0 && <p className="text-sm text-zinc-500">No findings recorded yet.</p>}
        <div className="flex flex-wrap gap-2">
          {byCategory.map((row) => (
            <span key={row.category} className="rounded border border-zinc-800 px-3 py-1 text-sm">
              {row.category}
              <span className="ml-2 font-mono text-xs text-zinc-500">{row.count}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          A category that keeps recurring is the signal the learning loop watches for — it usually
          means a convention is missing from the Project Brain.
        </p>
      </Section>

      <Section title={`Findings (${open.length} open of ${findings.length})`}>
        <ul className="space-y-2">
          {findings.map((f) => (
            <li key={f.id} className="rounded border border-zinc-800 px-4 py-2 text-sm">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={f.severity} />
                <span className="font-medium">{f.title}</span>
                <span className="font-mono text-xs text-zinc-500">{f.category}</span>
                <span className="ml-auto font-mono text-xs text-zinc-500">{f.status}</span>
              </div>
              <p className="mt-1 text-zinc-400">{f.detail}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {f.filePath && <span className="mr-2 font-mono">{f.filePath}</span>}
                <Link href={`/runs/${f.runId}`} className="underline">
                  {f.ticket?.title ?? f.runId.slice(-8)}
                </Link>
              </p>
            </li>
          ))}
          {findings.length === 0 && (
            <li className="text-sm text-zinc-500">Nothing yet — findings appear after a review stage runs.</li>
          )}
        </ul>
      </Section>
    </main>
  );
}
