'use server';

import { revalidatePath } from 'next/cache';
import { apiPost } from './api';

export async function startRunAction(formData: FormData): Promise<void> {
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const pipeline = String(formData.get('pipeline') ?? 'mvp');
  const automation = String(formData.get('automation') ?? 'plan_gated');
  const jiraKey = String(formData.get('jiraKey') ?? '').trim();

  await apiPost('/runs', {
    ...(jiraKey ? { jiraKey } : { ticket: { source: 'manual', title, description } }),
    pipeline,
    automation,
  });
  revalidatePath('/');
}

export async function retryRunAction(formData: FormData): Promise<void> {
  const runId = String(formData.get('runId'));
  await apiPost(`/runs/${runId}/retry`, {});
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
