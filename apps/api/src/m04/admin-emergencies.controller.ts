import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M04_PERMISSIONS } from '@eldercare/authz';
import {
  adminEmergencyAssignRequestSchema,
  adminEmergencyResolveRequestSchema,
  adminEmergencyReviewRequestSchema,
  emergenciesQuerySchema,
  emergencyAdminDetailSchema,
  emergencyAdminPageSchema,
  uuidSchema,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  AuthenticatedSession,
} from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M02ContextRoute } from '../m02/m02-context.guard.js';
import { M02ContextService } from '../m02/m02-context.js';
import { EmergenciesService } from './emergencies.service.js';
import { M04ReadOperation, M04WriteOperation } from './m04-openapi.js';

@ApiTags('M04 emergency command center')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller(
  'admin/organizations/:organizationId/facilities/:facilityId/emergencies',
)
export class AdminEmergenciesController {
  constructor(
    @Inject(EmergenciesService)
    private readonly emergencies: EmergenciesService,
    @Inject(M02ContextService)
    private readonly context: M02ContextService,
  ) {}

  @Get()
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_READ,
    'List facility emergency events in risk-first order',
    emergencyAdminPageSchema,
    {
      querySchema: emergenciesQuerySchema,
      uuidParams: ['organizationId', 'facilityId'],
    },
  )
  async list(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(
      organizationId,
      facilityId,
      session,
      request,
    );
    return this.emergencies.listAdmin(
      context,
      parseSchema(emergenciesQuerySchema, query),
      session,
    );
  }

  @Get(':emergencyEventId')
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_READ,
    'Read one auditable emergency event',
    emergencyAdminDetailSchema,
    {
      uuidParams: ['organizationId', 'facilityId', 'emergencyEventId'],
    },
  )
  async get(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('emergencyEventId') emergencyEventId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(
      organizationId,
      facilityId,
      session,
      request,
    );
    return this.emergencies.getAdmin(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      session,
    );
  }

  @Post(':emergencyEventId/responders')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_ASSIGN,
    'Assign an active-shift responder with optional bounded elevation',
    emergencyAdminDetailSchema,
    adminEmergencyAssignRequestSchema,
    {
      uuidParams: ['organizationId', 'facilityId', 'emergencyEventId'],
    },
  )
  async assignResponder(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(
      organizationId,
      facilityId,
      session,
      request,
    );
    return this.emergencies.assignResponder(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      parseSchema(adminEmergencyAssignRequestSchema, body),
      session,
    );
  }

  @Post(':emergencyEventId/resolve')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_RESOLVE,
    'Resolve a responding emergency as a human supervisor',
    emergencyAdminDetailSchema,
    adminEmergencyResolveRequestSchema,
    {
      uuidParams: ['organizationId', 'facilityId', 'emergencyEventId'],
    },
  )
  async resolve(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(
      organizationId,
      facilityId,
      session,
      request,
    );
    return this.emergencies.resolveAdmin(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      parseSchema(adminEmergencyResolveRequestSchema, body),
      session,
    );
  }

  @Post(':emergencyEventId/review')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_REVIEW,
    'Complete or explicitly waive the required supervisor review',
    emergencyAdminDetailSchema,
    adminEmergencyReviewRequestSchema,
    {
      uuidParams: ['organizationId', 'facilityId', 'emergencyEventId'],
    },
  )
  async review(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(
      organizationId,
      facilityId,
      session,
      request,
    );
    return this.emergencies.review(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      parseSchema(adminEmergencyReviewRequestSchema, body),
      session,
    );
  }
}
