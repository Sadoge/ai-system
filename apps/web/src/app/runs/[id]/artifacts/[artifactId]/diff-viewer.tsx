'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseUnifiedDiff } from '@/lib/diff';
import {
  LARGE_FILE_LINE_LIMIT,
  changeBarSegments,
  fileAccessibleLabel,
  initialExpandedFiles,
  panelId,
  summaryAccessibleLabel,
} from '@/lib/diff-view';
import { Caesura, Hairpin, RehearsalMark, Stave, System, buttonCls } from '@/lib/ui';

interface DiffViewerProps {
  patch: string;
  baseBranch?: string | null;
  workingBranch?: string | null;
  label?: string | null;
}

interface DiffLineShape {
  content: string;
  kind?: string;
  type?: string;
  prefix?: string;
  oldLineNumber?: number | null;
  newLineNumber?: number | null;
  oldNumber?: number | null;
  newNumber?: number | null;
}

interface DiffHunkShape {
  id: string;
  header?: string;
  rawHeader?: string;
  section?: string | null;
  sectionHeading?: string | null;
  lines: DiffLineShape[];
}

interface DiffFileShape {
  id: string;
  path?: string;
  displayPath?: string;
  oldPath?: string | null;
  newPath?: string | null;
  status: string;
  additions: number;
  deletions: number;
  lineCount?: number;
  hunks: DiffHunkShape[];
}

interface ParsedDiffShape {
  files: DiffFileShape[];
  fileCount: number;
  additions: number;
  deletions: number;
}

function filePath(file: DiffFileShape): string {
  return file.path ?? file.displayPath ?? file.newPath ?? file.oldPath ?? 'unknown file';
}

function fileLineCount(file: DiffFileShape): number {
  return file.lineCount ?? file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

function lineKind(line: DiffLineShape): string {
  return line.kind ?? line.type ?? 'context';
}

function linePrefix(line: DiffLineShape): string {
  if (line.prefix === '+') return '+';
  if (line.prefix === '-') return '−';
  if (line.prefix === ' ') return ' ';
  const kind = lineKind(line);
  if (kind === 'addition' || kind === 'add') return '+';
  if (kind === 'deletion' || kind === 'remove') return '−';
  return ' ';
}

function lineNumber(primary: number | null | undefined, fallback: number | null | undefined) {
  return primary ?? fallback ?? '';
}

function hunkHeader(hunk: DiffHunkShape): string {
  const header = hunk.rawHeader ?? hunk.header ?? '';
  const closingMark = header.indexOf('@@', 2);
  return closingMark >= 0 ? header.slice(0, closingMark + 2) : header;
}

function hunkSection(hunk: DiffHunkShape): string | null {
  if (hunk.sectionHeading ?? hunk.section) return hunk.sectionHeading ?? hunk.section ?? null;
  const header = hunk.rawHeader ?? hunk.header ?? '';
  const closingMark = header.indexOf('@@', 2);
  const derived = closingMark >= 0 ? header.slice(closingMark + 2).trim() : '';
  return derived || null;
}

function normalizedSegments(value: unknown, additions: number, deletions: number) {
  const asNumber = (segment: unknown) => {
    if (typeof segment === 'string') return Number.parseFloat(segment) || 0;
    return Number(segment) || 0;
  };
  if (Array.isArray(value)) {
    return { additions: asNumber(value[0]), deletions: asNumber(value[1]) };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      additions: asNumber(
        record.additions ?? record.addition ?? record.additionPercent ?? record.additionsPercent,
      ),
      deletions: asNumber(
        record.deletions ?? record.deletion ?? record.deletionPercent ?? record.deletionsPercent,
      ),
    };
  }
  const total = additions + deletions;
  return total === 0
    ? { additions: 0, deletions: 0 }
    : { additions: (additions / total) * 100, deletions: (deletions / total) * 100 };
}

function segmentWidth(value: number): string {
  return `${Math.max(0, Math.min(100, value))}%`;
}

