export type TicketSource = 'manual' | 'jira';

export const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

export interface RunFormRepository {
  id: string;
  name: string;
}

export interface RunFormProject {
  id: string;
  name: string;
  repositories: RunFormRepository[];
}

export interface RunFormInput {
  source: TicketSource;
  title: string;
  description: string;
  jiraKey: string;
  projectId: string;
  repositoryId: string;
  pipeline: string;
  automation: string;
}

export interface RunFormContext {
  projects: readonly RunFormProject[];
}

export interface RunFormValidation {
  fieldErrors: Record<string, string>;
}

export const PIPELINE_OPTIONS = [
  {
    value: 'mvp',
    label: 'MVP',
    description: 'Single-agent build of the smallest working change',
  },
  {
    value: 'team',
    label: 'Team',
    description: 'Multi-agent pipeline with planning, build, and review stages',
  },
  {
    value: 'trivial',
    label: 'Trivial',
    description: 'Fast path for small fixes — no repository required',
  },
] as const;

export const AUTOMATION_OPTIONS = [
  {
    value: 'plan_gated',
    label: 'Plan-gated',
    description: 'Pauses for your approval of the plan before code is written',
  },
  {
    value: 'autonomous',
    label: 'Autonomous',
    description: 'Runs end to end without a plan pause',
  },
] as const;

export function normalizeJiraKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function validateRunForm(
  input: RunFormInput,
  context: RunFormContext = { projects: [] },
): RunFormValidation {
  const fieldErrors: Record<string, string> = {};

  if (input.source === 'manual' && input.title.trim().length === 0) {
    fieldErrors.title = 'Enter a ticket title.';
  }

  if (input.source === 'jira') {
    const jiraKey = normalizeJiraKey(input.jiraKey);
    if (jiraKey.length === 0) {
      fieldErrors.jiraKey = 'Enter a Jira issue key.';
    } else if (!JIRA_KEY_PATTERN.test(jiraKey)) {
      fieldErrors.jiraKey = 'Use a Jira key like PROJ-123.';
    }
  }

  if (context.projects.length > 0 && input.projectId.trim().length === 0) {
    fieldErrors.projectId = 'Select a project.';
  }

  const selectedProject = context.projects.find((project) => project.id === input.projectId);
  if (
    input.pipeline !== 'trivial' &&
    selectedProject &&
    selectedProject.repositories.length > 1 &&
    input.repositoryId.trim().length === 0
  ) {
    fieldErrors.repositoryId = 'Select a repository for this pipeline.';
  }

  return { fieldErrors };
}

interface RunPayloadTarget {
  projectId?: string;
  repositoryId?: string;
}

export type RunPayload = (
  { ticket: { source: 'manual'; title: string; description: string } } | { jiraKey: string }
) & {
  pipeline: string;
  automation: string;
} & RunPayloadTarget;

export function buildRunPayload(input: RunFormInput): RunPayload {
  const sourcePayload =
    input.source === 'jira'
      ? { jiraKey: normalizeJiraKey(input.jiraKey) }
      : {
          ticket: {
            source: 'manual' as const,
            title: input.title.trim(),
            description: input.description.trim(),
          },
        };

  return {
    ...sourcePayload,
    pipeline: input.pipeline,
    automation: input.automation,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.pipeline !== 'trivial' && input.repositoryId
      ? { repositoryId: input.repositoryId }
      : {}),
  };
}

export function labelForPipeline(value: string): string {
  return PIPELINE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForAutomation(value: string): string {
  return AUTOMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
