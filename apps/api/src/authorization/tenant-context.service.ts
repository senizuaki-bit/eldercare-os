import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { SafeHttpException } from '../common/safe-http.exception.js';

@Injectable()
export class TenantContextService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async assertFacilityContext(
    session: AuthenticatedSession,
    organizationId: string,
    facilityId: string,
    correlationId: string,
  ): Promise<void> {
    const active = session.principal.activeContext;
    if (active.organizationId === organizationId && active.facilityId === facilityId) return;

    await this.audit.record({
      organizationId: active.organizationId,
      facilityId: active.facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'SECURITY.TENANT_CONTEXT_DENIED',
      outcome: 'DENIED',
      resourceType: 'TENANT_CONTEXT',
      reasonCode: 'CONTEXT_MISMATCH',
      correlationId,
      metadata: {
        targetOrganizationId: organizationId,
        targetFacilityId: facilityId,
      },
    });

    throw resourceNotFound();
  }
}

export function resourceNotFound(): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.NOT_FOUND,
    'RESOURCE_NOT_FOUND',
    '记录不存在或不可访问',
  );
}
