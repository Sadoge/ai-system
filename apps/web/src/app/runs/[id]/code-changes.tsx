import Link from 'next/link';
import type { DiffArtifactContent } from '@/lib/diff-artifact';
import { parseUnifiedDiff } from '@/lib/unified-diff';
import { System, linkCls } from '@/lib/ui';
import { DiffViewer } from './diff-viewer';

interface CodeChangesProps {
  runId: string;
  artifactId?: string;
  content: DiffArtifactContent | null;
  error?: string | null;
  showArtifactLink?: boolean;
}

export function DiffPresentation({
  runId,
  artifactId,
  content,
  error,
  showArtifactLink = true,
}: CodeChangesProps) {
  if (error) {
    return (
      <div className="diff-state diff-state-error" role="alert">
        <p className="annot text-sm text-mark-bright">The code changes could not be loaded.</p>
        <p className="mt-1 text-sm text-ink-muted">{error}</p>
      </div>
    );
  }

  if (!artifactId || !content) {
    return (
      <p className="diff-state annot text-sm text-ink-label">
        No code-change artifact has been written for this run yet.
      </p>
    );
  }

  const parsed = parseUnifiedDiff(content.diff);
  if (!content.diff.trim()) {
    return (
      <div className="diff-state">
        <p className="annot text-sm text-ink-label">This artifact contains no file changes.</p>
        {showArtifactLink && (
          <Link
            href={`/runs/${runId}/artifacts/${artifactId}`}
            className={`${linkCls} mt-2 inline-block text-sm`}
          >
            Open artifact details
          </Link>
        )}
      </div>
    );
  }

  if (!parsed.valid || parsed.files.length === 0) {
    return (
      <div className="diff-state diff-state-error" role="alert">
        <p className="annot text-sm text-mark-bright">
          This content could not be parsed as a complete unified diff. The stored patch is shown
          below.
        </p>
        <pre className="diff-raw">{content.diff}</pre>
      </div>
    );
  }

  return (
    <>
      <div className="diff-summary">
        <p className="font-mono text-sm text-ink-secondary tnum">
          {parsed.files.length} {parsed.files.length === 1 ? 'file' : 'files'} changed
          <span className="ml-3">+{parsed.additions}</span>
          <span className="ml-2">−{parsed.deletions}</span>
        </p>
        <dl className="diff-metadata">
          {content.baseBranch && (
            <div>
              <dt>base</dt>
              <dd>{content.baseBranch}</dd>
            </div>
          )}
          {content.branch && (
            <div>
              <dt>working</dt>
              <dd>{content.branch}</dd>
            </div>
          )}
          {content.task && (
            <div>
              <dt>task</dt>
              <dd>{content.task}</dd>
            </div>
          )}
          {content.stage && (
            <div>
              <dt>stage</dt>
              <dd>{content.stage}</dd>
            </div>
          )}
          {content.iteration !== undefined && (
            <div>
              <dt>iteration</dt>
              <dd>{content.iteration}</dd>
            </div>
          )}
        </dl>
        {showArtifactLink && (
          <Link href={`/runs/${runId}/artifacts/${artifactId}`} className={`${linkCls} text-sm`}>
            Open artifact details
          </Link>
        )}
      </div>

      <DiffViewer key={artifactId} patch={content.diff} />
    </>
  );
}

export function CodeChanges(props: CodeChangesProps) {
  return (
    <System mark="Δ" title="Code changes">
      <DiffPresentation {...props} />
    </System>
  );
}
