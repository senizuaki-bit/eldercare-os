import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedSession } from '../auth/auth.types.js';
import type { DatabaseService } from '../database/database.service.js';
import type { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const STAFF_ID = '30000000-0000-4000-8000-000000000001';
const TEAM_ID = '40000000-0000-4000-8000-000000000001';
const SHIFT_ASSIGNMENT_ID = '50000000-0000-4000-8000-000000000001';
const ELDER_ID = '60000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '70000000-0000-4000-8000-000000000001';
const FLOOR_ID = '80000000-0000-4000-8000-000000000001';
const OTHER_FLOOR_ID = '80000000-0000-4000-8000-000000000002';

describe('WorkOrdersService realtime reauthorization', () => {
  it('denies caregiver list and detail after the assigned team is disabled', async () => {
    const workOrderRead = vi.fn();
    const database = {
      client: {
        staffProfile: { findFirst: vi.fn(() => Promise.resolve({ id: STAFF_ID })) },
        userRole: {
          findFirst: vi.fn(() => Promise.resolve({
            id: 'caregiver-role-id',
            dataScopes: currentRoleScopes(),
          })),
        },
        shiftAssignment: {
          findMany: vi.fn(() => Promise.resolve([{
            id: SHIFT_ASSIGNMENT_ID,
            shift: { teamId: TEAM_ID },
          }])),
        },
        teamMembership: { findMany: vi.fn(() => Promise.resolve([{ teamId: TEAM_ID }])) },
        team: { findMany: vi.fn(() => Promise.resolve([])) },
        workOrder: { findMany: workOrderRead, findFirst: workOrderRead },
      },
    } as unknown as DatabaseService;
    const service = new WorkOrdersService(
      database,
      {} as M03MutationService,
      {} as ElderAccessService,
      new TaskUpdatesService(),
    );
    const context: M03FacilityContext = {
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
      correlationId: 'disabled-team-read-test',
    };

    await expect(service.listCaregiver(context, testSession())).rejects.toMatchObject({
      safeCode: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.getCaregiver(context, WORK_ORDER_ID, testSession())).rejects.toMatchObject({
      safeCode: 'RESOURCE_NOT_FOUND',
    });
    expect(workOrderRead).not.toHaveBeenCalled();
  });

  it('drops same-team events after coverage, team, or active-shift eligibility is revoked', async () => {
    let active = true;
    let coversElder = true;
    let teamActive = true;
    let caregiverUserActive = true;
    let facilityActive = true;
    let readPermissionActive = true;
    let exactScopeActive = true;
    const staffFindFirst = vi.fn(() => Promise.resolve({ id: STAFF_ID }));
    const userRoleFindFirst = vi.fn((query: unknown) => {
      void query;
      return Promise.resolve(
        caregiverUserActive && facilityActive && readPermissionActive
          ? {
              id: 'caregiver-role-id',
              dataScopes: currentRoleScopes(exactScopeActive),
            }
          : null,
      );
    });
    const shiftFindMany = vi.fn(() => Promise.resolve(active
      ? [{
          id: SHIFT_ASSIGNMENT_ID,
          staffProfileId: STAFF_ID,
          shift: { teamId: TEAM_ID },
          scopes: [{
            kind: 'FLOOR' as const,
            floorId: coversElder ? FLOOR_ID : OTHER_FLOOR_ID,
            zoneId: null,
          }],
          elderAssignments: [],
        }]
      : []));
    const database = {
      client: {
        staffProfile: { findFirst: staffFindFirst },
        userRole: { findFirst: userRoleFindFirst },
        shiftAssignment: { findMany: shiftFindMany },
        teamMembership: { findMany: vi.fn(() => Promise.resolve([{ teamId: TEAM_ID }])) },
        team: {
          findMany: vi.fn(() => Promise.resolve(teamActive ? [{ id: TEAM_ID }] : [])),
        },
        workOrderAssignment: {
          findFirst: vi.fn(() => Promise.resolve({
            shiftAssignmentId: null,
            targetTeamId: TEAM_ID,
          })),
        },
        elder: {
          findFirst: vi.fn(() => Promise.resolve({
            stays: [{ bed: { room: { floorId: FLOOR_ID, zoneId: null } } }],
          })),
        },
      },
    } as unknown as DatabaseService;
    const elderAccess = {
      assert: vi.fn(() => Promise.resolve({ shiftAssignmentId: SHIFT_ASSIGNMENT_ID })),
    } as unknown as ElderAccessService;
    const updates = new TaskUpdatesService();
    const service = new WorkOrdersService(
      database,
      {} as M03MutationService,
      elderAccess,
      updates,
    );
    const context: M03FacilityContext = {
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
      correlationId: 'realtime-reauthorization-test',
    };
    const session = testSession();
    const received: string[] = [];
    const subscription = updates.forCaregiver(
      ORGANIZATION_ID,
      FACILITY_ID,
      (scope) => service.canReceiveCaregiverTaskUpdate(context, session, scope),
    ).subscribe((event) => received.push(event.eventId));

    updates.publish(scopedUpdate('covered'));
    await vi.waitFor(() => expect(received).toEqual(['covered']));

    coversElder = false;
    updates.publish(scopedUpdate('same-team-wrong-floor'));
    await vi.waitFor(() => expect(staffFindFirst).toHaveBeenCalledTimes(2));
    expect(received).toEqual(['covered']);

    coversElder = true;
    teamActive = false;
    updates.publish(scopedUpdate('inactive-team'));
    await vi.waitFor(() => expect(staffFindFirst).toHaveBeenCalledTimes(3));
    expect(received).toEqual(['covered']);

    teamActive = true;
    active = false;
    updates.publish(scopedUpdate('revoked-active-shift'));
    await vi.waitFor(() => expect(staffFindFirst).toHaveBeenCalledTimes(4));
    expect(received).toEqual(['covered']);

    active = true;
    exactScopeActive = false;
    updates.publish(scopedUpdate('wrong-current-role-scope'));
    await vi.waitFor(() => expect(userRoleFindFirst).toHaveBeenCalledTimes(5));
    expect(received).toEqual(['covered']);

    exactScopeActive = true;
    caregiverUserActive = false;
    updates.publish(scopedUpdate('caregiver-user-disabled'));
    await vi.waitFor(() => expect(userRoleFindFirst).toHaveBeenCalledTimes(6));
    expect(received).toEqual(['covered']);

    caregiverUserActive = true;
    readPermissionActive = false;
    updates.publish(scopedUpdate('read-permission-revoked'));
    await vi.waitFor(() => expect(userRoleFindFirst).toHaveBeenCalledTimes(7));
    expect(received).toEqual(['covered']);

    readPermissionActive = true;
    facilityActive = false;
    updates.publish(scopedUpdate('facility-disabled'));
    await vi.waitFor(() => expect(userRoleFindFirst).toHaveBeenCalledTimes(8));
    expect(received).toEqual(['covered']);

    const roleLookup = userRoleFindFirst.mock.calls[0]?.[0];
    expect(JSON.stringify(roleLookup)).toContain('work_order.read');
    expect(JSON.stringify(roleLookup)).toContain('facility');
    expect(JSON.stringify(roleLookup)).toContain('ACTIVE');
    subscription.unsubscribe();
  });
});

function currentRoleScopes(exactShift = true) {
  return [
    {
      kind: 'ACTIVE_SHIFT',
      scopeKey: `active-shift:${exactShift ? SHIFT_ASSIGNMENT_ID : 'wrong-shift'}`,
      resourceType: null,
      resourceId: null,
    },
    {
      kind: 'ASSIGNED_ELDER',
      scopeKey: `shift-elder:${SHIFT_ASSIGNMENT_ID}:${ELDER_ID}`,
      resourceType: 'ELDER',
      resourceId: ELDER_ID,
    },
  ];
}

function scopedUpdate(eventId: string) {
  return {
    organizationId: ORGANIZATION_ID,
    facilityId: FACILITY_ID,
    elderId: ELDER_ID,
    workOrderId: WORK_ORDER_ID,
    assigneeStaffProfileId: null,
    targetTeamId: TEAM_ID,
    event: {
      eventId,
      eventType: 'WORK_ORDER.ASSIGNED' as const,
      workOrderId: WORK_ORDER_ID,
      status: 'ASSIGNED' as const,
      version: 2,
      occurredAt: '2026-07-22T08:00:00.000Z',
    },
  };
}

function testSession(): AuthenticatedSession {
  return {
    id: 'session-realtime-test',
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
      permissions: ['elder.read.basic', 'work_order.read'],
      portal: 'caregiver',
      expiresAt: '2026-07-22T09:00:00.000Z',
    },
  };
}
