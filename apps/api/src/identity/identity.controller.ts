import { Body, Controller, Get, Inject, Param, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  replaceUserAccessRequestSchema,
  rolesQuerySchema,
  usersQuerySchema,
  uuidSchema,
  type RoleListItem,
  type RolesPage,
  type UserSummary,
  type UsersPage,
} from '@eldercare/contracts';
import { M01_PERMISSIONS } from '@eldercare/authz';
import { CurrentSession, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { TenantContextService } from '../authorization/tenant-context.service.js';
import { parseSchema } from '../common/parse-schema.js';
import {
  ReplaceUserAccessRequestDto,
  RoleListItemDto,
  RolesPageDto,
  UserSummaryDto,
  UsersPageDto,
} from './identity.dto.js';
import { IdentityService } from './identity.service.js';

@ApiTags('identity and access')
@ApiCookieAuth('sessionCookie')
@Controller('admin/organizations/:organizationId/facilities/:facilityId')
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  @Get('users')
  @RequirePermissions(M01_PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'List users visible in the active facility context' })
  @ApiOkResponse({ type: UsersPageDto })
  @ApiBadRequestResponse({ description: 'The query is invalid.' })
  @ApiForbiddenResponse({ description: 'The permission is missing.' })
  @ApiNotFoundResponse({ description: 'The tenant context does not exist or is not accessible.' })
  async listUsers(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<UsersPage> {
    const { organizationId, facilityId } = await this.assertContext(
      rawOrganizationId,
      rawFacilityId,
      session,
      request,
    );
    return this.identity.listUsers(
      organizationId,
      facilityId,
      parseSchema(usersQuerySchema, rawQuery),
      session,
      correlationId(request),
    );
  }

  @Get('users/:userId')
  @RequirePermissions(M01_PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'Read one user without cross-tenant enumeration' })
  @ApiOkResponse({ type: UserSummaryDto })
  @ApiNotFoundResponse({ description: 'The record does not exist or is not accessible.' })
  async getUser(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Param('userId') rawUserId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserSummary> {
    const { organizationId, facilityId } = await this.assertContext(
      rawOrganizationId,
      rawFacilityId,
      session,
      request,
    );
    const userId = parseSchema(uuidSchema, rawUserId);
    return this.identity.getUser(
      organizationId,
      facilityId,
      userId,
      session,
      correlationId(request),
    );
  }

  @Put('users/:userId/access')
  @RequirePermissions(M01_PERMISSIONS.ACCESS_ASSIGNMENT_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Replace a visible user facility access using optimistic concurrency' })
  @ApiBody({ type: ReplaceUserAccessRequestDto })
  @ApiOkResponse({ type: UserSummaryDto })
  @ApiBadRequestResponse({ description: 'A role, scope or validity window is invalid.' })
  @ApiConflictResponse({ description: 'The expected access version is stale.' })
  @ApiForbiddenResponse({ description: 'The actor cannot assign the requested permission set.' })
  @ApiNotFoundResponse({ description: 'The record does not exist or is not accessible.' })
  async replaceAccess(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Param('userId') rawUserId: string,
    @Body() rawBody: ReplaceUserAccessRequestDto,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<UserSummary> {
    const { organizationId, facilityId } = await this.assertContext(
      rawOrganizationId,
      rawFacilityId,
      session,
      request,
    );
    return this.identity.replaceUserAccess(
      organizationId,
      facilityId,
      parseSchema(uuidSchema, rawUserId),
      parseSchema(replaceUserAccessRequestSchema, rawBody),
      session,
      correlationId(request),
    );
  }

  @Get('roles')
  @RequirePermissions(M01_PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'List role definitions with active facility assignment counts' })
  @ApiOkResponse({ type: RolesPageDto })
  @ApiBadRequestResponse({ description: 'The query is invalid.' })
  @ApiNotFoundResponse({ description: 'The tenant context does not exist or is not accessible.' })
  async listRoles(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<RolesPage> {
    const { organizationId, facilityId } = await this.assertContext(
      rawOrganizationId,
      rawFacilityId,
      session,
      request,
    );
    return this.identity.listRoles(
      organizationId,
      facilityId,
      parseSchema(rolesQuerySchema, rawQuery),
      session,
      correlationId(request),
    );
  }

  @Get('roles/:roleId')
  @RequirePermissions(M01_PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'Read one role with counts limited to the active facility' })
  @ApiOkResponse({ type: RoleListItemDto })
  @ApiNotFoundResponse({ description: 'The record does not exist or is not accessible.' })
  async getRole(
    @Param('organizationId') rawOrganizationId: string,
    @Param('facilityId') rawFacilityId: string,
    @Param('roleId') rawRoleId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoleListItem> {
    const { organizationId, facilityId } = await this.assertContext(
      rawOrganizationId,
      rawFacilityId,
      session,
      request,
    );
    return this.identity.getRole(
      organizationId,
      facilityId,
      parseSchema(uuidSchema, rawRoleId),
      session,
      correlationId(request),
    );
  }

  private async assertContext(
    rawOrganizationId: string,
    rawFacilityId: string,
    session: AuthenticatedSession,
    request: AuthenticatedRequest,
  ): Promise<{ organizationId: string; facilityId: string }> {
    const organizationId = parseSchema(uuidSchema, rawOrganizationId);
    const facilityId = parseSchema(uuidSchema, rawFacilityId);
    await this.tenantContext.assertFacilityContext(
      session,
      organizationId,
      facilityId,
      correlationId(request),
    );
    return { organizationId, facilityId };
  }
}

function correlationId(request: AuthenticatedRequest): string {
  return request.correlationId ?? 'unknown-correlation';
}
