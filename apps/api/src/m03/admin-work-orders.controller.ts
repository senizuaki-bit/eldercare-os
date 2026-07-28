import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M03_PERMISSIONS } from '@eldercare/authz';
import {
  adminWorkOrderDetailSchema,
  adminWorkOrdersPageSchema,
  uuidSchema,
  workOrderAssignRequestSchema,
  workOrderCloseRequestSchema,
  workOrdersQuerySchema,
  workOrderVerifyRequestSchema,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M02ContextRoute } from '../m02/m02-context.guard.js';
import { M02ContextService } from '../m02/m02-context.js';
import { M03ReadOperation, M03WriteOperation } from './m03-openapi.js';
import { WorkOrdersService } from './work-orders.service.js';

@ApiTags('M03 work orders')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/work-orders')
export class AdminWorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get()
  @M03ReadOperation(M03_PERMISSIONS.WORK_ORDER_READ, 'List scoped work orders', adminWorkOrdersPageSchema, {
    querySchema: workOrdersQuerySchema,
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
    return this.workOrders.listAdmin(context, parseSchema(workOrdersQuerySchema, query));
  }

  @Get(':workOrderId')
  @M03ReadOperation(
    [M03_PERMISSIONS.WORK_ORDER_READ, M03_PERMISSIONS.AI_ANALYSIS_READ],
    'Read an auditable work-order detail',
    adminWorkOrderDetailSchema,
    { uuidParams: ['organizationId', 'facilityId', 'workOrderId'] },
  )
  async get(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('workOrderId') workOrderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.workOrders.getAdmin(context, parseSchema(uuidSchema, workOrderId));
  }

  @Post(':workOrderId/assign')
  @M03WriteOperation(
    [M03_PERMISSIONS.WORK_ORDER_ASSIGN, M03_PERMISSIONS.AI_ANALYSIS_READ],
    'Assign a work order',
    adminWorkOrderDetailSchema,
    workOrderAssignRequestSchema,
    { uuidParams: ['organizationId', 'facilityId', 'workOrderId'] },
  )
  async assign(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('workOrderId') workOrderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.workOrders.assign(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderAssignRequestSchema, body), session);
  }

  @Post(':workOrderId/verify')
  @M03WriteOperation(
    [
      M03_PERMISSIONS.WORK_ORDER_VERIFY,
      M03_PERMISSIONS.AI_ANALYSIS_READ,
      M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH,
    ],
    'Verify a completed work order and publish a safe summary',
    adminWorkOrderDetailSchema,
    workOrderVerifyRequestSchema,
    { uuidParams: ['organizationId', 'facilityId', 'workOrderId'] },
  )
  async verify(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('workOrderId') workOrderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.workOrders.verifyAdmin(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderVerifyRequestSchema, body), session);
  }

  @Post(':workOrderId/close')
  @M03WriteOperation(
    [M03_PERMISSIONS.WORK_ORDER_CLOSE, M03_PERMISSIONS.AI_ANALYSIS_READ],
    'Close a verified work order',
    adminWorkOrderDetailSchema,
    workOrderCloseRequestSchema,
    { uuidParams: ['organizationId', 'facilityId', 'workOrderId'] },
  )
  async close(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('workOrderId') workOrderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.workOrders.closeAdmin(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderCloseRequestSchema, body), session);
  }
}
