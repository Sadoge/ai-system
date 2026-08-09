import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CompleteRequest, ModelGateway, ResolvedProfile } from '@ai-system/model-gateway';

const INVALID_OUTPUT_RETRIES = 2;

export class InvalidAgentOutputError extends Error {
  constructor(
    public readonly purpose: string,
    public readonly attempts: number,
    public readonly lastErrors: string,
  ) {
    super(`agent ${purpose} produced invalid output after ${attempts} attempts: ${lastErrors}`);
  }
}

/**
 * Single-call agent runner (docs/06 §5): prompt in, schema-validated JSON out.
 * On validation failure the errors are appended and the call retried (max 2);
 * after that the stage fails with a typed invalid_output — never a silent
 * acceptance of malformed output.
 */
export async function runJsonAgent<S extends z.ZodTypeAny>(
  gateway: ModelGateway,
  profile: ResolvedProfile,
  input: {
    system: string;
    user: string;
    schema: S;
    meta: CompleteRequest['meta'];
  },
): Promise<z.infer<S>> {
  const jsonSchema = JSON.stringify(zodToJsonSchema(input.schema), null, 0);
  const baseSystem = `${input.system}\n\nRespond with a single JSON object matching this JSON Schema, and nothing else (no markdown fences, no prose):\n${jsonSchema}`;

  let lastErrors = '';
  for (let attempt = 0; attempt <= INVALID_OUTPUT_RETRIES; attempt++) {
    const user =
      attempt === 0
        ? input.user
        : `${input.user}\n\nYour previous response was invalid:\n${lastErrors}\nReturn ONLY a corrected JSON object.`;
    const result = await gateway.complete(profile, {
      system: baseSystem,
      messages: [{ role: 'user', content: user }],
      meta: input.meta,
    });
    const parsed = tryParse(result.text, input.schema);
    if (parsed.ok) return parsed.value;
    lastErrors = parsed.errors;
  }
  throw new InvalidAgentOutputError(input.meta.purpose, INVALID_OUTPUT_RETRIES + 1, lastErrors);
}

function tryParse<S extends z.ZodTypeAny>(
  text: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; errors: string } {
  const candidate = extractJson(text);
  if (candidate === null) return { ok: false, errors: 'no JSON object found in response' };
  const result = schema.safeParse(candidate);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: JSON.stringify(result.error.issues) };
}

function extractJson(text: string): unknown | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
