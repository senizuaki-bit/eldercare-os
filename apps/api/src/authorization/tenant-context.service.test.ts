import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { TenantContextService } from './tenant-context.service.js';

const session: AuthenticatedSession = {
  id: 'session-id',
  userId: '30000000-0000-4000-8000-000000000002',
  tokenHash: 'a'.repeat(64),
  csrfTokenHash: 'b'.repeat(64),
  principal: {
    user: {
      id: '30000000-0000-4000-8000-000000000002',
      username: 'facility.director',
      displayName: 'Demo director',
    },
    activeContext: {
      organizationId: '10000000-0000-4000-8000-000000000002',
      organizationName: 'Demo organization',
      facilityId: '20000000-0000-4000-8000-000000000001',
      facilityName: 'Demo facility',
    },
    availableContexts: [],
    roles: [],
    permissions: [],
    portal: 'admin',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
};

describe('TenantContextService', () => {
  it('accepts only the exact server-selected organization and facility', async () => {
    const record = vi.fn();
    const service = new TenantContextService({ record } as unknown as AuditService);
    await expect(service.assertFacilityContext(
      session,
      session.principal.activeContext.organizationId,
      session.principal.activeContext.facilityId ?? '',
      'test-correlation-id',
    )).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('audits a mismatch against the active tenant and returns safe not-found', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new TenantContextService({ record } as unknown as AuditService);
    await expect(service.assertFacilityContext(
      session,
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000003',
      'test-correlation-id',
    )).rejects.toMatchObject({ safeCode: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: session.principal.activeContext.organizationId,
      facilityId: session.principal.activeContext.facilityId,
      action: 'SECURITY.TENANT_CONTEXT_DENIED',
      outcome: 'DENIED',
    }));
  });
});
