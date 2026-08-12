'use client';

import { useState, type ReactNode } from 'react';
import { capHunkLines, groupHunkLines } from '@/lib/diff-view-model';
import type { DiffFile, DiffLine } from '@/lib/unified-diff';

const focus =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';

function DiffRow({ line }: { line: DiffLine }) {
  const changed = line.kind === 'addition' || line.kind === 'deletion';
  const prefix = line.kind === 'addition' ? '+' : '−';
  const status = line.kind === 'addition' ? 'added' : 'deleted';

  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-line-number" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line-number" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      {changed && (
        <>
          <span className="diff-line-status" aria-hidden="true">
            {status}
          </span>
          <span className="diff-prefix" aria-hidden="true">
            {prefix}
          </span>
        </>
      )}
      <code>{line.content || ' '}</code>
    </div>
  );
}

function RevealLines({ count, children }: { count: number; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  if (visible) return <>{children}</>;
  return (
    <button
      type="button"
      className={`diff-reveal ${focus}`}
      onClick={() => setVisible(true)}
      aria-label={`Show remaining ${count} unchanged lines`}
    >
      Show remaining lines <span aria-hidden="true">({count})</span>
    </button>
  );
}

function FileContent({ file }: { file: DiffFile }) {
  const [showAll, setShowAll] = useState(false);
  const capped = capHunkLines(file.hunks);
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
      {hunks.map((hunk, hunkIndex) => (
        <div key={`${hunk.header}-${hunkIndex}`}>
          <p className="diff-hunk">{hunk.header}</p>
          {(showAll ? [{ kind: 'visible' as const, lines: hunk.lines }] : groupHunkLines(hunk)).map(
            (group, groupIndex) =>
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
      {!showAll && capped.remaining > 0 && (
        <button
          type="button"
          className={`diff-reveal ${focus}`}
          onClick={() => setShowAll(true)}
          aria-label={`Show remaining ${capped.remaining} lines in ${file.path}`}
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

export function DiffViewer({ files }: { files: DiffFile[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(files.length <= 3 ? files.map((file) => file.id) : []),
  );

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
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(id)?.scrollIntoView({
          block: 'start',
          behavior: reducedMotion ? 'auto' : 'smooth',
        });
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
                <span className="diff-disclosure" aria-hidden="true">
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
          return (
            <article key={file.id} id={file.id} className="diff-file">
              <button
                type="button"
                className={`diff-file-header ${focus}`}
                aria-expanded={open}
                aria-controls={`${file.id}-content`}
                onClick={() => toggle(file.id)}
              >
                <span className="diff-disclosure" aria-hidden="true">
                  {open ? '−' : '+'}
                </span>
                <span className="diff-file-path">{file.path}</span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts">
                  <span aria-label={`${file.additions} additions`}>+{file.additions}</span>
                  <span aria-label={`${file.deletions} deletions`}>−{file.deletions}</span>
                </span>
              </button>
              <div id={`${file.id}-content`} hidden={!open}>
                {open && <FileContent file={file} />}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
