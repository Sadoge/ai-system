'use client';

import { useState } from 'react';
import { LARGE_FILE_LINE_LIMIT, groupHunkLines, sliceFileHunks } from '@/lib/diff-view-model';
import type { DiffFile, DiffLine } from '@/lib/unified-diff';

const focus =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';

function DiffRow({ line }: { line: DiffLine }) {
  const prefix = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' ';
  const status = line.kind === 'addition' ? 'added' : line.kind === 'deletion' ? 'deleted' : '';

  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-line-number" aria-hidden>
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line-number" aria-hidden>
        {line.newLine ?? ''}
      </span>
      <span className="diff-line-status" aria-hidden>
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

function RevealLines({ count, children }: { count: number; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  if (visible) return <>{children}</>;
  return (
    <button
      type="button"
      className={`diff-reveal ${focus}`}
      onClick={() => setVisible(true)}
      aria-label={`Show remaining ${count} unchanged lines`}
    >
      Show remaining lines <span aria-hidden>({count})</span>
    </button>
  );
}

function DiffFileContent({ file, revealAll }: { file: DiffFile; revealAll: boolean }) {
  const visible = sliceFileHunks(
    file.hunks,
    revealAll ? Number.POSITIVE_INFINITY : LARGE_FILE_LINE_LIMIT,
  );

  return (
    <div className="diff-code" role="region" aria-label={`${file.path} patch`}>
      {file.metadata.length > 0 && (
        <div className="diff-file-metadata">
          {file.metadata.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      )}
      {visible.hunks.map((hunk, hunkIndex) => (
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
      ))}
      {file.status === 'binary' && file.metadata.length === 0 && (
        <p className="diff-file-metadata">Binary file changed.</p>
      )}
    </div>
  );
}

export function DiffViewer({ files }: { files: DiffFile[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(files.length <= 3 ? files.map((file) => file.id) : []),
  );
  const [fullyRevealed, setFullyRevealed] = useState<Set<string>>(() => new Set());

  const setAll = (open: boolean) => {
    setExpanded(new Set(open ? files.map((file) => file.id) : []));
  };

  const toggle = (id: string) => {
    const opening = !expanded.has(id);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (opening) {
      requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document
          .getElementById(id)
          ?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
  };

  return (
    <div className="diff-viewer">
      <div className="diff-actions">
        <button type="button" className={`diff-action ${focus}`} onClick={() => setAll(true)}>
          Expand all
        </button>
        <button type="button" className={`diff-action ${focus}`} onClick={() => setAll(false)}>
          Collapse all
        </button>
      </div>

      <ol className="diff-index" aria-label="Changed files">
        {files.map((file) => {
          const open = expanded.has(file.id);
          return (
            <li key={file.id}>
              <button
                type="button"
                className={`diff-index-row ${focus}`}
                aria-expanded={open}
                aria-controls={`${file.id}-content`}
                onClick={() => toggle(file.id)}
              >
                <span className="diff-disclosure" aria-hidden>
                  {open ? '−' : '+'}
                </span>
                <span className="diff-file-path">{file.path}</span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts">
                  <span aria-label={`${file.additions} additions`}>+{file.additions}</span>
                  <span aria-label={`${file.deletions} deletions`}>−{file.deletions}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="diff-files">
        {files.map((file) => {
          const open = expanded.has(file.id);
          const revealAll = fullyRevealed.has(file.id);
          const lineCount = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
          return (
            <article key={file.id} id={file.id} className="diff-file">
              <button
                type="button"
                className={`diff-file-header ${focus}`}
                aria-expanded={open}
                aria-controls={`${file.id}-content`}
                onClick={() => toggle(file.id)}
              >
                <span className="diff-disclosure" aria-hidden>
                  {open ? '−' : '+'}
                </span>
                <span className="diff-file-path">{file.path}</span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts">
                  +{file.additions} −{file.deletions}
                </span>
              </button>
              <div id={`${file.id}-content`}>
                {open && <DiffFileContent file={file} revealAll={revealAll} />}
                {open && !revealAll && lineCount > LARGE_FILE_LINE_LIMIT && (
                  <button
                    type="button"
                    className={`diff-reveal ${focus}`}
                    onClick={() => setFullyRevealed((current) => new Set(current).add(file.id))}
                  >
                    Show remaining {lineCount - LARGE_FILE_LINE_LIMIT} lines
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
