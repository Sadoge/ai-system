import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_OPTIONS,
  PIPELINE_OPTIONS,
  buildRunPayload,
  labelForAutomation,
  labelForPipeline,
  normalizeJiraKey,
  validateRunForm,
  type RunFormInput,
  type RunFormProject,
} from './run-form';

const projects: RunFormProject[] = [
  {
    id: 'project-1',
    name: 'Conductor',
    repositories: [
      { id: 'repo-1', name: 'Web' },
      { id: 'repo-2', name: 'API' },
    ],
  },
];

function input(overrides: Partial<RunFormInput> = {}): RunFormInput {
  return {
    source: 'manual',
    title: 'Add retry logic',
    description: 'Retry failed webhook deliveries.',
    jiraKey: '',
    projectId: 'project-1',
    repositoryId: 'repo-1',
    pipeline: 'mvp',
    automation: 'plan_gated',
    ...overrides,
  };
}

describe('validateRunForm', () => {
  it('requires a non-empty title for a manual ticket', () => {
    expect(validateRunForm(input({ title: '   ' })).fieldErrors.title).toBeTruthy();
    expect(validateRunForm(input()).fieldErrors.title).toBeUndefined();
  });

  it('requires a valid-looking Jira key', () => {
    expect(
      validateRunForm(input({ source: 'jira', jiraKey: '' })).fieldErrors.jiraKey,
    ).toBeTruthy();
    expect(
      validateRunForm(input({ source: 'jira', jiraKey: 'proj-123' })).fieldErrors.jiraKey,
    ).toBeUndefined();
    expect(
      validateRunForm(input({ source: 'jira', jiraKey: 'not a key' })).fieldErrors.jiraKey,
    ).toBeTruthy();
    expect(
      validateRunForm(input({ source: 'jira', jiraKey: 'ab_c-12' })).fieldErrors.jiraKey,
    ).toBeUndefined();
  });

  it('requires a project when none exist', () => {
    expect(validateRunForm(input({ projectId: '' })).fieldErrors.projectId).toBeTruthy();
  });

  it('requires a project when projects exist', () => {
    expect(
      validateRunForm(input({ projectId: '' }), { projects }).fieldErrors.projectId,
    ).toBeTruthy();
  });

  it('requires a repository for a non-trivial pipeline with multiple repositories', () => {
    expect(
      validateRunForm(input({ repositoryId: '' }), { projects }).fieldErrors.repositoryId,
    ).toBeTruthy();
    expect(
      validateRunForm(input({ repositoryId: '', pipeline: 'trivial' }), { projects }).fieldErrors
        .repositoryId,
    ).toBeUndefined();
  });

  it('rejects a repository outside the selected project', () => {
    expect(
      validateRunForm(input({ repositoryId: 'repo-from-another-project' }), { projects }).fieldErrors
        .repositoryId,
    ).toBeTruthy();
  });

  it('rejects a project that is no longer available', () => {
    expect(
      validateRunForm(input({ projectId: 'deleted-project' }), { projects }).fieldErrors.projectId,
    ).toBeTruthy();
  });
});

describe('normalizeJiraKey', () => {
  it('trims and uppercases a key', () => {
    expect(normalizeJiraKey('  proj-123 ')).toBe('PROJ-123');
  });
});

describe('buildRunPayload', () => {
  it('excludes a stale Jira key from a manual payload', () => {
    const payload = buildRunPayload(input({ jiraKey: 'PROJ-123' }));
    expect(payload).not.toHaveProperty('jiraKey');
    expect(payload).toHaveProperty('ticket.title', 'Add retry logic');
  });

  it('excludes stale manual fields from a Jira payload', () => {
    const payload = buildRunPayload(input({ source: 'jira', jiraKey: ' proj-123 ' }));
    expect(payload).not.toHaveProperty('ticket');
    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('description');
    expect(payload).toHaveProperty('jiraKey', 'PROJ-123');
  });

  it('keeps an explicitly selected repository for a trivial run', () => {
    expect(buildRunPayload(input({ pipeline: 'trivial', repositoryId: 'repo-1' }))).toHaveProperty(
      'repositoryId',
      'repo-1',
    );
  });

  it('includes API-supported project and repository targeting', () => {
    expect(buildRunPayload(input())).toMatchObject({
      projectId: 'project-1',
      repositoryId: 'repo-1',
    });
  });

  it.each(PIPELINE_OPTIONS)('passes pipeline value $value through unchanged', ({ value }) => {
    expect(buildRunPayload(input({ pipeline: value })).pipeline).toBe(value);
  });

  it.each(AUTOMATION_OPTIONS)('passes automation value $value through unchanged', ({ value }) => {
    expect(buildRunPayload(input({ automation: value })).automation).toBe(value);
  });
});

describe('display labels', () => {
  it('maps known values and falls back safely for enum drift', () => {
    expect(labelForPipeline('mvp')).toBe('MVP');
    expect(labelForAutomation('plan_gated')).toBe('Plan-gated');
    expect(labelForPipeline('future_pipeline')).toBe('future_pipeline');
    expect(labelForAutomation('future_automation')).toBe('future_automation');
  });
});
