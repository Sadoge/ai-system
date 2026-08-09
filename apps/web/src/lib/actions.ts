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
    ...(jiraKey
      ? { jiraKey }
      : { ticket: { source: 'manual', title, description } }),
    pipeline,
    automation,
  });
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
  await apiPost('/model-profiles', {
    purpose: String(formData.get('purpose')),
    provider: String(formData.get('provider')),
    model: String(formData.get('model')),
  });
  revalidatePath('/settings/models');
}
