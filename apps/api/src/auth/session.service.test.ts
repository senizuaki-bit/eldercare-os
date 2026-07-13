import { describe, expect, it, vi } from 'vitest';
import type { ServiceConfig } from '@eldercare/config';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PrincipalService } from './principal.service.js';
import { SessionService } from './session.service.js';

const config = {
  nodeEnv: 'test',
  authSessionAbsoluteTtlSeconds: 28_800,
  authSessionIdleTtlSeconds: 1_800,
} as ServiceConfig;

describe('SessionService.resolve', () => {
  it('does not return a principal when the session was revoked during refresh', async () => {
    const now = Date.now();
    const findUnique = vi.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      userId: '30000000-0000-4000-8000-000000000002',
      organizationId: '10000000-0000-4000-8000-000000000002',
      facilityId: '20000000-0000-4000-8000-000000000001',
      tokenHash: 'a'.repeat(64),
      csrfTokenHash: 'b'.repeat(64),
      sessionVersion: 1,
      lastSeenAt: new Date(now - 1_000),
      idleExpiresAt: new Date(now + 60_000),
      absoluteExpiresAt: new Date(now + 120_000),
      revokedAt: null,
      revokeReason: null,
      createdAt: new Date(now - 5_000),
      user: {
        id: '30000000-0000-4000-8000-000000000002',
        loginName: 'facility.director',
        normalizedLoginName: 'facility.director',
        displayName: 'Demo director',
        status: 'ACTIVE',
        sessionVersion: 1,
        accessVersion: 1,
        lastLoginAt: null,
        createdAt: new Date(now - 5_000),
        updatedAt: new Date(now - 5_000),
      },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = {
      client: { authSession: { findUnique, updateMany } },
    } as unknown as DatabaseService;
    const principal = {
      user: { id: '30000000-0000-4000-8000-000000000002', username: 'facility.director', displayName: 'Demo director' },
      activeContext: {
        organizationId: '10000000-0000-4000-8000-000000000002',
        organizationName: 'Demo organization',
        facilityId: '20000000-0000-4000-8000-000000000001',
        facilityName: 'Demo facility',
      },
      availableContexts: [],
      roles: [],
      permissions: [],
      portal: 'admin' as const,
      expiresAt: new Date(now + 60_000).toISOString(),
    };
    const principals = {
      buildForContext: vi.fn().mockResolvedValue(principal),
    } as unknown as PrincipalService;
    const audit = { record: vi.fn() } as unknown as AuditService;
    const service = new SessionService(database, principals, audit, config);

    await expect(service.resolve('A'.repeat(43))).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('writes a context switch audit through the same transaction client', async () => {
    const transaction = { authSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const database = {
      client: {
        $transaction: vi.fn(async (operation: (client: typeof transaction) => Promise<boolean>) =>
          operation(transaction),
        ),
      },
    } as unknown as DatabaseService;
    const principal = {
      user: { id: '30000000-0000-4000-8000-000000000001', username: 'platform.admin', displayName: 'Platform admin' },
      activeContext: {
        organizationId: '10000000-0000-4000-8000-000000000003',
        organizationName: 'Target organization',
        facilityId: '20000000-0000-4000-8000-000000000003',
        facilityName: 'Target facility',
      },
      availableContexts: [],
      roles: [],
      permissions: [],
      portal: 'admin' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const principals = {
      buildForContext: vi.fn().mockResolvedValue(principal),
    } as unknown as PrincipalService;
    const recordAudit = vi.fn().mockResolvedValue(undefined);
    const audit = { record: recordAudit } as unknown as AuditService;
    const service = new SessionService(database, principals, audit, config);
    const session = {
      id: '80000000-0000-4000-8000-000000000001',
      userId: principal.user.id,
      tokenHash: 'a'.repeat(64),
      csrfTokenHash: 'b'.repeat(64),
      principal,
    };

    await expect(
      service.switchContext(
        session,
        principal.activeContext.organizationId,
        principal.activeContext.facilityId,
        'context-correlation-id',
      ),
    ).resolves.toEqual(principal);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH.CONTEXT_SWITCHED' }),
      transaction,
    );
  });
});
