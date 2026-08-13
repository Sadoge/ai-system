import Link from 'next/link';
import { apiGet, type RunDetail } from '@/lib/api';
import { resolveGateAction, retryRunAction } from '@/lib/actions';
import {
  SECTION_CAPS,
  capRows,
  defaultSectionOpen,
  isTerminalStatus,
  statusTone,
  summariseRun,
  type RunDetailSection,
} from '@/lib/run-detail-view';
import {
  Caesura,
  Fermata,
  SeverityMark,
  StatusMark,
  buttonCls,
  buttonDangerCls,
  formatTokens,
  inputCls,
  linkCls,
} from '@/lib/ui';
import { ExecutionMonitor } from './execution-monitor';
import { LiveRefresh } from './live-refresh';
import { RunCodeChanges } from './run-code-changes';
import { SectionDisclosure } from './section-disclosure';
import { StopRunControl } from './stop-run-control';
import { RunSystem } from './system';

type SearchParams = Record<string, string | string[] | undefined>;

function elapsedLabel(start: string, end: string) {
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function queryValues(searchParams: SearchParams): SearchParams {
  return Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function sectionHref(searchParams: SearchParams, section: RunDetailSection) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'open') continue;
    if (Array.isArray(value)) value.forEach((entry) => query.append(key, entry));
    else if (value !== undefined) query.append(key, value);
  }
  query.set('open', section);
  return `?${query.toString()}#run-${section}`;
}

