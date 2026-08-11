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

  let runId: string;
  try {
    const result = await apiPost<{ runId?: unknown }>('/runs', buildRunPayload(input));
    if (typeof result.runId !== 'string' || result.runId.length === 0) {
      return {
        status: 'error',
        formError:
          'The run may have started, but the API did not return its identifier. Check the API response before starting another run.',
      };
    }
    runId = result.runId;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'The API returned an unknown error';
    return {
      status: 'error',
      formError: `The run could not be started: ${detail}. Check the API connection and try again.`,
    };
  }

  revalidatePath('/');
  redirect(`/runs/${runId}`);
}

export async function retryRunAction(formData: FormData): Promise<void> {
  const runId = String(formData.get('runId'));
  await apiPost(`/runs/${runId}/retry`, {});
  revalidatePath(`/runs/${runId}`);
  revalidatePath('/');
}

export async function stopRunAction(runId: string): Promise<void> {
  await apiPost(`/runs/${runId}/cancel`, { reason: 'Stopped from the run view' });
  revalidatePath(`/runs/${runId}`);
  revalidatePath('/');
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
  const effort = String(formData.get('reasoningEffort') ?? '').trim();
  const fallbackProvider = String(formData.get('fallbackProvider') ?? '').trim();
  const fallbackEffort = String(formData.get('fallbackEffort') ?? '').trim();
  const projectId = String(formData.get('projectId') ?? '').trim();
  await apiPost('/model-profiles', {
    purpose: String(formData.get('purpose')),
    provider: String(formData.get('provider')),
    model: String(formData.get('model') ?? '').trim() || 'default',
    params: effort ? { reasoningEffort: effort } : {},
    fallbacks: fallbackProvider
      ? [
          {
            provider: fallbackProvider,
            model: String(formData.get('fallbackModel') ?? '').trim() || 'default',
            params: fallbackEffort ? { reasoningEffort: fallbackEffort } : {},
          },
        ]
      : [],
    ...(projectId ? { projectId } : {}),
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
