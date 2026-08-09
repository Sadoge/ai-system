import { describe, expect, it } from 'vitest';
import {
  generateWebhookSecret,
  isPrivateAddress,
  signPayload,
  verifySignature,
} from '../src/index.js';

describe('signPayload', () => {
  it('is stable for the same input and binds the timestamp', () => {
    const body = JSON.stringify({ event: 'run.completed' });
    const a = signPayload('whsec_test', '1700000000', body);
    expect(a).toBe(signPayload('whsec_test', '1700000000', body));
    // A replay with a different timestamp cannot reuse the signature.
    expect(a).not.toBe(signPayload('whsec_test', '1700000001', body));
    expect(a).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it('verifies only with the right secret, timestamp, and body', () => {
    const body = '{"a":1}';
    const signature = signPayload('secret-a', '100', body);
    expect(verifySignature('secret-a', '100', body, signature)).toBe(true);
    expect(verifySignature('secret-b', '100', body, signature)).toBe(false);
    expect(verifySignature('secret-a', '101', body, signature)).toBe(false);
    expect(verifySignature('secret-a', '100', '{"a":2}', signature)).toBe(false);
  });

  it('mints distinct prefixed secrets', () => {
    const a = generateWebhookSecret();
    expect(a.startsWith('whsec_')).toBe(true);
    expect(a).not.toBe(generateWebhookSecret());
  });
});

describe('isPrivateAddress', () => {
  it('blocks loopback, private ranges, and cloud metadata', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // instance metadata
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
