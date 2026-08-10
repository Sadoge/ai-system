import { Fragment, type ReactNode } from 'react';
import { Notehead, SeverityMark } from '../../../../../lib/ui';

type RecordValue = Record<string, unknown>;

const ARTIFACT_COPY: Record<string, { title: string; description: string }> = {
  ticket_snapshot: {
    title: 'Ticket snapshot',
    description: 'The request exactly as it entered this run.',
  },
  research_report: {
    title: 'Research report',
    description: 'Repository context, risks, and open questions found before planning.',
  },
  implementation_plan: {
    title: 'Implementation plan',
    description: 'The proposed change for human review before any code is written.',
  },
  task_plan: {
    title: 'Task plan',
    description: 'The approved plan divided into executable, dependency-aware tasks.',
  },
  task_spec: {
    title: 'Coding brief',
    description: 'The exact instructions and project context given to the coding agent.',
  },
  diff: {
    title: 'Code changes',
    description: 'The patch produced by the coding stage, compared with its base branch.',
  },
  integration_report: {
    title: 'Integration report',
    description: 'How parallel task branches were assembled into the run branch.',
  },
  review_report: {
    title: 'Review report',
    description: 'Review conclusions and the findings that may require another iteration.',
  },
  test_report: {
    title: 'Test report',
    description: 'Test outcome, interpreted failures, and the command output used as evidence.',
  },
  documentation: {
    title: 'Documentation notes',
    description: 'The documentation impact and changelog prepared for this change.',
  },
  pr_package: {
    title: 'Pull request package',
    description: 'The proposed pull request, branch details, and final evidence for approval.',
  },
  agent_transcript: {
    title: 'Agent transcript',
    description: 'The coding agent’s recorded output for audit and troubleshooting.',
  },
  echo_output: {
    title: 'Echo output',
    description: 'Output from the local pipeline smoke test.',
  },
};

export function artifactCopy(kind: string) {
  return (
    ARTIFACT_COPY[kind] ?? {
      title: humanize(kind),
      description: 'A structured record produced during this run.',
    }
  );
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asRecords(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function humanize(value: string): string {
  const words = value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function diffSummary(diff: string) {
  const files: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header?.[2]) files.push(header[2]);
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }

  return { files: unique(files), additions, deletions };
}

export function affectedFilesFromArtifact(content: unknown): string[] {
  const files: string[] = [];

  function visit(value: unknown, key = '') {
    if (typeof value === 'string') {
      if (key === 'file' || key === 'filePath') files.push(value);
      if (key === 'diff') files.push(...diffSummary(value).files);
      return;
    }
    if (Array.isArray(value)) {
      if (key === 'files' || key === 'relevantFiles') {
        files.push(...value.filter((item): item is string => typeof item === 'string'));
        return;
      }
      value.forEach((item) => visit(item));
      return;
    }
    if (isRecord(value)) {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
    }
  }

  visit(content);
  return unique(files);
}

function InlineText({ children }: { children: string }) {
  const tokens = children.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code
              key={index}
              className="bg-ground-band px-1 font-mono text-[0.8125rem] text-ink-secondary"
            >
              {token.slice(1, -1)}
            </code>
          );
        }
        if (token.startsWith('**') && token.endsWith('**')) {
          return (
            <strong key={index} className="font-normal text-ink">
              {token.slice(2, -2)}
            </strong>
          );
        }
        const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (link?.[1] && link[2]) {
          return (
            <a
              key={index}
              href={link[2]}
              className="text-cue-bright underline decoration-rule-strong underline-offset-2 hover:decoration-cue"
            >
              {link[1]}
            </a>
          );
        }
        return <Fragment key={index}>{token}</Fragment>;
      })}
    </>
  );
}

