import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { M03_PERMISSIONS } from '@eldercare/authz';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { PermissionGuard } from '../authorization/permission.guard.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { AdminWorkOrdersController } from './admin-work-orders.controller.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';

describe('AdminWorkOrdersController authorization', () => {
  it('requires analysis permission in addition to work-order read for detail', async () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(AdminWorkOrdersController.prototype, 'get')?.value as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (handler === undefined) throw new Error('Admin work-order detail handler is missing');
    expect(reflector.get<readonly string[]>(REQUIRED_PERMISSIONS, handler)).toEqual([
      M03_PERMISSIONS.WORK_ORDER_READ,
      M03_PERMISSIONS.AI_ANALYSIS_READ,
    ]);

    const auditRecord = vi.fn<AuditService['record']>().mockResolvedValue(undefined);
    const guard = new PermissionGuard(
      reflector,
      { record: auditRecord } as unknown as AuditService,
    );
    const request = {
      auth: session([M03_PERMISSIONS.WORK_ORDER_READ]),
      correlationId: 'm03-admin-detail-negative-auth',
    } as unknown as AuthenticatedRequest;
    const executionContext = {
      getHandler: () => handler,
      getClass: () => AdminWorkOrdersController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    let thrown: unknown;
    try {
      await guard.canActivate(executionContext);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SafeHttpException);
    if (!(thrown instanceof SafeHttpException)) throw new Error('Expected SafeHttpException');
    expect(thrown.getStatus()).toBe(403);
    expect(thrown.safeCode).toBe('FORBIDDEN');
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SECURITY.ACCESS_DENIED',
      reasonCode: 'PERMISSION_MISSING',
    }));
  });
});

function session(permissions: string[]): AuthenticatedSession {
  return {
    id: 'session-m03-admin-detail',
    userId: '30000000-0000-4000-8000-000000000001',
    csrfTokenHash: 'csrf-hash',
    tokenHash: 'token-hash',
    principal: {
      user: {
        id: '30000000-0000-4000-8000-000000000001',
        username: 'detail-reader',
        displayName: 'Detail Reader',
      },
      activeContext: {
        organizationId: ORGANIZATION_ID,
        organizationName: 'Test Organization',
        facilityId: FACILITY_ID,
        facilityName: 'Test Facility',
      },
      availableContexts: [],
      roles: [],
      permissions,
      portal: 'admin',
      expiresAt: '2026-07-23T00:00:00.000Z',
    },
  };
}
