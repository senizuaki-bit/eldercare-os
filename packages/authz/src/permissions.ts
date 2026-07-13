export const M01_PERMISSIONS = {
  SESSION_SELF_READ: 'session.self.read',
  SESSION_SELF_MANAGE: 'session.self.manage',
  ORGANIZATION_READ: 'organization.read',
  FACILITY_READ: 'facility.read',
  USER_READ: 'identity.user.read',
  ROLE_READ: 'identity.role.read',
  ACCESS_ASSIGNMENT_MANAGE: 'identity.access.manage',
  AUDIT_READ: 'audit.read',
} as const;

export type M01Permission = (typeof M01_PERMISSIONS)[keyof typeof M01_PERMISSIONS];
export type Permission = string;