function RichText({ text }: { text: string }) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index++;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index++;
      }
      index++;
      blocks.push(<CodeBlock key={`code-${index}`} text={code.join('\n')} />);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading?.[2]) {
      blocks.push(
        <h3 key={`heading-${index}`} className="mt-6 annot text-base text-ink-secondary first:mt-0">
          <InlineText>{heading[2]}</InlineText>
        </h3>,
      );
      index++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index++;
      }
      blocks.push(
        <ul
          key={`list-${index}`}
          className="my-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-muted marker:text-ink-label"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineText>{item}</InlineText>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        index++;
      }
      blocks.push(
        <ol
          key={`ordered-${index}`}
          className="my-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-muted marker:font-mono marker:text-ink-label"
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineText>{item}</InlineText>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index++;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(#{1,4})\s+/.test(lines[index] ?? '') &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '') &&
      !/^\s*\d+[.)]\s+/.test(lines[index] ?? '') &&
      !(lines[index] ?? '').trim().startsWith('```')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index++;
    }
    blocks.push(
      <p
        key={`paragraph-${index}`}
        className="my-3 max-w-[75ch] text-sm leading-relaxed text-ink-muted first:mt-0 last:mb-0"
      >
        <InlineText>{paragraph.join(' ')}</InlineText>
      </p>,
    );
  }

  return <div>{blocks}</div>;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-3 mt-8 flex items-center gap-3 first:mt-0">
      <h3 className="annot text-sm text-ink-secondary">{children}</h3>
      <span className="h-px flex-1 bg-rule" />
      {aside !== undefined && (
        <span className="font-mono text-xs text-ink-faint tnum">{aside}</span>
      )}
    </header>
  );
}

function CodeBlock({ text, className = '' }: { text: string; className?: string }) {
  return (
    <pre
      className={`my-3 max-h-[36rem] overflow-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed text-ink-secondary ${className}`}
    >
      <code>{text}</code>
    </pre>
  );
}

function FileList({ files }: { files: string[] }) {
  if (files.length === 0) {
    return (
      <p className="annot text-sm text-ink-label">
        No specific file paths were named in this artifact.
      </p>
    );
  }
  return (
    <ul className="grid gap-x-6 border-t border-rule sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <li
          key={file}
          className="border-b border-rule py-2 font-mono text-xs text-ink-secondary break-all"
        >
          {file}
        </li>
      ))}
    </ul>
  );
}

function AffectedFiles({ content }: { content: unknown }) {
  const files = affectedFilesFromArtifact(content);
  return (
    <section>
      <SectionTitle aside={files.length}>
        {files.length === 1 ? 'Affected file' : 'Affected files'}
      </SectionTitle>
      <FileList files={files} />
    </section>
  );
}

