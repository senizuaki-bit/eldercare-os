import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/auth.types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { M02FacilityContext } from '../m02/m02-context.js';
import { AdminCurrentAccessService } from './admin-current-access.service.js';
import { TaskUpdatesService } from './task-updates.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = '30000000-0000-4000-8000-000000000001';

describe('AdminCurrentAccessService', () => {
  it('suppresses events after current permission, scope, user or facility access is revoked', async () => {
    const state = {
      facilityActive: true,
      permissionActive: true,
      scopeActive: true,
      userActive: true,
    };
    const userQueries: unknown[] = [];
    const userFindFirst = vi.fn((query: unknown) => {
      userQueries.push(query);
      return Promise.resolve(
        state.permissionActive && state.scopeActive && state.userActive ? { id: USER_ID } : null,
      );
    });
    const facilityQueries: unknown[] = [];
    const facilityFindFirst = vi.fn((query: unknown) => {
      facilityQueries.push(query);
      return Promise.resolve(state.facilityActive ? { id: FACILITY_ID } : null);
    });
    const access = new AdminCurrentAccessService({
      client: {
        facility: { findFirst: facilityFindFirst },
        user: { findFirst: userFindFirst },
      },
    } as unknown as DatabaseService);
    const updates = new TaskUpdatesService();
    const received: string[] = [];
    const subscription = updates.forFacility(
      ORGANIZATION_ID,
      FACILITY_ID,
      () => access.canReadFacilityWorkOrders(context, session),
    ).subscribe((event) => received.push(event.eventId));

    updates.publish(scopedUpdate('authorized'));
    await vi.waitFor(() => expect(received).toEqual(['authorized']));

    let expectedFacilityChecks = 1;
    for (const revoked of [
      'permissionActive',
      'scopeActive',
      'userActive',
      'facilityActive',
    ] as const) {
      state[revoked] = false;
      updates.publish(scopedUpdate(`revoked-${revoked}`));
      expectedFacilityChecks += 1;
      await vi.waitFor(() => expect(facilityFindFirst).toHaveBeenCalledTimes(expectedFacilityChecks));
      state[revoked] = true;
    }

    subscription.unsubscribe();
    expect(received).toEqual(['authorized']);
    expect(facilityFindFirst).toHaveBeenCalledTimes(5);
    expect(userFindFirst).toHaveBeenCalledTimes(4);

    const facilityQuery = facilityQueries[0];
    expect(facilityQuery).toMatchObject({
      where: {
        id: FACILITY_ID,
        organizationId: ORGANIZATION_ID,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { id: true },
    });

    const query = userQueries[0];
    expect(query).toMatchObject({
      where: {
        id: USER_ID,
        status: 'ACTIVE',
        userRoles: {
          some: {
            revokedAt: null,
            role: {
              rolePermissions: {
                some: { permission: { code: 'work_order.read' } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    const serializedQuery = JSON.stringify(query);
    expect(serializedQuery).toContain('dataScopes');
    expect(serializedQuery).toContain('PLATFORM');
    expect(serializedQuery).toContain('ORGANIZATION');
    expect(serializedQuery).toContain('FACILITY');
    expect(serializedQuery).toContain(FACILITY_ID);
  });

  it('allows a current platform-scoped role assignment outside the target organization', async () => {
    const facilityFindFirst = vi.fn((query: unknown) => {
      void query;
      return Promise.resolve({ id: FACILITY_ID });
    });
    const userQueries: unknown[] = [];
    const userFindFirst = vi.fn((query: unknown) => {
      userQueries.push(query);
      return Promise.resolve({ id: USER_ID });
    });
    const access = new AdminCurrentAccessService({
      client: {
        facility: { findFirst: facilityFindFirst },
        user: { findFirst: userFindFirst },
      },
    } as unknown as DatabaseService);

    await expect(access.canReadFacilityWorkOrders(context, session)).resolves.toBe(true);
    const roleFilter = (userQueries[0] as {
      where: { userRoles: { some: Record<string, unknown> } };
    }).where.userRoles.some;
    expect(roleFilter).not.toHaveProperty('organizationId');
    expect(scopeBranchesFrom(userQueries[0])).toContainEqual({ kind: 'PLATFORM' });
  });

  it('rejects an organization scope from a different organization', async () => {
    const facilityFindFirst = vi.fn((query: unknown) => {
      void query;
      return Promise.resolve({ id: FACILITY_ID });
    });
    const userQueries: unknown[] = [];
    const userFindFirst = vi.fn((query: unknown) => {
      userQueries.push(query);
      return Promise.resolve(null);
    });
    const access = new AdminCurrentAccessService({
      client: {
        facility: { findFirst: facilityFindFirst },
        user: { findFirst: userFindFirst },
      },
    } as unknown as DatabaseService);

    await expect(access.canReadFacilityWorkOrders(context, session)).resolves.toBe(false);
    const scopeBranches = scopeBranchesFrom(userQueries[0]);
    expect(scopeBranches).toContainEqual({
      kind: 'ORGANIZATION',
      organizationId: ORGANIZATION_ID,
    });
    expect(scopeBranches).not.toContainEqual({ kind: 'ORGANIZATION' });
  });
});

function scopeBranchesFrom(query: unknown): unknown[] {
  return (query as {
    where: {
      userRoles: {
        some: {
          AND: [unknown, { dataScopes: { some: { AND: [unknown, { OR: unknown[] }] } } }];
        };
      };
    };
  }).where.userRoles.some.AND[1].dataScopes.some.AND[1].OR;
}

function scopedUpdate(eventId: string) {
  return {
    organizationId: ORGANIZATION_ID,
    facilityId: FACILITY_ID,
    elderId: '40000000-0000-4000-8000-000000000001',
    workOrderId: '50000000-0000-4000-8000-000000000001',
    assigneeStaffProfileId: null,
    targetTeamId: null,
    event: {
      eventId,
      eventType: 'WORK_ORDER.ASSIGNED' as const,
      workOrderId: '50000000-0000-4000-8000-000000000001',
      status: 'ASSIGNED' as const,
      version: 2,
      occurredAt: '2026-07-22T08:00:00.000Z',
    },
  };
}

const context: M02FacilityContext = {
  organizationId: ORGANIZATION_ID,
  facilityId: FACILITY_ID,
  correlationId: 'admin-sse-current-access-test',
};

const session: AuthenticatedSession = {
  id: 'admin-sse-session',
  userId: USER_ID,
  csrfTokenHash: 'csrf-hash',
  tokenHash: 'token-hash',
  principal: {
    user: { id: USER_ID, username: 'admin.test', displayName: 'Admin Test' },
    activeContext: {
      organizationId: ORGANIZATION_ID,
      organizationName: 'Test Organization',
      facilityId: FACILITY_ID,
      facilityName: 'Test Facility',
    },
    availableContexts: [],
    roles: [{ key: 'FACILITY_DIRECTOR', label: 'Facility Director' }],
    permissions: ['work_order.read'],
    portal: 'admin',
    expiresAt: '2026-07-22T09:00:00.000Z',
  },
};