export function DiffViewer({ patch, baseBranch, workingBranch, label }: DiffViewerProps) {
  const parsed = useMemo(() => parseUnifiedDiff(patch) as unknown as ParsedDiffShape, [patch]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => initialExpandedFiles(parsed.files) as Set<string>,
  );
  const [fullyRevealed, setFullyRevealed] = useState<Set<string>>(() => new Set());
  const panelRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    setExpanded(initialExpandedFiles(parsed.files) as Set<string>);
    setFullyRevealed(new Set());
  }, [patch, parsed.files]);

  const segments = normalizedSegments(
    changeBarSegments(parsed.additions, parsed.deletions),
    parsed.additions,
    parsed.deletions,
  );
  const branchContext = baseBranch || workingBranch;

  function scrollToPanel(fileId: string) {
    requestAnimationFrame(() => {
      panelRefs.current.get(fileId)?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }

  function toggleFile(fileId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
    scrollToPanel(fileId);
  }

  if (parsed.fileCount === 0 && patch.trim()) {
    return (
      <System mark="Δ" title={label ?? 'Code changes'}>
        <Caesura>
          <p className="annot mb-3 text-sm text-ink-label">
            This content could not be parsed as a unified diff; the original patch is shown below.
          </p>
          <pre className="diff-fallback overflow-x-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed text-ink-secondary">
            {patch}
          </pre>
        </Caesura>
      </System>
    );
  }

  return (
    <System mark="Δ" title={label ?? 'Code changes'} aside={`${parsed.fileCount} files`}>
      <header className="diff-summary" aria-label={summaryAccessibleLabel(parsed as never)}>
        <Stave className="diff-summary-stave flex-wrap">
          <RehearsalMark>diff</RehearsalMark>
          {branchContext && (
            <span className="diff-branches min-w-0 font-mono text-xs text-ink-secondary">
              {baseBranch && (
                <span className="truncate" title={baseBranch}>
                  {baseBranch}
                </span>
              )}
              {baseBranch && workingBranch && <span aria-hidden="true"> → </span>}
              {workingBranch && (
                <span className="truncate" title={workingBranch}>
                  {workingBranch}
                </span>
              )}
            </span>
          )}
          <span className="diff-summary-counts ml-auto flex flex-wrap items-center gap-x-3 font-mono text-xs text-ink-muted tnum">
            <span>{parsed.fileCount} files changed</span>
            <span>+{parsed.additions} additions</span>
            <span>−{parsed.deletions} deletions</span>
          </span>
        </Stave>
        <div className="diff-change-bar" aria-hidden="true">
          <span
            className="diff-change-bar-additions"
            style={{ width: segmentWidth(segments.additions) }}
          />
          <span
            className="diff-change-bar-deletions"
            style={{ width: segmentWidth(segments.deletions) }}
          />
        </div>
      </header>

      {parsed.files.length > 1 && (
        <div className="diff-bulk-actions flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonCls}
            onClick={() => setExpanded(new Set(parsed.files.map((file) => file.id)))}
          >
            Expand all
          </button>
          <button type="button" className={buttonCls} onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        </div>
      )}

      <div className="diff-file-index">
        {parsed.files.map((file) => {
          const path = filePath(file);
          const toggleId = `${panelId(file.id)}-toggle`;
          return (
            <Stave key={file.id} className="diff-file-index-row">
              <Hairpin
                direction={expanded.has(file.id) ? 'dim' : 'cresc'}
                className="shrink-0 text-ink-label"
              />
              <button
                id={toggleId}
                type="button"
                className="diff-file-toggle"
                aria-expanded={expanded.has(file.id)}
                aria-controls={panelId(file.id)}
                aria-label={fileAccessibleLabel(file as never)}
                onClick={() => toggleFile(file.id)}
              >
                <span className="diff-file-path truncate" title={path}>
                  {path}
                </span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts tnum">
                  <span>+{file.additions}</span>
                  <span>−{file.deletions}</span>
                </span>
              </button>
            </Stave>
          );
        })}
      </div>

      <div className="diff-file-panels">
        {parsed.files.map((file) => {
          const path = filePath(file);
          const isExpanded = expanded.has(file.id);
          const isFullyRevealed = fullyRevealed.has(file.id);
          const totalLines = fileLineCount(file);
          let consumedLines = 0;

          return (
            <section
              key={file.id}
              id={panelId(file.id)}
              ref={(node) => {
                if (node) panelRefs.current.set(file.id, node);
                else panelRefs.current.delete(file.id);
              }}
              className="diff-file-panel"
              role="region"
              aria-labelledby={`${panelId(file.id)}-toggle`}
            >
              <header className="diff-file-panel-header">
                <span className="diff-file-path min-w-0 truncate" title={path}>
                  {path}
                </span>
                <span className="diff-file-status">{file.status}</span>
                <span className="diff-file-counts tnum">
                  <span>+{file.additions}</span>
                  <span>−{file.deletions}</span>
                </span>
              </header>

              {isExpanded && (
                <div className="diff-file-body">
                  {file.hunks.map((hunk) => {
                    const remaining = isFullyRevealed
                      ? hunk.lines.length
                      : Math.max(0, LARGE_FILE_LINE_LIMIT - consumedLines);
                    const visibleLines = hunk.lines.slice(0, remaining);
                    consumedLines += visibleLines.length;
                    if (visibleLines.length === 0 && !isFullyRevealed) return null;

                    return (
                      <section key={hunk.id} className="diff-hunk">
                        <header className="diff-hunk-header">
                          <span className="diff-hunk-range">{hunkHeader(hunk)}</span>
                          {hunkSection(hunk) && (
                            <span className="diff-hunk-section">{hunkSection(hunk)}</span>
                          )}
                        </header>
                        <div className="diff-lines">
                          {visibleLines.map((line, lineIndex) => (
                            <div
                              key={`${hunk.id}-${lineIndex}`}
                              className={`diff-line diff-line-${lineKind(line)}`}
                            >
                              <span className="diff-line-number" aria-hidden="true">
                                {lineNumber(line.oldLineNumber, line.oldNumber)}
                              </span>
                              <span className="diff-line-number" aria-hidden="true">
                                {lineNumber(line.newLineNumber, line.newNumber)}
                              </span>
                              <span className="diff-line-prefix">{linePrefix(line)}</span>
                              <code className="diff-line-code">{line.content}</code>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}

                  {!isFullyRevealed && totalLines > LARGE_FILE_LINE_LIMIT && (
                    <div className="diff-show-remaining">
                      <button
                        type="button"
                        className={buttonCls}
                        onClick={() => setFullyRevealed((current) => new Set(current).add(file.id))}
                      >
                        Show remaining {totalLines - LARGE_FILE_LINE_LIMIT} lines
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </System>
  );
}

export default DiffViewer;
