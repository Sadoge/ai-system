import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Outbound webhooks POST to a URL a tenant supplies, which makes the platform a
 * potential SSRF proxy into its own network: cloud metadata endpoints, internal
 * admin panels, the database. Delivery therefore resolves the host and refuses
 * private, loopback, and link-local destinations unless the operator opts in
 * with WEBHOOK_ALLOW_PRIVATE=true (needed for local development).
 *
 * Honest limitation: the address is resolved shortly before the request, not by
 * the socket itself, so a DNS entry that changes in between is not covered. The
 * check removes the easy case, it is not a substitute for egress rules.
 */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // IPv4-mapped: fall through on the embedded address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Link-local, which is also where cloud instance metadata lives.
  if (a === 169 && b === 254) return true;
  // Carrier-grade NAT and the reserved top block.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export async function assertSafeWebhookTarget(
  rawUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.WEBHOOK_ALLOW_PRIVATE === 'true') return;
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`webhook target ${host} is a private address`);
    return;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) throw new Error(`webhook target ${host} does not resolve`);
  for (const entry of resolved) {
    if (isPrivateAddress(entry.address)) {
      throw new Error(`webhook target ${host} resolves to private address ${entry.address}`);
    }
  }
}
