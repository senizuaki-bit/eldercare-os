import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import type { TenantContextService } from '../authorization/tenant-context.service.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import type { DatabaseService } from '../database/database.service.js';
import { M02ContextGuard } from './m02-context.guard.js';
import { M02ContextService } from './m02-context.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';

describe('M02 context boundary', () => {
  it('fails closed when an M02 route reaches the guard without authentication', async () => {
    const assertFacility = vi.fn<M02ContextService['assertFacility']>();
    const guard = new M02ContextGuard(
      { getAllAndOverride: () => true } as unknown as Reflector,
      { assertFacility } as unknown as M02ContextService,
    );
    const request = { params: {} } as unknown as AuthenticatedRequest;
    const executionContext = {
      getHandler: () => () => undefined,
      getClass: () => class TestController {},
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
    expect(thrown.getStatus()).toBe(401);
    expect(thrown.safeCode).toBe('UNAUTHENTICATED');
    expect(assertFacility).not.toHaveBeenCalled();
  });

  it('does not reuse a verified request across a changed session id or user id', async () => {
    const assertFacilityContext = vi
      .fn<TenantContextService['assertFacilityContext']>()
      .mockResolvedValue(undefined);
    const findFirst = vi.fn().mockResolvedValue({ id: 'authorized-user' });
    const service = new M02ContextService(
      { assertFacilityContext } as unknown as TenantContextService,
      { record: vi.fn<AuditService['record']>() } as unknown as AuditService,
      { client: { user: { findFirst } } } as unknown as DatabaseService,
    );
    const request = {
      correlationId: 'm02-context-cache-test',
    } as unknown as AuthenticatedRequest;
    const firstSession = session('session-a', '30000000-0000-4000-8000-000000000001');

    await service.assertFacility(ORGANIZATION_ID, FACILITY_ID, firstSession, request);
    await service.assertFacility(
      ORGANIZATION_ID,
      FACILITY_ID,
      session(firstSession.id, firstSession.userId),
      request,
    );
    expect(findFirst).toHaveBeenCalledTimes(1);

    await service.assertFacility(
      ORGANIZATION_ID,
      FACILITY_ID,
      session(firstSession.id, '30000000-0000-4000-8000-000000000002'),
      request,
    );
    await service.assertFacility(
      ORGANIZATION_ID,
      FACILITY_ID,
      session('session-b', '30000000-0000-4000-8000-000000000002'),
      request,
    );

    expect(assertFacilityContext).toHaveBeenCalledTimes(3);
    expect(findFirst).toHaveBeenCalledTimes(3);
  });
});

function session(id: string, userId: string): AuthenticatedSession {
  return {
    id,
    userId,
    csrfTokenHash: 'csrf-hash',
    tokenHash: 'token-hash',
    principal: {
      user: { id: userId, username: `user-${userId}`, displayName: 'Test User' },
      activeContext: {
        organizationId: ORGANIZATION_ID,
        organizationName: 'Test Organization',
        facilityId: FACILITY_ID,
        facilityName: 'Test Facility',
      },
      availableContexts: [],
      roles: [],
      permissions: [],
      portal: 'admin',
      expiresAt: '2026-07-14T00:00:00.000Z',
    },
  };
}
