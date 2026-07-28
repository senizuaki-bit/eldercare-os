import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M03_PERMISSIONS } from '@eldercare/authz';
import {
  adminNeedSchema,
  adminNeedsPageSchema,
  manualNeedCreateRequestSchema,
  needSchema,
  needReviewRequestSchema,
  needsQuerySchema,
  uuidSchema,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M02ContextRoute } from '../m02/m02-context.guard.js';
import { M02ContextService } from '../m02/m02-context.js';
import { M03ReadOperation, M03WriteOperation } from './m03-openapi.js';
import { NeedsService } from './needs.service.js';

@ApiTags('M03 needs')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/needs')
export class AdminNeedsController {
  constructor(
    @Inject(NeedsService) private readonly needs: NeedsService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get()
  @M03ReadOperation(M03_PERMISSIONS.NEED_READ, 'List scoped reviewable needs', adminNeedsPageSchema, {
    querySchema: needsQuerySchema,
    uuidParams: ['organizationId', 'facilityId'],
  })
  async list(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.needs.list(context, parseSchema(needsQuerySchema, query));
  }

  @Get(':needId')
  @M03ReadOperation(M03_PERMISSIONS.NEED_READ, 'Read one scoped need', adminNeedSchema, {
    uuidParams: ['organizationId', 'facilityId', 'needId'],
  })
  async get(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('needId') needId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.needs.get(context, parseSchema(uuidSchema, needId));
  }

  @Post('manual')
  @M03WriteOperation(
    M03_PERMISSIONS.NEED_CREATE,
    'Create a manual fallback need',
    needSchema,
    manualNeedCreateRequestSchema,
    { uuidParams: ['organizationId', 'facilityId'] },
  )
  async createManual(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.needs.createManual(context, parseSchema(manualNeedCreateRequestSchema, body), session);
  }

  @Post(':needId/review')
  @M03WriteOperation(
    M03_PERMISSIONS.NEED_REVIEW,
    'Confirm or reject an AI-drafted need',
    adminNeedSchema,
    needReviewRequestSchema,
    { uuidParams: ['organizationId', 'facilityId', 'needId'] },
  )
  async review(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('needId') needId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.needs.review(context, parseSchema(uuidSchema, needId), parseSchema(needReviewRequestSchema, body), session);
  }
}
