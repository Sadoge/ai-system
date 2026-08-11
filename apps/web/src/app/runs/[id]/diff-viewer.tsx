'use client';

import { Children, useState, type ReactNode } from 'react';

export interface DiffFileIndex {
  id: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

const focus =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';

export function DiffViewer({ files, children }: { files: DiffFileIndex[]; children: ReactNode }) {
  const fileContents = Children.toArray(children);
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
        {files.map((file, index) => {
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
                <span className="diff-disclosure" aria-hidden>
                  {open ? '−' : '+'}
                </span>
                <span className="diff-file-path">{file.path}</span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts">
                  +{file.additions} −{file.deletions}
                </span>
              </button>
              <div id={`${file.id}-content`} hidden={!open}>
                {open ? fileContents[index] : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function RevealLines({ count, children }: { count: number; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  if (visible) return <>{children}</>;
  return (
    <button
      type="button"
      className={`diff-reveal ${focus}`}
      onClick={() => setVisible(true)}
      aria-label={`Show remaining ${count} lines`}
    >
      Show remaining {count} lines
    </button>
  );
}
