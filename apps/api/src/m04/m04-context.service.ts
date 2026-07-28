import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@eldercare/contracts';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticatedRequest,
  AuthenticatedSession,
  PortalKind,
} from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { parseSchema } from '../common/parse-schema.js';

export interface M04FacilityContext {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly correlationId: string;
}

@Injectable()
export class M04ContextService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async fromPortal(
    session: AuthenticatedSession,
    request: AuthenticatedRequest,
    allowedPortals: readonly PortalKind[],
  ): Promise<M04FacilityContext> {
    const active = session.principal.activeContext;
    const correlationId = request.correlationId ?? 'unknown-correlation';
    if (
      active.facilityId === null ||
      !allowedPortals.includes(session.principal.portal)
    ) {
      await this.audit.record({
        organizationId: active.organizationId,
        facilityId: active.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'SECURITY.M04_PORTAL_DENIED',
        outcome: 'DENIED',
        resourceType: 'M04_PORTAL_API',
        reasonCode:
          active.facilityId === null
            ? 'FACILITY_CONTEXT_REQUIRED'
            : 'PORTAL_REQUIRED',
        correlationId,
        metadata: { source: 'm04-portal-boundary' },
      });
      throw resourceNotFound();
    }

    return {
      organizationId: parseSchema(uuidSchema, active.organizationId),
      facilityId: parseSchema(uuidSchema, active.facilityId),
      correlationId,
    };
  }
}
