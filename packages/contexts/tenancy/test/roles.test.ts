import { describe, expect, it } from 'vitest';
import { PermissionDeniedError, ROLES, assertCan, can, isRole } from '../src/roles.js';
import { hashApiKey } from '../src/principal.js';
import { RateLimiter } from '../src/quotas.js';
import { auditToCsv } from '../src/audit.js';

describe('roles', () => {
  it('grants read to everyone and org admin only to owners', () => {
    for (const role of ROLES) expect(can(role, 'run:read')).toBe(true);
    expect(can('owner', 'org:admin')).toBe(true);
    expect(can('admin', 'org:admin')).toBe(false);
  });

  it('keeps approval above plain membership', () => {
    expect(can('member', 'knowledge:write')).toBe(true);
    expect(can('member', 'knowledge:approve')).toBe(false);
    expect(can('admin', 'knowledge:approve')).toBe(true);
  });

  it('does not let a viewer start or gate a run', () => {
    expect(can('viewer', 'run:start')).toBe(false);
    expect(can('viewer', 'gate:decide')).toBe(false);
    expect(() => assertCan('viewer', 'run:start')).toThrow(PermissionDeniedError);
  });

  it('is monotonic: a higher role can do everything a lower one can', () => {
    const permissions = ['run:read', 'run:start', 'gate:decide', 'knowledge:approve', 'settings:write'] as const;
    for (const permission of permissions) {
      let seenAllowed = false;
      for (const role of ROLES) {
        const allowed = can(role, permission);
        if (seenAllowed) expect(allowed).toBe(true);
        if (allowed) seenAllowed = true;
      }
    }
  });

  it('rejects unknown role strings', () => {
    expect(isRole('member')).toBe(true);
    expect(isRole('superuser')).toBe(false);
  });
});

describe('api key hashing', () => {
  it('is deterministic and does not echo the plaintext', () => {
    const key = 'ais_secret-value';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain('secret');
    expect(hashApiKey(key)).toHaveLength(64);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit, then refuses', () => {
    const limiter = new RateLimiter(3);
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, true]);
    expect(limiter.take('a')).toBe(false);
    // Buckets are per key, so one tenant cannot starve another.
    expect(limiter.take('b')).toBe(true);
  });

  it('treats a non-positive limit as unlimited', () => {
    const limiter = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(limiter.take('a')).toBe(true);
  });
});

describe('auditToCsv', () => {
  it('escapes quotes so a crafted payload cannot break the CSV', () => {
    const csv = auditToCsv([
      {
        id: '1',
        organizationId: 'o',
        actorType: 'user',
        actorId: 'u',
        action: 'gate.decide',
        subjectType: 'gate_request',
        subjectId: 'g',
        data: { comment: 'he said "ship it"' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ] as never);
    expect(csv.split('\n')).toHaveLength(2);
    // The real invariant: the escaped field parses back to the original data,
    // so a crafted comment cannot inject a column or a row.
    const row = csv.split('\n')[1]!;
    const field = row.slice(row.indexOf(',"') + 1);
    expect(JSON.parse(field.slice(1, -1).replaceAll('""', '"'))).toEqual({
      comment: 'he said "ship it"',
    });
  });
});
