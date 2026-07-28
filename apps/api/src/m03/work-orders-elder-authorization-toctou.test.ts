import type { AuthenticatedSession } from '../auth/auth.types.js';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import type { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const USER_ID = '30000000-0000-4000-8000-000000000001';
const ELDER_ID = '40000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '50000000-0000-4000-8000-000000000001';

type Revocation =
  | 'USER_DISABLED'
  | 'FACILITY_DISABLED'
  | 'PERMISSION_REMOVED'
  | 'OWN_SCOPE_REPLACED'
  | 'PORTAL_UNBOUND'
  | 'ELDER_DISCHARGED';

const revocations: readonly Revocation[] = [
  'USER_DISABLED',
  'FACILITY_DISABLED',
  'PERMISSION_REMOVED',
  'OWN_SCOPE_REPLACED',
  'PORTAL_UNBOUND',
  'ELDER_DISCHARGED',
];

describe('WorkOrdersService elder-owned transaction authorization', () => {
  it.each(revocations)('denies verify with zero effects when %s after preflight', async (revocation) => {
    const fixture = elderMutationFixture(revocation);
    fixture.elderAccessAssert.mockImplementation(() => {
      fixture.revoke();
      return Promise.resolve({});
    });

    await expect(fixture.service.verifyElder(
      context,
      WORK_ORDER_ID,
      { expectedVersion: 6, targetStatus: 'VERIFIED', reasonCode: 'ELDER_CONFIRMED' },
      session,
    )).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND' });

    expect(fixture.elderAccessAssert).toHaveBeenCalledOnce();
    expect(fixture.transaction).toHaveBeenCalledOnce();
    expect(fixture.workOrderUpdate).not.toHaveBeenCalled();
    expect(fixture.completionRead).not.toHaveBeenCalled();
    expect(fixture.summaryWrite).not.toHaveBeenCalled();
    expect(fixture.transitionWrite).not.toHaveBeenCalled();
    expect(fixture.ratingWrite).not.toHaveBeenCalled();
    expect(fixture.mutationRecord).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it.each(revocations)('denies rating with zero effects when %s after preflight', async (revocation) => {
    const fixture = elderMutationFixture(revocation);
    const preflight = vi.fn(() => {
      fixture.revoke();
      return Promise.resolve({ id: ELDER_ID });
    });
    Object.defineProperty(fixture.service, 'elderForSession', { value: preflight });

    await expect(fixture.service.rateElder(
      context,
      WORK_ORDER_ID,
      {
        expectedWorkOrderVersion: 7,
        idempotencyKey: `rating-after-${revocation.toLowerCase()}`,
        requiresFollowUp: false,
        score: 5,
      },
      session,
    )).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND' });

    expect(preflight).toHaveBeenCalledOnce();
    expect(fixture.transaction).toHaveBeenCalledOnce();
    expect(fixture.ratingRead).not.toHaveBeenCalled();
    expect(fixture.ratingWrite).not.toHaveBeenCalled();
    expect(fixture.workOrderUpdate).not.toHaveBeenCalled();
    expect(fixture.summaryWrite).not.toHaveBeenCalled();
    expect(fixture.transitionWrite).not.toHaveBeenCalled();
    expect(fixture.mutationRecord).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('queries the current exact elder role, permission, own scope, binding, stay, and facility', async () => {
    const fixture = elderMutationFixture('OWN_SCOPE_REPLACED');
    fixture.revoke();
    Object.defineProperty(fixture.service, 'elderForSession', {
      value: vi.fn(() => Promise.resolve({ id: ELDER_ID })),
    });

    await expect(fixture.service.rateElder(
      context,
      WORK_ORDER_ID,
      {
        expectedWorkOrderVersion: 7,
        idempotencyKey: 'rating-current-auth-shape',
        requiresFollowUp: false,
        score: 5,
      },
      session,
    )).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND' });

    expect(JSON.stringify(fixture.roleRead.mock.calls[0]?.[0])).toContain('rating.create');
    expect(JSON.stringify(fixture.roleRead.mock.calls[0]?.[0])).toContain('OWN_RECORD');
    const elderQuery = fixture.elderRead.mock.calls[0]?.[0] as {
      where: {
        stays: {
          some: {
            admittedAt: { lte: Date };
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: Date } }];
          };
        };
      };
    };
    expect(elderQuery).toMatchObject({
      where: {
        id: ELDER_ID,
        portalUserId: USER_ID,
        status: 'ACTIVE',
        stays: {
          some: {
            organizationId: ORGANIZATION_ID,
            facilityId: FACILITY_ID,
            status: 'ACTIVE',
          },
        },
      },
    });
    expect(elderQuery.where.stays.some.admittedAt.lte).toBeInstanceOf(Date);
    expect(elderQuery.where.stays.some.OR[1].dischargedAt.gt).toBeInstanceOf(Date);
    expect(fixture.facilityRead.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: FACILITY_ID,
        organizationId: ORGANIZATION_ID,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
    });
  });
});

function elderMutationFixture(revocation: Revocation) {
  let revoked = false;
  const workOrderUpdate = vi.fn();
  const completionRead = vi.fn();
  const summaryWrite = vi.fn();
  const transitionWrite = vi.fn();
  const ratingRead = vi.fn();
  const ratingWrite = vi.fn();
  const mutationRecord = vi.fn();
  const publish = vi.fn();
  const facilityRead = vi.fn((query: unknown) => {
    void query;
    return Promise.resolve(
      revoked && revocation === 'FACILITY_DISABLED' ? null : { id: FACILITY_ID },
    );
  });
  const elderRead = vi.fn((query: unknown) => {
    void query;
    return Promise.resolve(
      revoked && (revocation === 'PORTAL_UNBOUND' || revocation === 'ELDER_DISCHARGED')
        ? null
        : { id: ELDER_ID },
    );
  });
  const roleRead = vi.fn((query: unknown) => {
    void query;
    return Promise.resolve(
      revoked && ['USER_DISABLED', 'PERMISSION_REMOVED', 'OWN_SCOPE_REPLACED'].includes(revocation)
        ? null
        : { id: 'elder-role-id' },
    );
  });
  const tx = {
    facility: { findFirst: facilityRead },
    elder: { findFirst: elderRead },
    userRole: { findFirst: roleRead },
    workOrder: {
      findFirst: vi.fn(() => Promise.resolve({
        id: WORK_ORDER_ID,
        elderId: ELDER_ID,
        status: 'COMPLETED',
        version: 6,
      })),
      updateMany: workOrderUpdate,
    },
    serviceCompletion: { findUnique: completionRead },
    familySummary: { upsert: summaryWrite },
    workOrderTransition: { create: transitionWrite },
    rating: { findFirst: ratingRead, create: ratingWrite },
    outboxEvent: { findFirst: vi.fn() },
  };
  const transaction = vi.fn((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  const database = {
    client: {
      workOrder: {
        findFirst: vi.fn(() => Promise.resolve({ id: WORK_ORDER_ID, elderId: ELDER_ID })),
      },
      $transaction: transaction,
    },
  } as unknown as DatabaseService;
  const elderAccessAssert = vi.fn(() => Promise.resolve({}));
  const service = new WorkOrdersService(
    database,
    { record: mutationRecord } as unknown as M03MutationService,
    { assert: elderAccessAssert } as unknown as ElderAccessService,
    { publish } as unknown as TaskUpdatesService,
  );
  return {
    service,
    revoke: () => { revoked = true; },
    transaction,
    elderAccessAssert,
    facilityRead,
    elderRead,
    roleRead,
    workOrderUpdate,
    completionRead,
    summaryWrite,
    transitionWrite,
    ratingRead,
    ratingWrite,
    mutationRecord,
    publish,
  };
}

const context: M03FacilityContext = {
  organizationId: ORGANIZATION_ID,
  facilityId: FACILITY_ID,
  correlationId: 'elder-owned-current-authorization-test',
};

const session: AuthenticatedSession = {
  id: 'elder-session-id',
  userId: USER_ID,
  csrfTokenHash: 'csrf-hash',
  tokenHash: 'token-hash',
  principal: {
    user: { id: USER_ID, username: 'elder.test', displayName: 'Elder Test' },
    activeContext: {
      organizationId: ORGANIZATION_ID,
      organizationName: 'Test Organization',
      facilityId: FACILITY_ID,
      facilityName: 'Test Facility',
    },
    availableContexts: [],
    roles: [{ key: 'ELDER', label: 'Elder' }],
    permissions: ['work_order.verify', 'rating.create'],
    portal: 'elder',
    expiresAt: '2026-07-22T09:00:00.000Z',
  },
};
