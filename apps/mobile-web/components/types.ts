export const roles = ['elder', 'caregiver', 'family'] as const;

export type Role = (typeof roles)[number];

export type DemoMode = 'normal' | 'loading' | 'empty' | 'error' | 'forbidden' | 'offline' | 'stale';

export const roleLabels: Record<Role, string> = {
  caregiver: '护工端',
  elder: '老人端',
  family: '家属端'
};

export const sectionsByRole: Record<Role, readonly string[]> = {
  caregiver: ['home', 'tasks', 'handover', 'profile'],
  elder: ['home', 'schedule', 'family', 'profile'],
  family: ['home', 'events', 'services', 'profile']
};

export function isRole(value: string): value is Role {
  return roles.some((role) => role === value);
}

export function isRoleSection(role: Role, value: string): boolean {
  return sectionsByRole[role].includes(value);
}
