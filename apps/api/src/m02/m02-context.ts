import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@eldercare/contracts';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService, resourceNotFound } from '../authorization/tenant-context.service.js';
import { parseSchema } from '../common/parse-schema.js';
import { DatabaseService } from '../database/database.service.js';

export interface M02FacilityContext {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly correlationId: string;
}

interface VerifiedM02Request {
  readonly context: M02FacilityContext;
  readonly sessionId: string;
  readonly userId: string;
}

@Injectable()
export class M02ContextService {
  private readonly verifiedRequests = new WeakMap<AuthenticatedRequest, VerifiedM02Request>();

  constructor(
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async assertFacility(
    rawOrganizationId: string,
    rawFacilityId: string,
    session: AuthenticatedSession,
    request: AuthenticatedRequest,
  ): Promise<M02FacilityContext> {
    const organizationId = parseSchema(uuidSchema, rawOrganizationId);
    const facilityId = parseSchema(uuidSchema, rawFacilityId);
    const cached = this.verifiedRequests.get(request);
    if (
      cached !== undefined &&
      cached.context.organizationId === organizationId &&
      cached.context.facilityId === facilityId &&
      cached.sessionId === session.id &&
      cached.userId === session.userId
    ) {
      return cached.context;
    }
    const correlationId = request.correlationId ?? 'unknown-correlation';
    if (session.principal.portal !== 'admin') {
      await this.audit.record({
        organizationId: session.principal.activeContext.organizationId,
        facilityId: session.principal.activeContext.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'SECURITY.ADMIN_PORTAL_DENIED',
        outcome: 'DENIED',
        resourceType: 'M02_ADMIN_API',
        reasonCode: 'ADMIN_PORTAL_REQUIRED',
        correlationId,
        metadata: { source: 'm02-admin-boundary' },
      });
      throw resourceNotFound();
    }
    await this.tenantContext.assertFacilityContext(
      session,
      organizationId,
      facilityId,
      correlationId,
    );
    const now = new Date();
    const broadAccess = await this.database.client.user.findFirst({
      where: {
        id: session.userId,
        status: 'ACTIVE',
        userRoles: {
          some: {
            activeFrom: { lte: now },
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            dataScopes: {
              some: {
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gt: now } }],
                AND: {
                  OR: [
                    { kind: 'PLATFORM' },
                    { kind: 'ORGANIZATION', organizationId },
                    { kind: 'FACILITY', organizationId, facilityId },
                  ],
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (broadAccess === null) {
      await this.audit.record({
        organizationId,
        facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'SECURITY.ADMIN_SCOPE_DENIED',
        outcome: 'DENIED',
        resourceType: 'M02_ADMIN_API',
        reasonCode: 'BROAD_SCOPE_REQUIRED',
        correlationId,
        metadata: { source: 'm02-admin-boundary' },
      });
      throw resourceNotFound();
    }
    const verified = { organizationId, facilityId, correlationId };
    this.verifiedRequests.set(request, {
      context: verified,
      sessionId: session.id,
      userId: session.userId,
    });
    return verified;
  }
}
