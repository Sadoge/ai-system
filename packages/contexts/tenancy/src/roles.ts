/**
 * Roles are ordered: every role can do everything the roles below it can.
 * Keeping this a total order avoids a permission matrix nobody can reason
 * about, and matches how small engineering orgs actually work.
 */
export const ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'run:read',
  'run:start',
  'run:cancel',
  'gate:decide',
  'knowledge:read',
  'knowledge:write',
  'knowledge:approve',
  'settings:read',
  'settings:write',
  'org:admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The minimum role that grants each permission. */
const REQUIRED_ROLE: Record<Permission, Role> = {
  'run:read': 'viewer',
  'knowledge:read': 'viewer',
  'settings:read': 'viewer',
  'run:start': 'member',
  'run:cancel': 'member',
  // Approving a gate or knowledge is a judgement call with consequences —
  // deliberately above plain membership.
  'gate:decide': 'member',
  'knowledge:write': 'member',
  'knowledge:approve': 'admin',
  'settings:write': 'admin',
  'org:admin': 'owner',
};

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return roleRank(role) >= roleRank(REQUIRED_ROLE[permission]);
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly permission: Permission,
    public readonly role: Role,
  ) {
    super(`role "${role}" lacks permission "${permission}"`);
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new PermissionDeniedError(permission, role);
}
