export const roles = ['elder', 'caregiver', 'family'] as const;

export type Role = (typeof roles)[number];

export type DemoMode = 'normal' | 'loading' | 'empty' | 'error' | 'forbidden' | 'offline' | 'stale';

export const roleLabels: Record<Role, string> = {
  caregiver: '护工端',
  elder: '老人端',
  family: '家属端'
};

export const sectionsByRole: Record<Role, readonly string[]> = {
  caregiver: ['home', 'emergencies', 'tasks', 'handover', 'profile'],
  elder: ['home', 'emergency', 'voice-request', 'schedule', 'family', 'profile'],
  family: ['home', 'events', 'services', 'profile']
};

const detailSectionsByRole: Record<Role, readonly string[]> = {
  caregiver: ['emergencies', 'tasks'],
  elder: ['emergency', 'voice-request'],
  family: []
};

export function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}

export function isRoleSection(role: Role, value: string): boolean {
  return sectionsByRole[role].includes(value);
}

export function isRoleSectionPath(role: Role, values: readonly string[]): boolean {
  const [section, detailId] = values;
  if (!section || !isRoleSection(role, section)) return false;
  if (values.length === 1) return true;
  if (values.length !== 2 || !detailId || !detailSectionsByRole[role].includes(section)) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(detailId);
}
