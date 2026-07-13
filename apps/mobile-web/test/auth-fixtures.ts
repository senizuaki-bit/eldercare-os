import type { AuthSession, Portal } from '../components/auth-types';

export function createAuthSession(portal: Portal = 'elder'): AuthSession {
  const roleLabel =
    portal === 'elder'
      ? '老人'
      : portal === 'caregiver'
        ? '护工'
        : portal === 'family'
          ? '家属'
          : '平台管理员';
  const userIds: Record<Portal, string> = {
    admin: '00000000-0000-4000-8000-000000000004',
    caregiver: '00000000-0000-4000-8000-000000000002',
    elder: '00000000-0000-4000-8000-000000000001',
    family: '00000000-0000-4000-8000-000000000003'
  };
  const roleKeys: Record<Portal, AuthSession['roles'][number]['key']> = {
    admin: 'PLATFORM_ADMIN',
    caregiver: 'CAREGIVER',
    elder: 'ELDER',
    family: 'FAMILY'
  };

  return {
    activeContext: {
      facilityId: '20000000-0000-4000-8000-000000000001',
      facilityName: '青松院区',
      organizationId: '10000000-0000-4000-8000-000000000001',
      organizationName: '安心照护演示机构'
    },
    availableContexts: [
      {
        facilityId: '20000000-0000-4000-8000-000000000001',
        facilityName: '青松院区',
        organizationId: '10000000-0000-4000-8000-000000000001',
        organizationName: '安心照护演示机构'
      }
    ],
    expiresAt: '2099-07-12T12:00:00.000Z',
    permissions: ['portal.read'],
    portal,
    roles: [{ key: roleKeys[portal], label: roleLabel }],
    user: {
      displayName: portal === 'elder' ? '林安宁' : '虚构测试用户',
      id: userIds[portal],
      username: `${portal}.demo`
    }
  };
}
