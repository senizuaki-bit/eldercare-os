import type {
  AdminRoleSummary,
  AdminUserSummary,
  AuthSession,
  PaginatedResponse
} from '../lib/auth-contract';

export const organizationId = '00000000-0000-4000-8000-000000000001';
export const qinglanFacilityId = '00000000-0000-4000-8000-000000000101';
export const haitangFacilityId = '00000000-0000-4000-8000-000000000102';

export const authSessionFixture: AuthSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000201',
    username: 'supervisor.demo',
    displayName: '林主管（虚构）'
  },
  activeContext: {
    organizationId,
    organizationName: '青岚照护集团（演示）',
    facilityId: qinglanFacilityId,
    facilityName: '青岚院区（演示）'
  },
  availableContexts: [
    {
      organizationId,
      organizationName: '青岚照护集团（演示）',
      facilityId: qinglanFacilityId,
      facilityName: '青岚院区（演示）'
    },
    {
      organizationId,
      organizationName: '青岚照护集团（演示）',
      facilityId: haitangFacilityId,
      facilityName: '海棠院区（演示）'
    }
  ],
  roles: [{ key: 'NURSING_SUPERVISOR', label: '护理主管' }],
  permissions: ['identity.user.read', 'identity.role.read'],
  portal: 'admin',
  expiresAt: '2026-07-13T12:00:00.000Z'
};

export const switchedAuthSessionFixture: AuthSession = {
  ...authSessionFixture,
  activeContext: authSessionFixture.availableContexts[1]!
};

export const usersFixture: PaginatedResponse<AdminUserSummary> = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000202',
      loginName: 'caregiver.demo',
      displayName: '陈护工（虚构）',
      status: 'ACTIVE',
      lastLoginAt: '2026-07-13T01:30:00.000Z',
      accessVersion: 3,
      assignments: [
        {
          id: '00000000-0000-4000-8000-000000000401',
          organizationId,
          role: {
            id: '00000000-0000-4000-8000-000000000302',
            code: 'CAREGIVER',
            name: '护工',
            description: '执行当前院区已分配的照护任务。',
            isSystem: true,
            permissions: ['session.self.read']
          },
          scopes: [
            {
              id: '00000000-0000-4000-8000-000000000501',
              kind: 'FACILITY',
              scopeKey: `facility:${qinglanFacilityId}`,
              organizationId,
              facilityId: qinglanFacilityId,
              resourceType: null,
              resourceId: null,
              validFrom: '2026-07-01T00:00:00.000Z',
              validUntil: null
            },
            {
              id: '00000000-0000-4000-8000-000000000502',
              kind: 'ASSIGNED_ELDER',
              scopeKey: 'assigned-elder',
              organizationId,
              facilityId: qinglanFacilityId,
              resourceType: 'ELDER',
              resourceId: 'elder-demo-01',
              validFrom: '2026-07-01T00:00:00.000Z',
              validUntil: null
            },
            {
              id: '00000000-0000-4000-8000-000000000503',
              kind: 'ACTIVE_SHIFT',
              scopeKey: 'active-shift',
              organizationId,
              facilityId: qinglanFacilityId,
              resourceType: 'SHIFT',
              resourceId: 'shift-demo-01',
              validFrom: '2026-07-13T00:00:00.000Z',
              validUntil: '2026-07-13T08:00:00.000Z'
            }
          ],
          activeFrom: '2026-07-01T00:00:00.000Z',
          expiresAt: null
        }
      ]
    }
  ],
  pageInfo: {
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1
  }
};

export const rolesFixture: PaginatedResponse<AdminRoleSummary> = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      code: 'NURSING_SUPERVISOR',
      name: '护理主管',
      description: '负责院区护理任务分配与复核。',
      isSystem: true,
      permissions: ['identity.user.read', 'identity.role.read', 'identity.access.manage'],
      assignedUserCount: 2,
      scopeKinds: ['FACILITY', 'CARE_TEAM']
    }
  ],
  pageInfo: {
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1
  }
};
