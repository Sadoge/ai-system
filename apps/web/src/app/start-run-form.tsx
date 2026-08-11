'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { startRun, type StartRunState } from '@/lib/actions';
import {
  AUTOMATION_OPTIONS,
  PIPELINE_OPTIONS,
  normalizeJiraKey,
  validateRunForm,
  type RunFormInput,
  type RunFormProject,
  type TicketSource,
} from '@/lib/run-form';
import { buttonCls, inputCls, selectCls } from '@/lib/ui';

const initialState: StartRunState = { status: 'idle' };
const focusCls =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cue-bright';
const radioCls = `${focusCls} mt-0.5 size-4 shrink-0 appearance-none border border-rule-strong bg-transparent checked:border-cue-bright checked:bg-cue disabled:cursor-not-allowed disabled:opacity-50`;

type FieldName = keyof Pick<
  RunFormInput,
  'title' | 'jiraKey' | 'projectId' | 'repositoryId' | 'pipeline' | 'automation'
>;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-mark-bright">
      {message}
    </p>
  );
}

function OptionGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: 'pipeline' | 'automation';
  value: string;
  options: readonly { value: string; label: string; description: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="annot mb-2 text-sm text-ink-label">{legend}</legend>
      <div className="divide-y divide-rule border-y border-rule">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 py-3 hover:bg-ground-raised"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className={radioCls}
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink">{option.label}</span>
              <span className="block text-sm leading-6 text-ink-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StartRunForm({ projects }: { projects: RunFormProject[] }) {
  const [state, dispatch, isPending] = useActionState(startRun, initialState);
  const submittingRef = useRef(false);
  const [source, setSource] = useState<TicketSource>('manual');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jiraKey, setJiraKey] = useState('');
  const [pipeline, setPipeline] = useState('mvp');
  const [automation, setAutomation] = useState('plan_gated');
  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0]!.id : '');
  const initialProject = projects.length === 1 ? projects[0] : undefined;
  const [repositoryId, setRepositoryId] = useState(
    initialProject?.repositories.length === 1 ? initialProject.repositories[0]!.id : '',
  );
  const [touched, setTouched] = useState<Set<FieldName>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [editedSinceResponse, setEditedSinceResponse] = useState<Set<FieldName>>(new Set());

  useEffect(() => {
    if (!isPending) submittingRef.current = false;
  }, [isPending, state]);

  useEffect(() => {
    setEditedSinceResponse(new Set());
  }, [state]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const input: RunFormInput = {
    source,
    title,
    description,
    jiraKey,
    projectId,
    repositoryId,
    pipeline,
    automation,
  };
  const clientErrors = validateRunForm(input, { projects }).fieldErrors;

  function touch(field: FieldName) {
    setTouched((current) => new Set(current).add(field));
  }

  function edit(field: FieldName) {
    setEditedSinceResponse((current) => new Set(current).add(field));
  }

  function errorFor(field: FieldName): string | undefined {
    if ((submitted || touched.has(field)) && clientErrors[field]) return clientErrors[field];
    if (!editedSinceResponse.has(field)) return state.fieldErrors?.[field];
    return undefined;
  }

  function selectSource(nextSource: TicketSource) {
    setSource(nextSource);
    setSubmitted(false);
  }

  function selectProject(nextProjectId: string) {
    const nextProject = projects.find((project) => project.id === nextProjectId);
    setProjectId(nextProjectId);
    setRepositoryId(nextProject?.repositories.length === 1 ? nextProject.repositories[0]!.id : '');
    edit('projectId');
    edit('repositoryId');
  }

  return (
    <form
      action={(formData) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        dispatch(formData);
      }}
      onSubmit={(event) => {
        setSubmitted(true);
        if (Object.keys(clientErrors).length > 0 || projects.length === 0) {
          event.preventDefault();
        }
      }}
      noValidate
      className="grid min-w-0 grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2"
    >
      <fieldset className="min-w-0 lg:col-span-2">
        <legend className="annot mb-2 text-sm text-ink-label">Ticket source</legend>
        <div className="flex flex-col border-y border-rule sm:flex-row sm:divide-x sm:divide-rule">
          {(
            [
              ['manual', 'Write a ticket', 'Describe the work directly in this score.'],
              ['jira', 'Import from Jira', 'Call the run from an existing Jira issue.'],
            ] as const
          ).map(([value, label, note]) => (
            <label
              key={value}
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 sm:px-4 sm:first:pl-0 hover:bg-ground-raised"
            >
              <input
                type="radio"
                name="ticketSourceChoice"
                value={value}
                checked={source === value}
                onChange={() => selectSource(value)}
                className={radioCls}
              />
              <span className="min-w-0">
                <span className="block text-sm text-ink">{label}</span>
                <span className="block text-sm leading-6 text-ink-muted">{note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <input type="hidden" name="source" value={source} />

      <div className="min-w-0 space-y-6">
        <p className="annot text-sm text-ink-label">
          {source === 'manual'
            ? 'Write the instruction the agents will carry through the pipeline.'
            : 'Name the Jira issue that will become the run ticket.'}
        </p>

        {source === 'manual' ? (
          <>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="annot text-sm text-ink-label">Ticket title</span>
              <input
                name="title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  edit('title');
                }}
                onBlur={() => touch('title')}
                required
                aria-invalid={Boolean(errorFor('title'))}
                aria-describedby={errorFor('title') ? 'title-error' : undefined}
                className={`${inputCls} w-full text-base sm:text-sm`}
                placeholder="Add retry logic to the webhook dispatcher"
              />
              <FieldError id="title-error" message={errorFor('title')} />
            </label>

            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="annot text-sm text-ink-label">Description</span>
              <textarea
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={6}
                aria-describedby="description-hint"
                className={`${inputCls} w-full resize-y text-base leading-6 sm:text-sm`}
                placeholder="What should change, and what should remain true?"
              />
              <p id="description-hint" className="text-sm leading-6 text-ink-muted">
                Include the expected behavior and any constraints the run should preserve.
              </p>
            </label>
          </>
        ) : (
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="annot text-sm text-ink-label">Jira issue key</span>
            <input
              name="jiraKey"
              value={jiraKey}
              onChange={(event) => {
                setJiraKey(normalizeJiraKey(event.target.value));
                edit('jiraKey');
              }}
              onBlur={() => {
                setJiraKey((value) => normalizeJiraKey(value));
                touch('jiraKey');
              }}
              required
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={Boolean(errorFor('jiraKey'))}
              aria-describedby={`jira-hint${errorFor('jiraKey') ? ' jira-error' : ''}`}
              className={`${inputCls} w-full text-base uppercase sm:text-sm`}
              placeholder="PROJ-123"
            />
            <p id="jira-hint" className="text-sm leading-6 text-ink-muted">
              The issue title and description are fetched from Jira when the run starts.
            </p>
            <FieldError id="jira-error" message={errorFor('jiraKey')} />
          </label>
        )}
      </div>

      <div className="min-w-0 space-y-7 border-t border-rule pt-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
        <p className="annot text-sm text-ink-label">
          Set the route through the score and the repository it will change.
        </p>

        <OptionGroup
          legend="Pipeline"
          name="pipeline"
          value={pipeline}
          options={PIPELINE_OPTIONS}
          onChange={(value) => {
            setPipeline(value);
            edit('pipeline');
            edit('repositoryId');
          }}
        />

        <OptionGroup
          legend="Automation"
          name="automation"
          value={automation}
          options={AUTOMATION_OPTIONS}
          onChange={(value) => {
            setAutomation(value);
            edit('automation');
          }}
        />

        <p className="text-sm leading-6 text-ink-muted">
          The final pull request always requires human approval, regardless of automation level.
        </p>

        {projects.length === 0 ? (
          <p className="annot border-y border-rule py-4 text-sm text-ink-label">
            No projects yet — create a project before calling a run.
          </p>
        ) : (
          <div className="space-y-6 border-t border-rule pt-6">
            {projects.length === 1 ? (
              <div>
                <p className="annot text-sm text-ink-label">Project</p>
                <p className="mt-1 break-words text-sm text-ink">{projects[0]!.name}</p>
                <input type="hidden" name="projectId" value={projects[0]!.id} />
              </div>
            ) : (
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="annot text-sm text-ink-label">Project</span>
                <select
                  name="projectId"
                  value={projectId}
                  onChange={(event) => selectProject(event.target.value)}
                  onBlur={() => touch('projectId')}
                  required
                  aria-invalid={Boolean(errorFor('projectId'))}
                  aria-describedby={errorFor('projectId') ? 'project-error' : undefined}
                  className={`${selectCls} w-full text-base sm:text-sm`}
                >
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <FieldError id="project-error" message={errorFor('projectId')} />
              </label>
            )}

            {selectedProject ? (
              selectedProject.repositories.length === 0 ? (
                <p className="annot text-sm text-ink-label">
                  No repositories are registered for this project
                  {pipeline === 'trivial' ? ' — none is required for the trivial pipeline.' : '.'}
                </p>
              ) : selectedProject.repositories.length === 1 ? (
                <div>
                  <p className="annot text-sm text-ink-label">
                    Repository{pipeline === 'trivial' ? ' (optional)' : ''}
                  </p>
                  <p className="mt-1 break-words text-sm text-ink">
                    {selectedProject.repositories[0]!.name}
                  </p>
                  <input
                    type="hidden"
                    name="repositoryId"
                    value={selectedProject.repositories[0]!.id}
                  />
                </div>
              ) : (
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="annot text-sm text-ink-label">
                    Repository{pipeline === 'trivial' ? ' (optional)' : ''}
                  </span>
                  <select
                    name="repositoryId"
                    value={repositoryId}
                    onChange={(event) => {
                      setRepositoryId(event.target.value);
                      edit('repositoryId');
                    }}
                    onBlur={() => touch('repositoryId')}
                    required={pipeline !== 'trivial'}
                    aria-invalid={Boolean(errorFor('repositoryId'))}
                    aria-describedby={errorFor('repositoryId') ? 'repository-error' : undefined}
                    className={`${selectCls} w-full text-base sm:text-sm`}
                  >
                    <option value="">
                      {pipeline === 'trivial' ? 'No repository' : 'Select a repository'}
                    </option>
                    {selectedProject.repositories.map((repository) => (
                      <option key={repository.id} value={repository.id}>
                        {repository.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id="repository-error" message={errorFor('repositoryId')} />
                </label>
              )
            ) : (
              <p className="annot text-sm text-ink-label">
                Choose a project to set the repository.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-start gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center lg:col-span-2">
        <button
          type="submit"
          disabled={isPending || projects.length === 0}
          className={`${buttonCls} shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isPending ? 'Starting run…' : 'Start run'}
        </button>
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-6 min-w-0 text-sm leading-6 text-mark-bright"
        >
          {state.formError ?? ''}
        </div>
      </div>
    </form>
  );
}
