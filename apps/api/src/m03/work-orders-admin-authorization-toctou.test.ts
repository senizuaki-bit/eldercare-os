import { M03_PERMISSIONS } from '@eldercare/authz';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import type { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import type { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const organizationId = '10000000-0000-4000-8000-000000000002';
const facilityId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const elderId = '40000000-0000-4000-8000-000000000001';
const workOrderId = '50000000-0000-4000-8000-000000000001';
const context = { organizationId, facilityId, correlationId: 'admin-current-auth-test' };
const session = { userId };

describe('administrator work-order continuous authorization', () => {
  for (const action of ['assign', 'verify', 'close'] as const) {
    it(`rechecks the exact current grant before any ${action} side effect`, async () => {
      const roleRead = vi.fn().mockResolvedValue(null);
      const facilityRead = vi.fn().mockResolvedValue({ id: facilityId });
      const writes = {
        workOrder: vi.fn(),
        assignment: vi.fn(),
        need: vi.fn(),
        completion: vi.fn(),
        transition: vi.fn(),
        summary: vi.fn(),
        mutation: vi.fn(),
        publish: vi.fn(),
      };
      const current = {
        id: workOrderId,
        elderId,
        primaryNeedId: '60000000-0000-4000-8000-000000000001',
        title: 'Test work order',
        status: action === 'assign' ? 'NEW' : action === 'verify' ? 'COMPLETED' : 'VERIFIED',
        version: action === 'assign' ? 1 : action === 'verify' ? 5 : 6,
        primaryNeed: { status: 'CONFIRMED', requiresHumanReview: false },
        elder: { stays: [] },
      };
      const tx = {
        facility: { findFirst: facilityRead },
        userRole: { findFirst: roleRead },
        workOrder: { findFirst: vi.fn().mockResolvedValue(current), updateMany: writes.workOrder },
        workOrderAssignment: { create: writes.assignment },
        need: { updateMany: writes.need },
        serviceCompletion: { findUnique: writes.completion },
        workOrderTransition: { create: writes.transition },
        familySummary: { upsert: writes.summary },
      };
      const transaction = vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
      const database = {
        client: {
          workOrder: { findFirst: vi.fn().mockResolvedValue(current) },
          $transaction: transaction,
        },
      } as unknown as DatabaseService;
      const service = new WorkOrdersService(
        database,
        { record: writes.mutation } as unknown as M03MutationService,
        {} as ElderAccessService,
        { publish: writes.publish } as unknown as TaskUpdatesService,
      );

      const operation = action === 'assign'
        ? service.assign(
            context,
            workOrderId,
            {
              expectedVersion: 1,
              targetTeamId: '70000000-0000-4000-8000-000000000001',
              reasonCode: 'SUPERVISOR_ASSIGNED',
            },
            session as never,
          )
        : action === 'verify'
          ? service.verifyAdmin(
              context,
              workOrderId,
              { expectedVersion: 5, targetStatus: 'VERIFIED', reasonCode: 'SUPERVISOR_VERIFIED' },
              session as never,
            )
          : service.closeAdmin(
              context,
              workOrderId,
              { expectedVersion: 6, targetStatus: 'CLOSED', reasonCode: 'SUPERVISOR_CLOSED' },
              session as never,
            );

      await expect(operation).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND' });
      expect(transaction).toHaveBeenCalledOnce();
      expect(facilityRead).toHaveBeenCalledOnce();
      expect(roleRead).toHaveBeenCalledOnce();
      const serialized = JSON.stringify(roleRead.mock.calls[0]?.[0]);
      expect(serialized).toContain(
        action === 'assign'
          ? M03_PERMISSIONS.WORK_ORDER_ASSIGN
          : action === 'verify'
            ? M03_PERMISSIONS.WORK_ORDER_VERIFY
            : M03_PERMISSIONS.WORK_ORDER_CLOSE,
      );
      expect(serialized).toContain(M03_PERMISSIONS.AI_ANALYSIS_READ);
      if (action === 'verify') {
        expect(serialized).toContain(M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH);
      }
      expect(serialized).toContain('PLATFORM');
      expect(serialized).toContain('validUntil');
      expect(serialized).toContain('expiresAt');
      Object.values(writes).forEach((write) => expect(write).not.toHaveBeenCalled());
    });
  }

  it('accepts one current platform-scoped grant containing every required permission', async () => {
    const facilityRead = vi.fn().mockResolvedValue({ id: facilityId });
    const roleRead = vi.fn().mockResolvedValue({ id: 'platform-role' });
    const service = new WorkOrdersService(
      {} as DatabaseService,
      {} as M03MutationService,
      {} as ElderAccessService,
      {} as TaskUpdatesService,
    );
    const assertCurrent = Reflect.get(service, 'assertCurrentAdminMutationAccess') as (
      tx: unknown,
      operationContext: typeof context,
      operationSession: typeof session,
      permissions: readonly string[],
    ) => Promise<void>;
    await expect(assertCurrent.call(
      service,
      { facility: { findFirst: facilityRead }, userRole: { findFirst: roleRead } },
      context,
      session,
      [
        M03_PERMISSIONS.WORK_ORDER_VERIFY,
        M03_PERMISSIONS.AI_ANALYSIS_READ,
        M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH,
      ],
    )).resolves.toBeUndefined();
    const where = (roleRead.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(where).not.toHaveProperty('organizationId');
    expect(JSON.stringify(where)).toContain('PLATFORM');
  });
});
