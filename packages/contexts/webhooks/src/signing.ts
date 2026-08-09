import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-ai-system-signature';
export const TIMESTAMP_HEADER = 'x-ai-system-timestamp';
export const EVENT_HEADER = 'x-ai-system-event';
export const DELIVERY_HEADER = 'x-ai-system-delivery';

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * `v1=<hex hmac-sha256(secret, "<timestamp>.<body>")>`.
 *
 * The timestamp is inside the signed string, so a captured delivery cannot be
 * replayed later against a receiver that enforces a freshness window — signing
 * the body alone would leave replay wide open.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `v1=${mac}`;
}

/** Constant-time comparison — receivers should verify exactly this way. */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
