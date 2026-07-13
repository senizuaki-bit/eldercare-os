export const ROLE_CODES = [
  'PLATFORM_ADMIN',
  'ORG_ADMIN',
  'FACILITY_DIRECTOR',
  'NURSING_SUPERVISOR',
  'CAREGIVER',
  'CLINICAL_STAFF',
  'DEVICE_MANAGER',
  'CONTENT_EDITOR',
  'ACTIVITY_COORDINATOR',
  'SERVICE_OPERATOR',
  'PROVIDER_STAFF',
  'FINANCE_VIEWER',
  'ELDER',
  'FAMILY',
] as const;

export type Role = (typeof ROLE_CODES)[number];

export function isRole(value: string): value is Role {
  return (ROLE_CODES as readonly string[]).includes(value);
}
