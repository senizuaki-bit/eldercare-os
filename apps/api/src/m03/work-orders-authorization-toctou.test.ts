import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/auth.types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import type { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const STAFF_ID = '30000000-0000-4000-8000-000000000001';
const TEAM_ID = '40000000-0000-4000-8000-000000000001';
const SHIFT_ASSIGNMENT_ID = '50000000-0000-4000-8000-000000000001';
const ELDER_ID = '60000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '70000000-0000-4000-8000-000000000001';
const ASSIGNMENT_ID = '80000000-0000-4000-8000-000000000001';

describe('WorkOrdersService caregiver mutation reauthorization', () => {
  const scenarios = [
    {
      action: 'accept',
      workOrderStatus: 'ASSIGNED',
      assignmentStatus: 'OFFERED',
      expectedVersion: 2,
      invoke: (service: WorkOrdersService) => service.accept(
        context,
        WORK_ORDER_ID,
        { expectedVersion: 2, targetStatus: 'ACCEPTED', reasonCode: 'CAREGIVER_ACCEPTED' },
        session,
      ),
    },
    {
      action: 'arrive',
      workOrderStatus: 'ACCEPTED',
      assignmentStatus: 'CLAIMED',
      expectedVersion: 3,
      invoke: (service: WorkOrdersService) => service.arrive(
        context,
        WORK_ORDER_ID,
        { expectedVersion: 3, reasonCode: 'CAREGIVER_ARRIVED' },
        session,
      ),
    },
    {
      action: 'start',
      workOrderStatus: 'ACCEPTED',
      assignmentStatus: 'CLAIMED',
      expectedVersion: 4,
      invoke: (service: WorkOrdersService) => service.start(
        context,
        WORK_ORDER_ID,
        { expectedVersion: 4, targetStatus: 'IN_PROGRESS', reasonCode: 'CAREGIVER_STARTED' },
        session,
      ),
    },
    {
      action: 'complete',
      workOrderStatus: 'IN_PROGRESS',
      assignmentStatus: 'CLAIMED',
      expectedVersion: 5,
      invoke: (service: WorkOrdersService) => service.complete(
        context,
        WORK_ORDER_ID,
        {
          expectedVersion: 5,
          reasonCode: 'CAREGIVER_COMPLETED',
          idempotencyKey: 'complete-after-shift-revoked',
          noteSource: 'TEXT',
          noteText: 'Completed safely.',
        },
        session,
      ),
    },
  ] as const;

  for (const scenario of scenarios) {
    it(`denies ${scenario.action} when the assigned shift is revoked after preflight authorization`, async () => {
      const fixture = revokedAfterPreflightFixture(
        scenario.workOrderStatus,
        scenario.assignmentStatus,
        scenario.expectedVersion,
      );

      await expect(scenario.invoke(fixture.service)).rejects.toMatchObject({
        safeCode: 'RESOURCE_NOT_FOUND',
      });

      expect(fixture.preflight).toHaveBeenCalledOnce();
      expect(fixture.transaction).toHaveBeenCalledOnce();
      expect(fixture.shiftRecheck).toHaveBeenCalledOnce();
      expect(fixture.workOrderUpdate).not.toHaveBeenCalled();
      expect(fixture.assignmentUpdate).not.toHaveBeenCalled();
      expect(fixture.arrivalCreate).not.toHaveBeenCalled();
      expect(fixture.completionCreate).not.toHaveBeenCalled();
      expect(fixture.familySummaryCreate).not.toHaveBeenCalled();
      expect(fixture.transitionCreate).not.toHaveBeenCalled();
      expect(fixture.outboxRead).not.toHaveBeenCalled();
      expect(fixture.mutationRecord).not.toHaveBeenCalled();
      expect(fixture.publish).not.toHaveBeenCalled();
    });

    for (const revocation of [
      'USER_DISABLED',
      'FACILITY_DISABLED',
      'SCOPE_EXPIRED',
      'WRONG_ACTIVE_SCOPE',
      'ROLE_PERMISSION_REMOVED',
    ] as const) {
      it(`denies ${scenario.action} when ${revocation} after preflight authorization`, async () => {
        const fixture = revokedAfterPreflightFixture(
          scenario.workOrderStatus,
          scenario.assignmentStatus,
          scenario.expectedVersion,
          revocation,
        );

        await expect(scenario.invoke(fixture.service)).rejects.toMatchObject({
          safeCode: 'RESOURCE_NOT_FOUND',
        });

        expect(fixture.preflight).toHaveBeenCalledOnce();
        expect(fixture.transaction).toHaveBeenCalledOnce();
        expect(fixture.currentRoleRecheck).toHaveBeenCalledOnce();
        const roleWhere = fixture.currentRoleRecheck.mock.calls[0]?.[0];
        expect(roleWhere).toMatchObject({
          where: {
            user: { status: 'ACTIVE' },
            organization: { status: 'ACTIVE' },
            role: { code: 'CAREGIVER' },
          },
        });
        expect(JSON.stringify(roleWhere)).toContain('dataScopes');
        expect(JSON.stringify(roleWhere)).toContain('work_order.transition');
        expect(JSON.stringify(roleWhere)).toContain('ACTIVE');
        expect(fixture.workOrderUpdate).not.toHaveBeenCalled();
        expect(fixture.assignmentUpdate).not.toHaveBeenCalled();
        expect(fixture.arrivalCreate).not.toHaveBeenCalled();
        expect(fixture.completionCreate).not.toHaveBeenCalled();
        expect(fixture.familySummaryCreate).not.toHaveBeenCalled();
        expect(fixture.transitionCreate).not.toHaveBeenCalled();
        expect(fixture.outboxRead).not.toHaveBeenCalled();
        expect(fixture.mutationRecord).not.toHaveBeenCalled();
        expect(fixture.publish).not.toHaveBeenCalled();
      });
    }
  }
});

function revokedAfterPreflightFixture(
  workOrderStatus: 'ASSIGNED' | 'ACCEPTED' | 'IN_PROGRESS',
  assignmentStatus: 'OFFERED' | 'CLAIMED',
  expectedVersion: number,
  revocation:
    | 'SHIFT_REVOKED'
    | 'USER_DISABLED'
    | 'FACILITY_DISABLED'
    | 'SCOPE_EXPIRED'
    | 'WRONG_ACTIVE_SCOPE'
    | 'ROLE_PERMISSION_REMOVED' = 'SHIFT_REVOKED',
) {
  let preflightCompleted = false;
  let userActive = true;
  let scopeActive = true;
  let transitionPermissionActive = true;
  let facilityActive = true;
  let exactScopesActive = true;
  const workOrderUpdate = vi.fn();
  const assignmentUpdate = vi.fn();
  const arrivalCreate = vi.fn();
  const completionCreate = vi.fn();
  const familySummaryCreate = vi.fn();
  const transitionCreate = vi.fn();
  const outboxRead = vi.fn();
  const mutationRecord = vi.fn();
  const publish = vi.fn();
  const shiftRecheck = vi.fn(() => {
    expect(preflightCompleted).toBe(true);
    return Promise.resolve(revocation === 'SHIFT_REVOKED'
      ? null
      : {
          id: SHIFT_ASSIGNMENT_ID,
          scopes: [{ kind: 'FACILITY' as const, floorId: null, zoneId: null }],
          elderAssignments: [],
        });
  });
  const currentRoleRecheck = vi.fn((request: unknown) => {
    void request;
    expect(preflightCompleted).toBe(true);
    return Promise.resolve(
      userActive && facilityActive && scopeActive && transitionPermissionActive
        ? {
            id: 'caregiver-role-id',
            dataScopes: [
              {
                kind: 'ACTIVE_SHIFT',
                scopeKey: `active-shift:${exactScopesActive ? SHIFT_ASSIGNMENT_ID : 'wrong-shift'}`,
                resourceType: null,
                resourceId: null,
              },
              {
                kind: 'ASSIGNED_ELDER',
                scopeKey: `shift-elder:${SHIFT_ASSIGNMENT_ID}:${ELDER_ID}`,
                resourceType: 'ELDER',
                resourceId: ELDER_ID,
              },
            ],
          }
        : null,
    );
  });
  const transactionClient = {
    workOrder: {
      findFirst: vi.fn(() => Promise.resolve({
        id: WORK_ORDER_ID,
        elderId: ELDER_ID,
        status: workOrderStatus,
        version: expectedVersion,
        arrivedAt: workOrderStatus === 'ACCEPTED' && expectedVersion === 4 ? new Date() : null,
      })),
      updateMany: workOrderUpdate,
    },
    workOrderAssignment: {
      findFirst: vi.fn(() => Promise.resolve({
        status: assignmentStatus,
        targetTeamId: TEAM_ID,
        assigneeStaffProfileId: assignmentStatus === 'CLAIMED' ? STAFF_ID : null,
        shiftAssignmentId: assignmentStatus === 'CLAIMED' ? SHIFT_ASSIGNMENT_ID : null,
      })),
      updateMany: assignmentUpdate,
    },
    staffProfile: { findFirst: vi.fn(() => Promise.resolve({ id: STAFF_ID })) },
    shiftAssignment: { findFirst: shiftRecheck },
    team: { findFirst: vi.fn(() => Promise.resolve({ id: TEAM_ID })) },
    teamMembership: { findFirst: vi.fn(() => Promise.resolve({ id: 'membership-id' })) },
    elder: {
      findFirst: vi.fn(() => Promise.resolve({
        stays: [{ bed: { room: { floorId: 'floor-id', zoneId: null } } }],
      })),
    },
    userRole: { findFirst: currentRoleRecheck },
    outboxEvent: { findFirst: outboxRead },
    workOrderArrival: { create: arrivalCreate },
    serviceCompletion: { create: completionCreate },
    familySummary: { create: familySummaryCreate },
    workOrderTransition: { create: transitionCreate },
  };
  const transaction = vi.fn(async (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
    operation(transactionClient));
  const database = {
    client: { $transaction: transaction },
  } as unknown as DatabaseService;
  const service = new WorkOrdersService(
    database,
    { record: mutationRecord } as unknown as M03MutationService,
    {} as ElderAccessService,
    { publish } as unknown as TaskUpdatesService,
  );
  const preflight = vi.fn(() => {
    preflightCompleted = true;
    if (revocation === 'USER_DISABLED') userActive = false;
    if (revocation === 'FACILITY_DISABLED') facilityActive = false;
    if (revocation === 'SCOPE_EXPIRED') scopeActive = false;
    if (revocation === 'WRONG_ACTIVE_SCOPE') exactScopesActive = false;
    if (revocation === 'ROLE_PERMISSION_REMOVED') transitionPermissionActive = false;
    return Promise.resolve({
      caregiver: {
        staffProfileId: STAFF_ID,
        shiftAssignments: [{ id: SHIFT_ASSIGNMENT_ID, teamId: TEAM_ID }],
      },
      assignment: {
        id: ASSIGNMENT_ID,
        status: assignmentStatus,
        version: 1,
        targetTeamId: TEAM_ID,
        assigneeStaffProfileId: assignmentStatus === 'CLAIMED' ? STAFF_ID : null,
        shiftAssignmentId: assignmentStatus === 'CLAIMED' ? SHIFT_ASSIGNMENT_ID : null,
      },
      coveringShifts: [{ id: SHIFT_ASSIGNMENT_ID, teamId: TEAM_ID }],
      record: {},
    });
  });
  Object.defineProperty(service, 'assertCaregiverWorkOrder', { value: preflight });

  return {
    service,
    preflight,
    transaction,
    shiftRecheck,
    currentRoleRecheck,
    workOrderUpdate,
    assignmentUpdate,
    arrivalCreate,
    completionCreate,
    familySummaryCreate,
    transitionCreate,
    outboxRead,
    mutationRecord,
    publish,
  };
}

const context: M03FacilityContext = {
  organizationId: ORGANIZATION_ID,
  facilityId: FACILITY_ID,
  correlationId: 'caregiver-mutation-toctou-test',
};

const session: AuthenticatedSession = {
  id: 'session-toctou-test',
  userId: '90000000-0000-4000-8000-000000000001',
  csrfTokenHash: 'csrf-hash',
  tokenHash: 'token-hash',
  principal: {
    user: {
      id: '90000000-0000-4000-8000-000000000001',
      username: 'caregiver.test',
      displayName: 'Caregiver Test',
    },
    activeContext: {
      organizationId: ORGANIZATION_ID,
      organizationName: 'Test Organization',
      facilityId: FACILITY_ID,
      facilityName: 'Test Facility',
    },
    availableContexts: [],
    roles: [{ key: 'CAREGIVER', label: 'Caregiver' }],
    permissions: ['elder.read.basic', 'work_order.transition'],
    portal: 'caregiver',
    expiresAt: '2026-07-22T09:00:00.000Z',
  },
};
