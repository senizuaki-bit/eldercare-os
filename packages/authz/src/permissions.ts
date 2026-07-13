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

export const M02_PERMISSIONS = {
  FACILITY_DIRECTORY_READ: 'facility.directory.read',
  FACILITY_DIRECTORY_MANAGE: 'facility.directory.manage',
  CARE_LEVEL_READ: 'care_level.read',
  CARE_LEVEL_MANAGE: 'care_level.manage',
  ELDER_CREATE: 'elder.create',
  ELDER_READ_BASIC: 'elder.read.basic',
  ELDER_READ_SENSITIVE: 'elder.read.sensitive',
  ELDER_UPDATE: 'elder.update',
  ELDER_STAY_MANAGE: 'elder.stay.manage',
  ELDER_RELATIONSHIP_MANAGE: 'elder.relationship.manage',
  ELDER_TIMELINE_READ: 'elder.timeline.read',
  CONSENT_MANAGE: 'consent.manage',
  STAFF_READ: 'staff.read',
  STAFF_MANAGE: 'staff.manage',
  SHIFT_READ: 'shift.read',
  SHIFT_MANAGE: 'shift.manage',
} as const;

export type M02Permission = (typeof M02_PERMISSIONS)[keyof typeof M02_PERMISSIONS];
export type Permission = M01Permission | M02Permission | (string & {});
