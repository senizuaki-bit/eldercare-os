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

export const M03_PERMISSIONS = {
  VOICE_SUBMISSION_CREATE: 'voice_submission.create',
  VOICE_SUBMISSION_READ: 'voice_submission.read',
  TRANSCRIPT_READ: 'transcript.read',
  AI_ANALYSIS_READ: 'ai_analysis.read',
  NEED_CREATE: 'need.create',
  NEED_READ: 'need.read',
  NEED_REVIEW: 'need.review',
  WORK_ORDER_CREATE: 'work_order.create',
  WORK_ORDER_READ: 'work_order.read',
  WORK_ORDER_ASSIGN: 'work_order.assign',
  WORK_ORDER_TRANSITION: 'work_order.transition',
  WORK_ORDER_VERIFY: 'work_order.verify',
  WORK_ORDER_CLOSE: 'work_order.close',
  FAMILY_SUMMARY_READ: 'family_summary.read',
  FAMILY_SUMMARY_PUBLISH: 'family_summary.publish',
  RATING_CREATE: 'rating.create',
  RATING_READ: 'rating.read',
} as const;

export type M03Permission = (typeof M03_PERMISSIONS)[keyof typeof M03_PERMISSIONS];
export type Permission = M01Permission | M02Permission | M03Permission | (string & {});
