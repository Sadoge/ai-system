'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiGet, apiPost } from './api';
import {
  buildRunPayload,
  validateRunForm,
  type RunFormInput,
  type RunFormProject,
  type TicketSource,
} from './run-form';

export type StartRunState = {
  status: 'idle' | 'error';
  fieldErrors?: Record<string, string>;
  formError?: string;
};

function readTicketSource(value: FormDataEntryValue | null): TicketSource {
  return value === 'jira' ? 'jira' : 'manual';
}

export async function startRun(
  _prevState: StartRunState,
  formData: FormData,
): Promise<StartRunState> {
  const input: RunFormInput = {
    source: readTicketSource(formData.get('source')),
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    jiraKey: String(formData.get('jiraKey') ?? ''),
    projectId: String(formData.get('projectId') ?? ''),
    repositoryId: String(formData.get('repositoryId') ?? ''),
    pipeline: String(formData.get('pipeline') ?? 'mvp'),
    automation: String(formData.get('automation') ?? 'plan_gated'),
  };

  let projects: RunFormProject[];
  try {
    projects = await apiGet<RunFormProject[]>('/projects');
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'The projects list is unavailable';
    return {
      status: 'error',
      formError: `The run could not be started: ${detail}. Check the API connection and try again.`,
    };
  }

  const { fieldErrors } = validateRunForm(input, { projects });
  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', fieldErrors };
  }

  let result: { runId: string };
  try {
    result = await apiPost<{ runId: string }>('/runs', buildRunPayload(input));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'The API returned an unknown error';
    return {
      status: 'error',
      formError: `The run could not be started: ${detail}. Check the API connection and try again.`,
    };
  }

  revalidatePath('/');
  redirect(`/runs/${result.runId}`);
}

export async function resolveGateAction(formData: FormData): Promise<void> {
  const gateId = String(formData.get('gateId'));
  const decision = String(formData.get('decision'));
  const comment = String(formData.get('comment') ?? '').trim();
  await apiPost(`/gates/${gateId}/resolve`, {
    decision,
    ...(comment ? { comment } : {}),
  });
  revalidatePath('/gates');
  revalidatePath('/');
}

export async function addKnowledgeAction(formData: FormData): Promise<void> {
  await apiPost('/knowledge', {
    kind: String(formData.get('kind')),
    title: String(formData.get('title')),
    content: String(formData.get('content')),
  });
  revalidatePath('/knowledge');
}

export async function decideKnowledgeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('knowledgeItemId'));
  await apiPost(`/knowledge/${id}/decide`, {
    decision: String(formData.get('decision')),
    editedTitle: String(formData.get('editedTitle') ?? '').trim() || undefined,
    editedContent: String(formData.get('editedContent') ?? '').trim() || undefined,
  });
  revalidatePath('/knowledge/inbox');
  revalidatePath('/knowledge');
}

export async function addModelProfileAction(formData: FormData): Promise<void> {
  await apiPost('/model-profiles', {
    purpose: String(formData.get('purpose')),
    provider: String(formData.get('provider')),
    model: String(formData.get('model')),
  });
  revalidatePath('/settings/models');
}

export async function createWebhookAction(formData: FormData): Promise<void> {
  const events = String(formData.get('events') ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  await apiPost('/webhooks', {
    url: String(formData.get('url')),
    description: String(formData.get('description') ?? '').trim(),
    events,
  });
  revalidatePath('/settings/webhooks');
}

export async function setWebhookActiveAction(formData: FormData): Promise<void> {
  const id = String(formData.get('endpointId'));
  await apiPost(`/webhooks/${id}/active`, { active: formData.get('active') === 'true' });
  revalidatePath('/settings/webhooks');
}

export async function redeliverWebhookAction(formData: FormData): Promise<void> {
  const id = String(formData.get('deliveryId'));
  await apiPost(`/webhook-deliveries/${id}/redeliver`, {});
  revalidatePath('/settings/webhooks');
}
