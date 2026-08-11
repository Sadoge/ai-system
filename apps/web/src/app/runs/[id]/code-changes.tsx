'use client';

import Link from 'next/link';
import { useState } from 'react';
import { capHunks, groupHunkLines } from '@/lib/diff-view-model';
import type { DiffArtifactContent } from '@/lib/diff-artifact';
import { parseUnifiedDiff, type DiffFile, type DiffHunk, type DiffLine } from '@/lib/unified-diff';
import { System, linkCls } from '@/lib/ui';
import { DiffViewer, RevealLines } from './diff-viewer';

interface CodeChangesProps {
  runId: string;
  artifactId?: string;
  content: DiffArtifactContent | null;
  error?: string | null;
  loading?: boolean;
}

function DiffRow({ line }: { line: DiffLine }) {
  const prefix = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' ';
  const status = line.kind === 'addition' ? 'added' : line.kind === 'deletion' ? 'deleted' : '';
  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-line-number" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line-number" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line-status" aria-hidden={!status}>
        {status}
      </span>
      <code>
        <span className="diff-prefix" aria-hidden>
          {prefix}
        </span>
        {line.content || ' '}
      </code>
    </div>
  );
}

function DiffHunks({ hunks }: { hunks: readonly DiffHunk[] }) {
  return hunks.map((hunk, hunkIndex) => (
    <div key={`${hunk.header}-${hunkIndex}`}>
      <p className="diff-hunk">{hunk.header}</p>
      {groupHunkLines(hunk).map((group, groupIndex) =>
        group.kind === 'collapsed' ? (
          <RevealLines key={groupIndex} count={group.lines.length}>
            {group.lines.map((line, lineIndex) => (
              <DiffRow key={`${groupIndex}-${lineIndex}`} line={line} />
            ))}
          </RevealLines>
        ) : (
          group.lines.map((line, lineIndex) => (
            <DiffRow key={`${groupIndex}-${lineIndex}`} line={line} />
          ))
        ),
      )}
    </div>
  ));
}

function FilePatch({ file }: { file: DiffFile }) {
  const [showAll, setShowAll] = useState(false);
  const capped = capHunks(file.hunks);
  const hunks = showAll ? file.hunks : capped.hunks;

  return (
    <div className="diff-code" role="region" aria-label={`${file.path} patch`}>
      {file.metadata.length > 0 && (
        <div className="diff-file-metadata">
          {file.metadata.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      )}
      <DiffHunks hunks={hunks} />
      {!showAll && capped.remaining > 0 && (
        <button
          type="button"
          className="diff-reveal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright"
          onClick={() => setShowAll(true)}
        >
          Show remaining {capped.remaining} lines
        </button>
      )}
      {file.status === 'binary' && file.metadata.length === 0 && (
        <p className="diff-file-metadata">Binary file changed.</p>
      )}
    </div>
  );
}

export function DiffPresentation({ runId, artifactId, content, error, loading }: CodeChangesProps) {
  if (error) {
    return (
      <div className="diff-state diff-state-error" role="alert">
        <p className="annot text-sm text-mark-bright">The code changes could not be loaded.</p>
        <p className="mt-1 text-sm text-ink-muted">{error}</p>
      </div>
    );
  }

  if (loading) {
    return <p className="diff-state annot text-sm text-ink-label">Loading code changes…</p>;
  }

  if (!artifactId || !content) {
    return (
      <p className="diff-state annot text-sm text-ink-label">
        No code-change artifact has been written for this run yet.
      </p>
    );
  }

  const parsed = parseUnifiedDiff(content.diff);
  if (parsed.files.length === 0) {
    if (content.diff.trim()) {
      return (
        <div className="diff-state diff-state-unparseable">
          <p className="annot text-sm text-mark-bright" role="alert">
            This content could not be parsed as a unified diff. The stored content is shown below.
          </p>
          <pre className="diff-raw">{content.diff}</pre>
        </div>
      );
    }
    return (
      <div className="diff-state">
        <p className="annot text-sm text-ink-label">This artifact contains no file changes.</p>
        <Link
          href={`/runs/${runId}/artifacts/${artifactId}`}
          className={`${linkCls} mt-2 inline-block text-sm`}
        >
          Open artifact details
        </Link>
      </div>
    );
  }

  const files = parsed.files.map(({ id, path, status, additions, deletions }) => ({
    id,
    path,
    status,
    additions,
    deletions,
  }));

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
        <Link href={`/runs/${runId}/artifacts/${artifactId}`} className={`${linkCls} text-sm`}>
          Open artifact details
        </Link>
      </div>

      <DiffViewer files={files}>
        {parsed.files.map((file) => (
          <FilePatch key={file.id} file={file} />
        ))}
      </DiffViewer>
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
