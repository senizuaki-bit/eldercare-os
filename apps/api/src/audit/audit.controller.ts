import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { M01_PERMISSIONS } from '@eldercare/authz';
import {
  auditEventsQuerySchema,
  uuidSchema,
  type AuditEventsPage,
} from '@eldercare/contracts';
import { CurrentSession, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { TenantContextService, resourceNotFound } from '../authorization/tenant-context.service.js';
import { parseSchema } from '../common/parse-schema.js';
import { AuditEventsPageDto } from './audit.dto.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@ApiCookieAuth('sessionCookie')
@Controller('admin/organizations/:organizationId/facilities/:facilityId/audit-events')
export class AuditController {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions(M01_PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'List append-only audit events in the active facility context' })
  @ApiOkResponse({ type: AuditEventsPageDto })
  @ApiBadRequestResponse({ description: 'The query is invalid.' })
  @ApiForbiddenResponse({ description: 'The permission is missing.' })
  @ApiNotFoundResponse({ description: 'The tenant context does not exist or is not accessible.' })
  async list(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<AuditEventsPage> {
    const organizationId = parseSchema(uuidSchema, rawOrganizationId);
    const facilityId = parseSchema(uuidSchema, rawFacilityId);
    const correlationId = request.correlationId ?? 'unknown-correlation';
    await this.tenantContext.assertFacilityContext(
      session,
      organizationId,
      facilityId,
      correlationId,
    );
    const query = parseSchema(auditEventsQuerySchema, rawQuery);
    if (
      (query.organizationId !== undefined && query.organizationId !== organizationId) ||
      (query.facilityId !== undefined && query.facilityId !== facilityId)
    ) {
      throw resourceNotFound();
    }
    const page = await this.audit.listForFacility(organizationId, facilityId, query);
    await this.audit.record({
      organizationId,
      facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'AUDIT.EVENTS_READ',
      outcome: 'SUCCESS',
      resourceType: 'AUDIT_EVENT_DIRECTORY',
      correlationId,
      metadata: {
        page: query.page,
        pageSize: query.pageSize,
        resultCount: page.items.length,
      },
    });
    return page;
  }
}
