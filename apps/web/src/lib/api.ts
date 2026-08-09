// Server-side API client. The token stays on the Next server — the browser
// never sees it (single-user auth, docs/10 MVP delivery).

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const API_TOKEN = process.env.API_TOKEN;

function headers(): HeadersInit {
  return {
    'content-type': 'application/json',
    ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {}),
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function apiStreamUrl(runId: string): string {
  return `${API_URL}/api/runs/${runId}/stream`;
}

// ── shapes the UI consumes (mirrors the API's responses) ──────────────

export interface RunSummary {
  id: string;
  status: string;
  currentStage: string | null;
  complexity: string | null;
  iterationCount: number;
  ticket: { title: string; source: string; externalKey?: string };
  policySnapshot: { pipeline: string; automationLevel: string };
  createdAt: string;
  updatedAt: string;
}

export interface RunDetail extends RunSummary {
  error: string | null;
  stages: {
    id: string;
    stage: string;
    status: string;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  }[];
  artifacts: { id: string; kind: string; contentHash: string; createdAt: string }[];
  findings: {
    id: string;
    severity: string;
    category: string;
    title: string;
    detail: string;
    status: string;
  }[];
  gates: { id: string; gate: string; status: string; payload: Record<string, unknown>; createdAt: string }[];
  costUsd: number;
  tasks: {
    id: string;
    title: string;
    status: string;
    origin: string;
    attemptCount: number;
    maxAttempts: number;
    branch: string | null;
    error: string | null;
    dependsOn: string[];
  }[];
}

export interface GateRow {
  id: string;
  runId: string;
  gate: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  origin: string;
  status: string;
  createdAt: string;
}

export interface ModelProfileRow {
  id: string;
  purpose: string;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  fallbacks: { provider: string; model: string }[];
  projectId: string | null;
  organizationId: string | null;
}
