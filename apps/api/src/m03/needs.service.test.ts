import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/auth.types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import { manualNeedRequestFingerprint, NeedsService } from './needs.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const ELDER_ID = '30000000-0000-4000-8000-000000000001';
const NEED_ID = '40000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '50000000-0000-4000-8000-000000000001';

const request = {
  elderId: ELDER_ID,
  summary: 'Provide warm water and check comfort.',
  category: 'DAILY_LIVING' as const,
  priority: 'ROUTINE' as const,
  requiresHumanReview: true,
  reasonCode: 'ELDER_REQUEST_CONFIRMED',
  idempotencyKey: 'manual-need-0001',
};

describe('manual need idempotency fingerprint', () => {
  it('is stable for an exact retry and covers every business input except the key itself', () => {
    expect(manualNeedRequestFingerprint({ ...request })).toBe(manualNeedRequestFingerprint(request));
    expect(manualNeedRequestFingerprint({ ...request, summary: 'Different request.' })).not.toBe(
      manualNeedRequestFingerprint(request),
    );
    expect(manualNeedRequestFingerprint({ ...request, reasonCode: 'DIFFERENT_REASON' })).not.toBe(
      manualNeedRequestFingerprint(request),
    );
  });
});

describe('NeedsService transaction-time authorization', () => {
  const revocations = [
    'PERMISSION_REVOKED',
    'SCOPE_EXPIRED',
    'USER_DISABLED',
    'FACILITY_DISABLED',
    'ELDER_DISCHARGED',
  ] as const;

  for (const revocation of revocations) {
    it(`denies manual creation with zero writes when ${revocation} after request preflight`, async () => {
      const fixture = needsFixture(revocation);

      await expect(fixture.service.createManual(context, request, createSession)).rejects.toMatchObject({
        safeCode: 'RESOURCE_NOT_FOUND',
      });

      expectZeroMutationWrites(fixture);
      expect(fixture.transaction).toHaveBeenCalledOnce();
      expect(fixture.userRoleFind).toHaveBeenCalledOnce();
      expectCurrentAccessQuery(fixture.userRoleFind, 'need.create');
      if (revocation === 'ELDER_DISCHARGED') expect(fixture.elderFind).toHaveBeenCalledOnce();
    });

    it(`denies need confirmation with zero writes when ${revocation} after request preflight`, async () => {
      const fixture = needsFixture(revocation);

      await expect(fixture.service.review(context, NEED_ID, confirmReview, reviewSession)).rejects.toMatchObject({
        safeCode: 'RESOURCE_NOT_FOUND',
      });

      expectZeroMutationWrites(fixture);
      expect(fixture.transaction).toHaveBeenCalledOnce();
      expect(fixture.userRoleFind).toHaveBeenCalledOnce();
      expectCurrentAccessQuery(fixture.userRoleFind, 'need.review');
      if (revocation === 'ELDER_DISCHARGED') {
        expect(fixture.needFind).toHaveBeenCalledOnce();
        expect(fixture.elderFind).toHaveBeenCalledOnce();
      }
    });
  }

  it('creates a reviewable need only after current role, scope, facility and active-stay checks pass', async () => {
    const fixture = needsFixture('NONE');

    await expect(fixture.service.createManual(context, request, createSession)).resolves.toMatchObject({
      id: NEED_ID,
      status: 'REVIEW_REQUIRED',
    });

    expect(fixture.needCreate).toHaveBeenCalledOnce();
    expect(fixture.mutationRecord).toHaveBeenCalledTimes(2);
    expect(fixture.elderFind).toHaveBeenCalledOnce();
    expectCurrentAccessQuery(fixture.userRoleFind, 'need.create');
    expectCurrentFacilityQuery(fixture.facilityFind);
    expectCurrentElderStayQuery(fixture.elderFind);
  });

  it('confirms a need and creates its work order only after the current elder stay check passes', async () => {
    const fixture = needsFixture('NONE');

    await expect(fixture.service.review(context, NEED_ID, confirmReview, reviewSession)).resolves.toEqual({
      id: NEED_ID,
    });

    expect(fixture.needUpdate).toHaveBeenCalledOnce();
    expect(fixture.workOrderCreate).toHaveBeenCalledOnce();
    expect(fixture.transitionCreate).toHaveBeenCalledOnce();
    expect(fixture.mutationRecord).toHaveBeenCalledTimes(2);
    expect(fixture.elderFind.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.needUpdate.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('allows an authorized reviewer to reject and cancel a stale NEW draft after discharge', async () => {
    const fixture = needsFixture('ELDER_DISCHARGED', { rejectWithNewWorkOrder: true });

    await expect(fixture.service.review(context, NEED_ID, rejectReview, reviewSession)).resolves.toEqual({
      id: NEED_ID,
    });

    expect(fixture.elderFind).not.toHaveBeenCalled();
    expect(fixture.needUpdate).toHaveBeenCalledOnce();
    expect(JSON.stringify(fixture.workOrderUpdate.mock.calls[0]?.[0])).toContain('"status":"CANCELLED"');
    expect(JSON.stringify(fixture.transitionCreate.mock.calls[0]?.[0])).toContain(
      '"fromStatus":"NEW","toStatus":"CANCELLED"',
    );
    expect(fixture.mutationRecord).toHaveBeenCalledTimes(2);
    expectCurrentAccessQuery(fixture.userRoleFind, 'need.review');
  });
});

describe('NeedsService elder-owned transaction-time authorization', () => {
  for (const revocation of [
    'PERMISSION_REVOKED',
    'SCOPE_EXPIRED',
    'USER_DISABLED',
    'FACILITY_DISABLED',
    'ELDER_DISCHARGED',
  ] as const) {
    it(`denies elder human-help creation with zero writes when ${revocation}`, async () => {
      const fixture = needsFixture(revocation);

      await expect(fixture.service.createElderOwnedManual(
        context,
        request,
        elderSession,
      )).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND' });

      expectZeroMutationWrites(fixture);
      expect(fixture.transaction).toHaveBeenCalledOnce();
      expectElderOwnedAccessQuery(fixture.userRoleFind, fixture.elderFind);
    });
  }

  it('creates elder human help only with the current ELDER role, OWN_RECORD scope and portal binding', async () => {
    const fixture = needsFixture('NONE');

    await expect(fixture.service.createElderOwnedManual(
      context,
      request,
      elderSession,
    )).resolves.toMatchObject({ id: NEED_ID, status: 'REVIEW_REQUIRED' });

    expect(fixture.needCreate).toHaveBeenCalledOnce();
    expect(fixture.mutationRecord).toHaveBeenCalledTimes(2);
    expectElderOwnedAccessQuery(fixture.userRoleFind, fixture.elderFind);
  });
});

type Revocation =
  | 'NONE'
  | 'PERMISSION_REVOKED'
  | 'SCOPE_EXPIRED'
  | 'USER_DISABLED'
  | 'FACILITY_DISABLED'
  | 'ELDER_DISCHARGED';

function needsFixture(
  revocation: Revocation,
  options: { readonly rejectWithNewWorkOrder?: boolean } = {},
) {
  let transactionStarted = false;
  const userRoleFind = vi.fn(() => {
    expect(transactionStarted).toBe(true);
    return Promise.resolve(['PERMISSION_REVOKED', 'SCOPE_EXPIRED', 'USER_DISABLED'].includes(revocation)
      ? null
      : { id: 'current-role-id' });
  });
  const facilityFind = vi.fn(() => {
    expect(transactionStarted).toBe(true);
    return Promise.resolve(revocation === 'FACILITY_DISABLED' ? null : { id: FACILITY_ID });
  });
  const elderFind = vi.fn(() => {
    expect(transactionStarted).toBe(true);
    return Promise.resolve(revocation === 'ELDER_DISCHARGED' ? null : { id: ELDER_ID });
  });
  const reviewWorkOrder = options.rejectWithNewWorkOrder === true
    ? {
        id: WORK_ORDER_ID,
        status: 'NEW' as const,
        version: 1,
      }
    : null;
  const needFind = vi.fn((query: { readonly where?: { readonly id?: string } }) => Promise.resolve(
    query.where?.id === NEED_ID
      ? { ...needRow(), primaryWorkOrder: reviewWorkOrder }
      : null,
  ));
  const needCreate = vi.fn(() => Promise.resolve(needRow()));
  const needUpdate = vi.fn(() => Promise.resolve({ count: 1 }));
  const workOrderFind = vi.fn(() => Promise.resolve(null));
  const workOrderCreate = vi.fn(() => Promise.resolve({
    id: WORK_ORDER_ID,
    createdAt: new Date('2026-07-22T08:00:00.000Z'),
  }));
  const workOrderUpdate = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve({ count: 1 });
  });
  const transitionCreate = vi.fn((input: unknown) => {
    void input;
    return Promise.resolve({ id: 'transition-id' });
  });
  const timelineCreate = vi.fn();
  const outboxCreate = vi.fn();
  const auditCreate = vi.fn();
  const transactionClient = {
    userRole: { findFirst: userRoleFind },
    facility: { findFirst: facilityFind },
    elder: { findFirst: elderFind },
    need: { findFirst: needFind, create: needCreate, updateMany: needUpdate },
    workOrder: { findFirst: workOrderFind, create: workOrderCreate, updateMany: workOrderUpdate },
    workOrderTransition: { create: transitionCreate },
    elderTimelineEntry: { create: timelineCreate },
    outboxEvent: { create: outboxCreate, findFirst: vi.fn() },
    auditEvent: { create: auditCreate },
  };
  const transaction = vi.fn(async (operation: (tx: typeof transactionClient) => Promise<unknown>) => {
    // The session below still contains the request-start permission. The
    // revocation becomes visible only once the serializable mutation starts.
    transactionStarted = true;
    return operation(transactionClient);
  });
  const database = {
    client: {
      $transaction: transaction,
      need: { findFirst: vi.fn() },
    },
  } as unknown as DatabaseService;
  const mutationRecord = vi.fn();
  const service = new NeedsService(
    database,
    { record: mutationRecord } as unknown as M03MutationService,
  );
  vi.spyOn(service, 'get').mockResolvedValue({ id: NEED_ID } as never);

  return {
    service,
    transaction,
    userRoleFind,
    facilityFind,
    elderFind,
    needFind,
    needCreate,
    needUpdate,
    workOrderCreate,
    workOrderUpdate,
    transitionCreate,
    timelineCreate,
    outboxCreate,
    auditCreate,
    mutationRecord,
  };
}

function expectZeroMutationWrites(fixture: ReturnType<typeof needsFixture>): void {
  expect(fixture.needCreate).not.toHaveBeenCalled();
  expect(fixture.needUpdate).not.toHaveBeenCalled();
  expect(fixture.workOrderCreate).not.toHaveBeenCalled();
  expect(fixture.workOrderUpdate).not.toHaveBeenCalled();
  expect(fixture.transitionCreate).not.toHaveBeenCalled();
  expect(fixture.auditCreate).not.toHaveBeenCalled();
  expect(fixture.timelineCreate).not.toHaveBeenCalled();
  expect(fixture.outboxCreate).not.toHaveBeenCalled();
  expect(fixture.mutationRecord).not.toHaveBeenCalled();
}

function expectCurrentAccessQuery(find: ReturnType<typeof vi.fn>, permission: string): void {
  const serialized = JSON.stringify(find.mock.calls[0]?.[0]);
  expect(serialized).toContain(`"code":"${permission}"`);
  expect(serialized).toContain('"user":{"status":"ACTIVE"}');
  expect(serialized).toContain('"organization":{"status":"ACTIVE"}');
  expect(serialized).toContain('"revokedAt":null');
  expect(serialized).toContain('"expiresAt"');
  expect(serialized).toContain('"validUntil"');
  expect(serialized).toContain('"kind":"PLATFORM"');
  expect(serialized).toContain(`"kind":"ORGANIZATION","organizationId":"${ORGANIZATION_ID}"`);
  expect(serialized).toContain(`"kind":"FACILITY","organizationId":"${ORGANIZATION_ID}","facilityId":"${FACILITY_ID}"`);
}

function expectCurrentFacilityQuery(find: ReturnType<typeof vi.fn>): void {
  expect(find.mock.calls[0]?.[0]).toMatchObject({
    where: {
      id: FACILITY_ID,
      organizationId: ORGANIZATION_ID,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    },
  });
}

function expectElderOwnedAccessQuery(
  roleFind: ReturnType<typeof vi.fn>,
  elderFind: ReturnType<typeof vi.fn>,
): void {
  const roleQuery = JSON.stringify(roleFind.mock.calls[0]?.[0]);
  expect(roleFind.mock.calls[0]?.[0]).toMatchObject({
    where: {
      role: {
        code: 'ELDER',
        rolePermissions: {
          some: { permission: { code: 'need.create' } },
        },
      },
    },
  });
  expect(roleQuery).toContain('OWN_RECORD');
  expect(roleQuery).not.toContain('PLATFORM');
  expect(roleQuery).toContain('expiresAt');
  expect(roleQuery).toContain('validUntil');
  expect(elderFind.mock.calls[0]?.[0]).toMatchObject({
    where: {
      id: ELDER_ID,
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
      portalUserId: elderSession.userId,
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
}

function expectCurrentElderStayQuery(find: ReturnType<typeof vi.fn>): void {
  expect(find.mock.calls[0]?.[0]).toMatchObject({
    where: {
      id: ELDER_ID,
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
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
}

function needRow() {
  const now = new Date('2026-07-22T08:00:00.000Z');
  return {
    id: NEED_ID,
    organizationId: ORGANIZATION_ID,
    facilityId: FACILITY_ID,
    elderId: ELDER_ID,
    voiceSubmissionId: null,
    aiAnalysisId: null,
    source: 'MANUAL' as const,
    summary: request.summary,
    category: request.category,
    urgencySuggestion: request.priority,
    priority: request.priority,
    requiresHumanReview: true,
    safetyRuleCodes: [],
    status: 'REVIEW_REQUIRED' as const,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReasonCode: null,
    idempotencyKey: request.idempotencyKey,
    correlationId: context.correlationId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

const context: M03FacilityContext = {
  organizationId: ORGANIZATION_ID,
  facilityId: FACILITY_ID,
  correlationId: 'needs-transaction-auth-test',
};

const createSession = sessionWith('need.create');
const reviewSession = sessionWith('need.review');
const elderSession: AuthenticatedSession = {
  ...sessionWith('need.create'),
  userId: '90000000-0000-4000-8000-000000000002',
  principal: {
    ...sessionWith('need.create').principal,
    user: {
      id: '90000000-0000-4000-8000-000000000002',
      username: 'elder.test',
      displayName: 'Elder Test',
    },
    roles: [{ key: 'ELDER', label: 'Elder' }],
    portal: 'elder',
  },
};

function sessionWith(permission: string): AuthenticatedSession {
  return {
    id: 'session-needs-test',
    userId: '90000000-0000-4000-8000-000000000001',
    csrfTokenHash: 'csrf-hash',
    tokenHash: 'token-hash',
    principal: {
      user: {
        id: '90000000-0000-4000-8000-000000000001',
        username: 'supervisor.test',
        displayName: 'Supervisor Test',
      },
      activeContext: {
        organizationId: ORGANIZATION_ID,
        organizationName: 'Test Organization',
        facilityId: FACILITY_ID,
        facilityName: 'Test Facility',
      },
      availableContexts: [],
      roles: [{ key: 'NURSING_SUPERVISOR', label: 'Supervisor' }],
      permissions: [permission],
      portal: 'admin',
      expiresAt: '2026-07-22T09:00:00.000Z',
    },
  };
}

const confirmReview = {
  expectedVersion: 1,
  decision: 'CONFIRM' as const,
  summary: request.summary,
  category: request.category,
  priority: request.priority,
  reasonCode: 'SUPERVISOR_CONFIRMED',
};

const rejectReview = {
  expectedVersion: 1,
  decision: 'REJECT' as const,
  reasonCode: 'OUT_OF_SCOPE',
};
