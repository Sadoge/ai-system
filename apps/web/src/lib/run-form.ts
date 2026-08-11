export type TicketSource = 'manual' | 'jira';

// Jira instances are the authority on project-key policy. Keep this check
// deliberately permissive while still rejecting obviously malformed input.
export const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

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

  if (context.projects.length === 0) {
    fieldErrors.projectId = 'Create a project before starting a run.';
  } else if (input.projectId.trim().length === 0) {
    fieldErrors.projectId = 'Select a project.';
  }

  const selectedProject = context.projects.find((project) => project.id === input.projectId);
  if (input.projectId && !selectedProject) {
    fieldErrors.projectId = 'This project is no longer available. Choose another project.';
  }

  if (selectedProject) {
    const repositoryId = input.repositoryId.trim();
    if (
      repositoryId &&
      !selectedProject.repositories.some((repository) => repository.id === repositoryId)
    ) {
      fieldErrors.repositoryId = 'This repository does not belong to the selected project.';
    } else if (input.pipeline !== 'trivial' && selectedProject.repositories.length === 0) {
      fieldErrors.repositoryId = 'Register a repository for this project before using this pipeline.';
    } else if (
      input.pipeline !== 'trivial' &&
      selectedProject.repositories.length > 1 &&
      repositoryId.length === 0
    ) {
      fieldErrors.repositoryId = 'Select a repository for this pipeline.';
    }
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
    ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
  };
}

export function labelForPipeline(value: string): string {
  return PIPELINE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function labelForAutomation(value: string): string {
  return AUTOMATION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