function Steps({ steps }: { steps: RecordValue[] }) {
  if (steps.length === 0)
    return <p className="annot text-sm text-ink-label">No steps were recorded.</p>;
  return (
    <ol className="border-t border-rule">
      {steps.map((step, index) => {
        const files = asStrings(step.files);
        return (
          <li
            key={index}
            className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4"
          >
            <span className="font-mono text-xs text-ink-faint tnum">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink">{asText(step.title) ?? `Step ${index + 1}`}</p>
              {asText(step.detail) && <RichText text={String(step.detail)} />}
              {files.length > 0 && (
                <p className="mt-2 font-mono text-xs leading-relaxed text-ink-faint break-all">
                  {files.join(' · ')}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Findings({ findings }: { findings: RecordValue[] }) {
  if (findings.length === 0)
    return <p className="annot text-sm text-ink-label">No findings were recorded.</p>;
  return (
    <ul className="space-y-5">
      {findings.map((finding, index) => (
        <li
          key={index}
          className="flex flex-col gap-1 border-l border-rule pl-4 sm:flex-row sm:gap-4"
        >
          <div className="shrink-0 pt-0.5 sm:w-28">
            <SeverityMark severity={asText(finding.severity) ?? 'info'} />
            {asText(finding.category) && (
              <p className="mt-1 font-mono text-micro text-ink-faint">{String(finding.category)}</p>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{asText(finding.title) ?? 'Untitled finding'}</p>
            {asText(finding.detail) && <RichText text={String(finding.detail)} />}
            {asText(finding.filePath) && (
              <p className="mt-2 font-mono text-xs text-ink-faint break-all">
                {String(finding.filePath)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StringList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <p className="annot text-sm text-ink-label">{empty}</p>;
  return (
    <ul className="border-t border-rule">
      {values.map((value, index) => (
        <li
          key={index}
          className="border-b border-rule py-3 text-sm leading-relaxed text-ink-muted"
        >
          <InlineText>{value}</InlineText>
        </li>
      ))}
    </ul>
  );
}

function PlanView({ content }: { content: RecordValue }) {
  const steps = asRecords(content.steps);
  return (
    <>
      {asText(content.summary) && <RichText text={String(content.summary)} />}
      <AffectedFiles content={content} />
      <SectionTitle aside={steps.length}>Change sequence</SectionTitle>
      <Steps steps={steps} />
      <SectionTitle>Verification</SectionTitle>
      {asText(content.testStrategy) ? (
        <RichText text={String(content.testStrategy)} />
      ) : (
        <p className="annot text-sm text-ink-label">No test strategy was recorded.</p>
      )}
    </>
  );
}

function ResearchView({ content }: { content: RecordValue }) {
  return (
    <>
      {asText(content.summary) && <RichText text={String(content.summary)} />}
      <AffectedFiles content={content} />
      <SectionTitle aside={asStrings(content.risks).length}>Risks</SectionTitle>
      <StringList values={asStrings(content.risks)} empty="No specific risks were identified." />
      <SectionTitle aside={asStrings(content.openQuestions).length}>Open questions</SectionTitle>
      <StringList
        values={asStrings(content.openQuestions)}
        empty="No open questions were recorded."
      />
    </>
  );
}

function TicketView({ content }: { content: RecordValue }) {
  const criteria = asStrings(content.acceptanceCriteria);
  const labels = asStrings(content.labels);
  return (
    <>
      <h3 className="max-w-[75ch] text-xl leading-snug text-ink">
        {asText(content.title) ?? 'Untitled ticket'}
      </h3>
      <p className="mt-2 font-mono text-xs text-ink-faint">
        {[asText(content.source), asText(content.externalKey)].filter(Boolean).join(' · ')}
      </p>
      {asText(content.description) && (
        <div className="mt-6">
          <RichText text={String(content.description)} />
        </div>
      )}
      <SectionTitle aside={criteria.length}>Acceptance criteria</SectionTitle>
      <StringList values={criteria} empty="No acceptance criteria were supplied." />
      {labels.length > 0 && (
        <>
          <SectionTitle aside={labels.length}>Labels</SectionTitle>
          <p className="font-mono text-xs leading-relaxed text-ink-secondary">
            {labels.join(' · ')}
          </p>
        </>
      )}
    </>
  );
}

function TaskPlanView({ content }: { content: RecordValue }) {
  const tasks = asRecords(content.tasks);
  return (
    <>
      {asText(content.summary) && <RichText text={String(content.summary)} />}
      <AffectedFiles content={content} />
      <SectionTitle aside={tasks.length}>Execution order</SectionTitle>
      <ol className="border-t border-rule">
        {tasks.map((task, index) => {
          const dependencies = asStrings(task.dependsOn);
          return (
            <li
              key={index}
              className="grid gap-2 border-b border-rule py-4 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-4"
            >
              <div className="font-mono text-xs text-ink-faint">
                {asText(task.key) ?? String(index + 1).padStart(2, '0')}
                <p className="mt-1 text-micro">
                  {dependencies.length ? `after ${dependencies.join(', ')}` : 'ready first'}
                </p>
              </div>
              <div>
                <p className="text-sm text-ink">{asText(task.title) ?? 'Untitled task'}</p>
                {asText(task.detail) && <RichText text={String(task.detail)} />}
                {asStrings(task.files).length > 0 && (
                  <p className="mt-2 font-mono text-xs text-ink-faint break-all">
                    {asStrings(task.files).join(' · ')}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function ReportView({ content }: { content: RecordValue }) {
  const findings = asRecords(content.findings);
  return (
    <>
      {asText(content.summary) && <RichText text={String(content.summary)} />}
      <AffectedFiles content={content} />
      <SectionTitle aside={findings.length}>Findings</SectionTitle>
      <Findings findings={findings} />
      {asRecords(content.specialtyPasses).length > 0 && (
        <>
          <SectionTitle aside={asRecords(content.specialtyPasses).length}>
            Specialist passes
          </SectionTitle>
          <GenericValue value={content.specialtyPasses} />
        </>
      )}
    </>
  );
}

function Outcome({ passed, children }: { passed: boolean; children: ReactNode }) {
  return (
    <p
      className={`inline-flex items-center gap-2 font-mono text-sm ${passed ? 'text-ink-secondary' : 'text-mark-bright'}`}
    >
      <Notehead head={passed ? 'filled' : 'cross'} />
      {children}
    </p>
  );
}

function TestView({ content }: { content: RecordValue }) {
  const passed = content.testsPassed === true;
  const analysis = isRecord(content.analysis) ? content.analysis : {};
  const findings = asRecords(analysis.findings);
  return (
    <>
      <Outcome passed={passed}>{passed ? 'Tests passed' : 'Tests failed'}</Outcome>
      {asText(analysis.summary) && (
        <div className="mt-4">
          <RichText text={String(analysis.summary)} />
        </div>
      )}
      <AffectedFiles content={content} />
      <SectionTitle aside={findings.length}>Test findings</SectionTitle>
      <Findings findings={findings} />
      <SectionTitle>Command output</SectionTitle>
      <Disclosure title="Show test output">
        <CodeBlock text={asText(content.output) ?? 'No command output was recorded.'} />
      </Disclosure>
    </>
  );
}

function DiffView({ content }: { content: RecordValue }) {
  const diff = asText(content.diff) ?? '';
  const summary = diffSummary(diff);
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-4 sm:grid-cols-5">
        <Readout label="base" value={asText(content.baseBranch) ?? 'unknown'} />
        <Readout
          label="branch"
          value={asText(content.branch) ?? 'unknown'}
          className="col-span-2 sm:col-span-2"
        />
        <Readout label="additions" value={`+${summary.additions}`} />
        <Readout label="deletions" value={`−${summary.deletions}`} />
      </dl>
      <SectionTitle aside={summary.files.length}>
        {summary.files.length === 1 ? 'Changed file' : 'Changed files'}
      </SectionTitle>
      <FileList files={summary.files} />
      <SectionTitle>Patch</SectionTitle>
      {diff ? (
        <DiffBlock diff={diff} />
      ) : (
        <p className="annot text-sm text-ink-label">The patch is empty.</p>
      )}
    </>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="max-h-[48rem] overflow-auto border-l border-rule-strong bg-ground-raised p-4 font-mono text-xs leading-relaxed">
      <code>
        {diff.split('\n').map((line, index) => {
          const className = line.startsWith('diff --git')
            ? 'text-cue-bright'
            : line.startsWith('@@')
              ? 'text-ink-label'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'text-ink-faint'
                : 'text-ink-secondary';
          return (
            <span key={index} className={`block min-w-max ${className}`}>
              {line || ' '}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function Readout({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="annot text-xs text-ink-label">{label}</dt>
      <dd className="mt-1 truncate font-mono text-xs text-ink-secondary tnum" title={value}>
        {value}
      </dd>
    </div>
  );
}

function PrPackageView({ content }: { content: RecordValue }) {
  const stats = isRecord(content.diffStat) ? content.diffStat : {};
  return (
    <>
      <h3 className="max-w-[75ch] text-xl leading-snug text-ink">
        {asText(content.title) ?? 'Untitled pull request'}
      </h3>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-4 sm:grid-cols-5">
        <Readout label="base" value={asText(content.baseBranch) ?? 'unknown'} />
        <Readout
          label="branch"
          value={asText(content.branch) ?? 'unknown'}
          className="col-span-2 sm:col-span-2"
        />
        <Readout label="files" value={String(stats.files ?? 0)} />
        <Readout
          label="lines"
          value={`+${String(stats.additions ?? 0)} / −${String(stats.deletions ?? 0)}`}
        />
      </dl>
      {asText(content.prUrl) && (
        <p className="mt-5">
          <a
            href={String(content.prUrl)}
            className="font-mono text-sm text-cue-bright underline decoration-rule-strong underline-offset-2 hover:decoration-cue"
          >
            Open pull request
          </a>
        </p>
      )}
      {asText(content.prError) && (
        <p className="mt-5 border-l border-mark pl-4 text-sm leading-relaxed text-mark-bright">
          {String(content.prError)}
        </p>
      )}
      <SectionTitle>Proposed description</SectionTitle>
      {asText(content.body) ? (
        <RichText text={String(content.body)} />
      ) : (
        <p className="annot text-sm text-ink-label">No pull request description was recorded.</p>
      )}
    </>
  );
}

function TaskSpecView({ content }: { content: RecordValue }) {
  const taskSpec = isRecord(content.taskSpec) ? content.taskSpec : content;
  const steps = asRecords(taskSpec.steps);
  const findings = asRecords(taskSpec.findings);
  return (
    <>
      <h3 className="text-base text-ink">
        {asText(taskSpec.taskTitle) ?? asText(taskSpec.ticketTitle) ?? 'Coding brief'}
      </h3>
      {asText(taskSpec.planSummary) && (
        <div className="mt-4">
          <RichText text={String(taskSpec.planSummary)} />
        </div>
      )}
      <AffectedFiles content={taskSpec} />
      <SectionTitle aside={steps.length}>Instructions</SectionTitle>
      <Steps steps={steps} />
      {findings.length > 0 && (
        <>
          <SectionTitle aside={findings.length}>Findings to resolve</SectionTitle>
          <Findings findings={findings} />
        </>
      )}
      {asText(content.prompt) && (
        <>
          <SectionTitle>Rendered agent prompt</SectionTitle>
          <Disclosure title="Show exact prompt">
            <CodeBlock text={String(content.prompt)} />
          </Disclosure>
        </>
      )}
    </>
  );
}

function IntegrationView({ content }: { content: RecordValue }) {
  const resolved = asRecords(content.conflictsResolved);
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-4 sm:grid-cols-4">
        <Readout
          label="branch"
          value={asText(content.branch) ?? 'unknown'}
          className="col-span-2"
        />
        <Readout label="tasks" value={String(content.taskCount ?? 0)} />
        <Readout label="iteration" value={String(content.iteration ?? 0)} />
      </dl>
      <SectionTitle aside={asStrings(content.merged).length}>Merged tasks</SectionTitle>
      <StringList values={asStrings(content.merged)} empty="No new task branches were merged." />
      {asStrings(content.alreadyMerged).length > 0 && (
        <>
          <SectionTitle>Already present</SectionTitle>
          <StringList values={asStrings(content.alreadyMerged)} empty="" />
        </>
      )}
      {resolved.length > 0 && (
        <>
          <SectionTitle aside={resolved.length}>Resolved conflicts</SectionTitle>
          <GenericValue value={resolved} />
        </>
      )}
    </>
  );
}

function DocumentationView({ content }: { content: RecordValue }) {
  return (
    <>
      {asText(content.summary) && <RichText text={String(content.summary)} />}
      <SectionTitle aside={asStrings(content.changelog).length}>Changelog</SectionTitle>
      <StringList
        values={asStrings(content.changelog)}
        empty="No changelog entries were proposed."
      />
    </>
  );
}

function TranscriptView({ content }: { content: RecordValue }) {
  return (
    <>
      {asText(content.taskId) && (
        <p className="mb-4 font-mono text-xs text-ink-faint">task {String(content.taskId)}</p>
      )}
      <CodeBlock
        text={asText(content.transcript) ?? 'No transcript was recorded.'}
        className="max-h-[60rem]"
      />
    </>
  );
}

function GenericValue({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="annot text-sm text-ink-label">not recorded</span>;
  if (typeof value === 'boolean')
    return <span className="font-mono text-xs text-ink-secondary">{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'number')
    return <span className="font-mono text-xs text-ink-secondary tnum">{value}</span>;
  if (typeof value === 'string') return <RichText text={value} />;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string'))
      return <StringList values={value as string[]} empty="No entries." />;
    return (
      <div className="border-t border-rule">
        {value.map((item, index) => (
          <div key={index} className="border-b border-rule py-3">
            <GenericValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (isRecord(value)) {
    return (
      <dl className="border-t border-rule">
        {Object.entries(value).map(([key, child]) => (
          <div
            key={key}
            className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="annot text-xs text-ink-label">{humanize(key)}</dt>
            <dd className="min-w-0 text-sm text-ink-muted">
              <GenericValue value={child} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-sm text-ink-muted">{String(value)}</span>;
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-y border-rule">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 font-mono text-xs text-cue-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright">
        <svg
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        {title}
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

export function ArtifactView({ kind, content }: { kind: string; content: unknown }) {
  const record = isRecord(content) ? content : null;
  let rendered: ReactNode = <GenericValue value={content} />;

  if (record) {
    switch (kind) {
      case 'ticket_snapshot':
        rendered = <TicketView content={record} />;
        break;
      case 'research_report':
        rendered = <ResearchView content={record} />;
        break;
      case 'implementation_plan':
        rendered = <PlanView content={record} />;
        break;
      case 'task_plan':
        rendered = <TaskPlanView content={record} />;
        break;
      case 'task_spec':
        rendered = <TaskSpecView content={record} />;
        break;
      case 'diff':
        rendered = <DiffView content={record} />;
        break;
      case 'integration_report':
        rendered = <IntegrationView content={record} />;
        break;
      case 'review_report':
        rendered = <ReportView content={record} />;
        break;
      case 'test_report':
        rendered = <TestView content={record} />;
        break;
      case 'documentation':
        rendered = <DocumentationView content={record} />;
        break;
      case 'pr_package':
        rendered = <PrPackageView content={record} />;
        break;
      case 'agent_transcript':
        rendered = <TranscriptView content={record} />;
        break;
    }
  }

  return (
    <>
      {rendered}
      <SectionTitle>Source record</SectionTitle>
      <Disclosure title="Show raw JSON">
        <CodeBlock text={JSON.stringify(content, null, 2)} />
      </Disclosure>
    </>
  );
}
