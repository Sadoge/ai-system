import Link from 'next/link';
import { groupHunkLines } from '@/lib/diff-view-model';
import type { DiffArtifactContent } from '@/lib/diff-artifact';
import { parseUnifiedDiff, type DiffLine } from '@/lib/unified-diff';
import { System, linkCls } from '@/lib/ui';
import { DiffViewer, RevealLines } from './diff-viewer';

const LARGE_FILE_LINE_LIMIT = 400;

interface CodeChangesProps {
  runId: string;
  artifactId?: string;
  content: DiffArtifactContent | null;
  error?: string | null;
  showArtifactLink?: boolean;
}

function DiffRow({ line }: { line: DiffLine }) {
  const prefix = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' ';
  const status = line.kind === 'addition' ? 'added' : line.kind === 'deletion' ? 'deleted' : '';
  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-line-number" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line-number" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line-status">{status}</span>
      <span className="diff-prefix" aria-hidden="true">
        {prefix}
      </span>
      <code>{line.content || ' '}</code>
    </div>
  );
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
  if (parsed.state === 'empty') {
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

  if (parsed.state === 'unparseable') {
    return (
      <div className="diff-state">
        <p className="annot text-sm text-ink-label">
          This artifact could not be parsed as a unified diff. The stored content is shown below.
        </p>
        <pre
          className="diff-raw mt-3"
          role="region"
          aria-label="Unparsed diff content"
          tabIndex={0}
        >
          {content.diff}
        </pre>
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
        {showArtifactLink && (
          <Link href={`/runs/${runId}/artifacts/${artifactId}`} className={`${linkCls} text-sm`}>
            Open artifact details
          </Link>
        )}
      </div>

      <DiffViewer files={files}>
        {parsed.files.map((file) => {
          let renderedLineCount = 0;
          return (
            <div
              key={file.id}
              className="diff-code"
              role="region"
              aria-label={`${file.path} patch`}
            >
              {file.metadata.length > 0 && (
                <div className="diff-file-metadata">
                  {file.metadata.map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
                </div>
              )}
              {file.hunks.map((hunk, hunkIndex) => {
                const available = Math.max(0, LARGE_FILE_LINE_LIMIT - renderedLineCount);
                const visibleLines = hunk.lines.slice(0, available);
                const remainingLines = hunk.lines.slice(visibleLines.length);
                renderedLineCount += visibleLines.length;
                return (
                  <div key={`${hunk.header}-${hunkIndex}`}>
                    <p className="diff-hunk">{hunk.header}</p>
                    {groupHunkLines({ ...hunk, lines: visibleLines }).map((group, groupIndex) =>
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
                    {remainingLines.length > 0 && (
                      <RevealLines count={remainingLines.length}>
                        {remainingLines.map((line, lineIndex) => (
                          <DiffRow key={`remaining-${lineIndex}`} line={line} />
                        ))}
                      </RevealLines>
                    )}
                  </div>
                );
              })}
              {file.status === 'binary' && file.metadata.length === 0 && (
                <p className="diff-file-metadata">Binary file changed.</p>
              )}
            </div>
          );
        })}
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
