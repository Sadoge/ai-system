import Link from 'next/link';
import { changeBarSegments } from '@/lib/diff-view-model';
import { parseUnifiedDiff } from '@/lib/unified-diff';
import { System, linkCls } from '@/lib/ui';

/**
 * The artifact reference exposed by GET /runs/:id. The run response does not
 * currently include task, stage, or iteration attribution for artifacts.
 */
export interface DiffArtifactRef {
  id: string;
  kind: string;
  contentHash: string;
  createdAt: string;
}

export interface CodeChangesProps {
  runId: string;
  diffArtifacts: DiffArtifactRef[];
  patches: Record<string, string>;
  error?: string | null;
  baseBranch?: string | null;
  workingBranch?: string | null;
}

const FILE_LIMIT = 20;

interface FileSummary {
  oldPath: string;
  newPath: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

interface DiffSummary {
  files: FileSummary[];
  additions: number;
  deletions: number;
}

interface ChangeBarSegment {
  kind: string;
  percentage: number;
}

const statusLabel = (status: string) => status.replaceAll('_', ' ');

export function CodeChanges({
  runId,
  diffArtifacts,
  patches,
  error = null,
  baseBranch = null,
  workingBranch = null,
}: CodeChangesProps) {
  const artifacts = diffArtifacts ?? [];
  const patchByArtifact = patches ?? {};
  const primaryArtifact = artifacts.at(-1);
  const primaryPatch = primaryArtifact ? patchByArtifact[primaryArtifact.id] : undefined;
  const parsed =
    primaryPatch === undefined ? null : (parseUnifiedDiff(primaryPatch) as unknown as DiffSummary);
  const files = parsed?.files ?? [];
  const visibleFiles = files.slice(0, FILE_LIMIT);
  const hiddenFileCount = Math.max(0, files.length - visibleFiles.length);
  const additions = parsed?.additions ?? 0;
  const deletions = parsed?.deletions ?? 0;
  const segments = changeBarSegments(additions, deletions) as unknown as ChangeBarSegment[];
  const primaryHref = primaryArtifact
    ? `/runs/${runId}/artifacts/${primaryArtifact.id}`
    : undefined;

  return (
    <System mark="C" title="Code changes">
      {error ? (
        <p
          role="alert"
          className="diff-error border-l border-mark py-1 pl-4 text-sm text-mark-bright"
        >
          Code changes could not be loaded.
        </p>
      ) : artifacts.length === 0 ? (
        <p className="diff-empty annot py-4 text-sm text-ink-label">
          No code changes have been produced for this run yet.
        </p>
      ) : (
        <div className="diff-summary">
          {baseBranch && workingBranch && (
            <p className="mb-3 font-mono text-xs text-ink-faint">
              {baseBranch} <span aria-hidden>→</span> <span className="sr-only">to</span>{' '}
              {workingBranch}
            </p>
          )}

          {parsed && primaryHref && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-xs text-ink-secondary tnum">
                <span>{files.length} files changed</span>
                <span>+{additions} additions</span>
                <span>−{deletions} deletions</span>
              </div>

              <div
                className="diff-change-bar mt-3 flex h-2 w-full overflow-hidden bg-ground-band"
                role="img"
                aria-label={`${additions} additions and ${deletions} deletions`}
              >
                {segments.map((segment) => (
                  <span
                    key={segment.kind}
                    className={`diff-change-bar-${segment.kind}`}
                    style={{ width: `${segment.percentage}%` }}
                  />
                ))}
              </div>

              <ul className="diff-file-list mt-4 border-t border-rule">
                {visibleFiles.map((file) => (
                  <li key={`${file.oldPath}:${file.newPath}`} className="border-b border-rule">
                    <Link
                      href={primaryHref}
                      className="diff-file-row grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-3 py-2.5 hover:bg-ground-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright"
                    >
                      <span
                        className="diff-path truncate font-mono text-xs text-ink"
                        title={file.path}
                      >
                        {file.path}
                      </span>
                      <span className="diff-file-status text-xs text-ink-label">
                        {statusLabel(file.status)}
                      </span>
                      <span className="whitespace-nowrap font-mono text-xs text-ink-secondary tnum">
                        +{file.additions} / −{file.deletions}
                      </span>
                    </Link>
                  </li>
                ))}
                {hiddenFileCount > 0 && (
                  <li className="border-b border-rule px-3 py-2.5 font-mono text-xs text-ink-muted">
                    <Link href={primaryHref} className={linkCls}>
                      +{hiddenFileCount} more files
                    </Link>
                  </li>
                )}
              </ul>
            </>
          )}

          {artifacts.length > 1 && (
            <div className="mt-5">
              <p className="annot text-xs text-ink-label">Produced diff artifacts</p>
              <ul className="mt-1 border-t border-rule">
                {artifacts.map((artifact, index) => (
                  <li key={artifact.id} className="border-b border-rule">
                    <Link
                      href={`/runs/${runId}/artifacts/${artifact.id}`}
                      className="flex items-center gap-4 px-3 py-2.5 hover:bg-ground-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright"
                    >
                      <span className="font-mono text-xs text-cue-bright">
                        Diff {index + 1}
                        {artifact.id === primaryArtifact?.id ? ' · latest' : ''}
                      </span>
                      <span className="ml-auto font-mono text-xs text-ink-faint tnum">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {primaryHref && (
            <p className="mt-5">
              <Link href={primaryHref} className={`${linkCls} font-mono text-sm`}>
                View full diff artifact <span aria-hidden>→</span>
              </Link>
            </p>
          )}
        </div>
      )}
    </System>
  );
}