function MoreLink({
  section,
  remaining,
  expanded,
  searchParams,
}: {
  section: Exclude<RunDetailSection, 'gates'>;
  remaining: number;
  expanded: boolean;
  searchParams: SearchParams;
}) {
  const query = queryValues(searchParams);
  if (expanded) delete query[section];
  else query[section] = 'all';

  return (
    <Link href={{ query }} scroll={false} className={`run-detail-more ${linkCls}`}>
      {expanded ? 'Show fewer' : `Show remaining ${remaining} ${section}`}
    </Link>
  );
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, currentQuery] = await Promise.all([params, searchParams]);
  const run = await apiGet<RunDetail>(`/runs/${id}`);
  const stages = run.stages ?? [];
  const gates = run.gates ?? [];
  const tasks = run.tasks ?? [];
  const artifacts = run.artifacts ?? [];
  const findings = run.findings ?? [];
  const agents = run.agents ?? [];
  const events = run.events ?? [];
  const safeRun = { ...run, stages, gates, tasks, artifacts, findings, agents, events };
  const summary = summariseRun(safeRun);
  const terminal = isTerminalStatus(run.status);
  const diffArtifact = artifacts.filter((artifact) => artifact.kind === 'diff').at(-1);
  const tasksExpanded = firstQueryValue(currentQuery.tasks) === 'all';
  const artifactsExpanded = firstQueryValue(currentQuery.artifacts) === 'all';
  const eventsExpanded = firstQueryValue(currentQuery.events) === 'all';
  const cappedTasks = capRows(tasks, SECTION_CAPS.tasks, tasksExpanded);
  const cappedArtifacts = capRows(artifacts, SECTION_CAPS.artifacts, artifactsExpanded);
  const cappedEvents = capRows(events, SECTION_CAPS.events, eventsExpanded);
  const elapsedEnd = terminal ? run.updatedAt : new Date().toISOString();
  const target = run.repositoryId
    ? `repository ${run.repositoryId}`
    : run.projectId
      ? `project ${run.projectId}`
      : null;
  const doneTasks = tasks.filter((task) => task.status === 'completed').length;
  const activeProcessCount =
    stages.filter((stage) => stage.status === 'running').length +
    tasks.filter((task) => task.status === 'running').length +
    agents.filter((agent) => agent.status === 'running').length;

  const sectionOpen = (section: RunDetailSection) =>
    firstQueryValue(currentQuery[section]) === 'all' ||
    defaultSectionOpen({
      section,
      status: run.status,
      itemCount: summary.counts[section],
      needsAttention: summary.needsAttention,
    });

  return (
    <main>
      <LiveRefresh runId={id} active={!terminal} />

      <header className="run-detail-hero">
        <Link href="/" className={`${linkCls} run-detail-back`}>
          ← back to runs
        </Link>
        <div className="run-detail-title-row">
          <h1>{run.ticket.title}</h1>
          <div className="run-detail-state" data-tone={statusTone(run.status)}>
            <StatusMark status={run.status} />
            {!terminal && (
              <span className="run-detail-live">
                <span className="pulse-live" aria-hidden="true" />
                live updates
              </span>
            )}
          </div>
          {!terminal && <StopRunControl runId={run.id} />}
        </div>

        <dl className="run-detail-meta">
          <div>
            <dt>ticket</dt>
            <dd>{run.ticket.externalKey ?? run.ticket.source}</dd>
          </div>
          <div>
            <dt>run</dt>
            <dd>{run.id}</dd>
          </div>
          <div>
            <dt>pipeline</dt>
            <dd>{run.policySnapshot.pipeline}</dd>
          </div>
          <div>
            <dt>automation</dt>
            <dd>{run.policySnapshot.automationLevel}</dd>
          </div>
          {target && (
            <div>
              <dt>target</dt>
              <dd>{target}</dd>
            </div>
          )}
          <div>
            <dt>started</dt>
            <dd>
              <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString()}</time>
            </dd>
          </div>
          <div>
            <dt>elapsed</dt>
            <dd>{elapsedLabel(run.createdAt, elapsedEnd)}</dd>
          </div>
          <div>
            <dt>detail</dt>
            <dd>
              {run.complexity ? `${run.complexity} · ` : ''}iteration {run.iterationCount}
            </dd>
          </div>
          <div>
            <dt>usage</dt>
            <dd>
              {formatTokens(run.usage.inputTokens)} in / {formatTokens(run.usage.outputTokens)} out
              {run.usage.meteredUsd > 0 && ` · $${run.usage.meteredUsd.toFixed(4)}`}
              {run.usage.meteredUsd === 0 && run.usage.subscription.calls > 0 && ' · subscription'}
            </dd>
          </div>
        </dl>

        <nav className="run-detail-counts" aria-label="Run detail sections">
          {(['gates', 'tasks', 'artifacts', 'events'] as const).map((section) => (
            <a key={section} href={sectionHref(currentQuery, section)}>
              <span>{section}</span>
              <strong>{summary.counts[section]}</strong>
            </a>
          ))}
        </nav>
      </header>

      {summary.needsAttention.length > 0 && (
        <div className="run-detail-attention" role="status">
          <Fermata className="shrink-0" />
          <div>
            <p className="annot text-sm text-ink">Needs attention</p>
            <ul>
              {summary.needsAttention.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <a
                    href={
                      item.kind === 'gate'
                        ? sectionHref(currentQuery, 'gates')
                        : sectionHref({ ...currentQuery, tasks: 'all' }, 'tasks')
                    }
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {run.error && <p className="run-detail-error">{run.error}</p>}

      {run.status === 'failed' && (
        <div className="run-detail-retry">
          <Caesura>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="annot text-base text-ink">Retry from the failure</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-label">
                  Completed stages, artifacts, and completed task branches stay in place. Only the
                  failed stage or incomplete team tasks are queued again.
                </p>
              </div>
              <form action={retryRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className={buttonCls}>
                  Retry{run.currentStage ? ` ${run.currentStage}` : ''}
                </button>
              </form>
            </div>
          </Caesura>
        </div>
      )}

      <section id="run-gates" className="run-detail-section" data-section="gates">
        <header>
          <h2>Gates</h2>
          <span>{gates.length}</span>
        </header>
        <SectionDisclosure
          label="gate details"
          panelId="run-gates-panel"
          defaultOpen={sectionOpen('gates')}
          forceOpen={firstQueryValue(currentQuery.open) === 'gates'}
        >
          {gates.length === 0 ? (
            <p className="run-detail-empty">No gates have been requested.</p>
          ) : (
            <div className="run-detail-gate-list">
              {gates.map((gate) => {
                const artifactId =
                  typeof gate.payload?.artifactId === 'string' ? gate.payload.artifactId : null;
                if (gate.status === 'pending' && !terminal) {
                  return (
                    <Caesura key={gate.id}>
                      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Fermata className="shrink-0 text-mark-bright" />
                        <span className="annot text-base text-ink">Held for you</span>
                        <span className="font-mono text-sm text-mark-bright">{gate.gate}</span>
                        {artifactId && (
                          <Link
                            href={`/runs/${run.id}/artifacts/${artifactId}`}
                            className={`${linkCls} text-sm`}
                          >
                            read the {String(gate.payload.artifactKind ?? 'artifact')}
                          </Link>
                        )}
                      </div>
                      <form action={resolveGateAction} className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="gateId" value={gate.id} />
                        <label className="flex min-w-56 flex-1 flex-col gap-1">
                          <span className="annot text-xs text-ink-label">
                            Comment — required to reject
                          </span>
                          <input name="comment" className={inputCls} placeholder="Why" />
                        </label>
                        <button
                          type="submit"
                          name="decision"
                          value="approved"
                          className={buttonCls}
                        >
                          Approve
                        </button>
                        <button
                          type="submit"
                          name="decision"
                          value="rejected"
                          className={buttonDangerCls}
                        >
                          Reject
                        </button>
                      </form>
                    </Caesura>
                  );
                }
                return (
                  <div key={gate.id} className="run-detail-gate-row">
                    <StatusMark status={gate.status} />
                    <span>{gate.gate}</span>
                    <time dateTime={gate.createdAt}>
                      {new Date(gate.createdAt).toLocaleString()}
                    </time>
                    {artifactId && (
                      <Link href={`/runs/${run.id}/artifacts/${artifactId}`} className={linkCls}>
                        read the {String(gate.payload.artifactKind ?? 'artifact')}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionDisclosure>
      </section>

      <section id="run-tasks" className="run-detail-section" data-section="tasks">
        <header>
          <h2>Tasks</h2>
          <span>
            {doneTasks}/{tasks.length} done · {activeProcessCount} active
          </span>
        </header>
        <SectionDisclosure
          label="task progress"
          panelId="run-tasks-panel"
          defaultOpen={sectionOpen('tasks')}
          forceOpen={firstQueryValue(currentQuery.open) === 'tasks'}
        >
          <h3 className="run-detail-subheading">Task score</h3>
          <RunSystem run={safeRun} tasks={cappedTasks.visible} />
          {tasks.length === 0 && <p className="run-detail-empty">No task voices were created.</p>}
          <SectionDisclosure
            label="execution ledger"
            panelId="run-execution-panel"
            defaultOpen={!terminal}
          >
            <ExecutionMonitor run={safeRun} visibleTasks={cappedTasks.visible} />
          </SectionDisclosure>
          {cappedTasks.remaining > 0 && (
            <MoreLink
              section="tasks"
              remaining={cappedTasks.remaining}
              expanded={tasksExpanded}
              searchParams={currentQuery}
            />
          )}
          {tasksExpanded && tasks.length > SECTION_CAPS.tasks && (
            <MoreLink section="tasks" remaining={0} expanded searchParams={currentQuery} />
          )}
        </SectionDisclosure>
      </section>

      <section id="run-artifacts" className="run-detail-section" data-section="artifacts">
        <header>
          <h2>Artifacts</h2>
          <span>{artifacts.length}</span>
        </header>
        <div className="run-detail-primary-output">
          <h3 className="run-detail-subheading">Code changes</h3>
          <RunCodeChanges runId={run.id} artifactId={diffArtifact?.id} />
        </div>
        <SectionDisclosure
          label="artifact index and findings"
          panelId="run-artifacts-panel"
          defaultOpen={sectionOpen('artifacts')}
          forceOpen={firstQueryValue(currentQuery.open) === 'artifacts'}
        >
          {findings.length > 0 && (
            <div className="run-detail-findings">
              <h3 className="run-detail-subheading">Editorial marks</h3>
              <ul>
                {findings.map((finding) => (
                  <li key={finding.id}>
                    <div>
                      <SeverityMark severity={finding.severity} />
                      <span>{finding.status}</span>
                    </div>
                    <div>
                      <p>{finding.title}</p>
                      <p>{finding.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="run-detail-subheading">All parts</h3>
          {artifacts.length === 0 ? (
            <p className="run-detail-empty">
              No parts written yet. They appear as the run produces them.
            </p>
          ) : (
            <ul className="run-detail-artifacts">
              {cappedArtifacts.visible.map((artifact) => (
                <li key={artifact.id}>
                  <Link href={`/runs/${run.id}/artifacts/${artifact.id}`}>
                    <span>{artifact.kind}</span>
                    <time dateTime={artifact.createdAt}>
                      {new Date(artifact.createdAt).toLocaleTimeString()}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {cappedArtifacts.remaining > 0 && (
            <MoreLink
              section="artifacts"
              remaining={cappedArtifacts.remaining}
              expanded={artifactsExpanded}
              searchParams={currentQuery}
            />
          )}
          {artifactsExpanded && artifacts.length > SECTION_CAPS.artifacts && (
            <MoreLink section="artifacts" remaining={0} expanded searchParams={currentQuery} />
          )}
        </SectionDisclosure>
      </section>

      <section id="run-events" className="run-detail-section" data-section="events">
        <header>
          <h2>Events</h2>
          <span>{events.length}</span>
        </header>
        <SectionDisclosure
          label="event telemetry"
          panelId="run-events-panel"
          defaultOpen={sectionOpen('events')}
          forceOpen={firstQueryValue(currentQuery.open) === 'events'}
        >
          {events.length === 0 ? (
            <p className="run-detail-empty">No run events have been recorded.</p>
          ) : (
            <ol className="run-detail-events">
              {cappedEvents.visible.map((event) => (
                <li key={event.id}>
                  <div>
                    <span>{event.name}</span>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </div>
                  {Object.keys(event.payload ?? {}).length > 0 && (
                    <SectionDisclosure
                      label={`${event.name} payload`}
                      panelId={`run-event-${event.id}`}
                      defaultOpen={false}
                    >
                      <pre tabIndex={0} role="region" aria-label={`${event.name} payload content`}>
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </SectionDisclosure>
                  )}
                </li>
              ))}
            </ol>
          )}
          {cappedEvents.remaining > 0 && (
            <MoreLink
              section="events"
              remaining={cappedEvents.remaining}
              expanded={eventsExpanded}
              searchParams={currentQuery}
            />
          )}
          {eventsExpanded && events.length > SECTION_CAPS.events && (
            <MoreLink section="events" remaining={0} expanded searchParams={currentQuery} />
          )}
        </SectionDisclosure>
      </section>
    </main>
  );
}
