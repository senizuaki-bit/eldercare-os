import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M04_PERMISSIONS } from '@eldercare/authz';
import {
  caregiverEmergenciesPageSchema,
  caregiverEmergencyAcknowledgeRequestSchema,
  caregiverEmergencyMilestoneRequestSchema,
  caregiverEmergencyResolveRequestSchema,
  caregiverEmergencySchema,
  elderEmergencySignalRequestSchema,
  elderEmergencyStatusSchema,
  familyEmergenciesQuerySchema,
  familyEmergencyNotificationPreferenceSchema,
  familyEmergencyNotificationPreferenceUpdateRequestSchema,
  familyEmergencySummariesPageSchema,
  uuidSchema,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type {
  AuthenticatedRequest,
  AuthenticatedSession,
} from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { EmergenciesService } from './emergencies.service.js';
import { M04ContextService } from './m04-context.service.js';
import { M04ReadOperation, M04WriteOperation } from './m04-openapi.js';

@ApiTags('M04 elder emergency')
@ApiCookieAuth('sessionCookie')
@Controller('elder/emergencies')
export class ElderEmergenciesController {
  constructor(
    @Inject(EmergenciesService)
    private readonly emergencies: EmergenciesService,
    @Inject(M04ContextService)
    private readonly context: M04ContextService,
  ) {}

  @Post()
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE,
    'Create one server-confirmed idempotent elder emergency signal',
    elderEmergencyStatusSchema,
    elderEmergencySignalRequestSchema,
  )
  async create(
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.emergencies.createElderEmergency(
      context,
      parseSchema(elderEmergencySignalRequestSchema, body),
      session,
    );
  }

  @Get(':emergencyEventId')
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_READ,
    'Read own emergency response progress',
    elderEmergencyStatusSchema,
    { uuidParams: ['emergencyEventId'] },
  )
  async get(
    @Param('emergencyEventId') emergencyEventId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.emergencies.getElderEmergency(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      session,
    );
  }
}

@ApiTags('M04 caregiver emergency')
@ApiCookieAuth('sessionCookie')
@Controller('caregiver/emergencies')
export class CaregiverEmergenciesController {
  constructor(
    @Inject(EmergenciesService)
    private readonly emergencies: EmergenciesService,
    @Inject(M04ContextService)
    private readonly context: M04ContextService,
  ) {}

  @Get()
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_READ,
    'List emergency events assigned to the active caregiver shift',
    caregiverEmergenciesPageSchema,
  )
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, [
      'caregiver',
    ]);
    return this.emergencies.listCaregiver(context, session);
  }

  @Get(':emergencyEventId')
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_READ,
    'Read one assigned active-shift emergency',
    caregiverEmergencySchema,
    { uuidParams: ['emergencyEventId'] },
  )
  async get(
    @Param('emergencyEventId') emergencyEventId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, [
      'caregiver',
    ]);
    return this.emergencies.getCaregiver(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      session,
    );
  }

  @Post(':emergencyEventId/acknowledge')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE,
    'Atomically acknowledge an assigned emergency',
    caregiverEmergencySchema,
    caregiverEmergencyAcknowledgeRequestSchema,
    { uuidParams: ['emergencyEventId'] },
  )
  async acknowledge(
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, [
      'caregiver',
    ]);
    return this.emergencies.acknowledge(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      parseSchema(caregiverEmergencyAcknowledgeRequestSchema, body),
      session,
    );
  }

  @Post(':emergencyEventId/milestones')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_RESPOND,
    'Record the ordered en-route or on-site response milestone',
    caregiverEmergencySchema,
    caregiverEmergencyMilestoneRequestSchema,
    { uuidParams: ['emergencyEventId'] },
  )
  async milestone(
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, [
      'caregiver',
    ]);
    const input = parseSchema(
      caregiverEmergencyMilestoneRequestSchema,
      body,
    );
    return input.kind === 'EN_ROUTE'
      ? this.emergencies.markEnRoute(
          context,
          parseSchema(uuidSchema, emergencyEventId),
          input,
          session,
        )
      : this.emergencies.markOnSite(
          context,
          parseSchema(uuidSchema, emergencyEventId),
          input,
          session,
        );
  }

  @Post(':emergencyEventId/resolve')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_RESOLVE,
    'Resolve an on-site emergency with the complete fixed checklist',
    caregiverEmergencySchema,
    caregiverEmergencyResolveRequestSchema,
    { uuidParams: ['emergencyEventId'] },
  )
  async resolve(
    @Param('emergencyEventId') emergencyEventId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, [
      'caregiver',
    ]);
    return this.emergencies.resolveCaregiver(
      context,
      parseSchema(uuidSchema, emergencyEventId),
      parseSchema(caregiverEmergencyResolveRequestSchema, body),
      session,
    );
  }
}

@ApiTags('M04 family emergency')
@ApiCookieAuth('sessionCookie')
@Controller('family')
export class FamilyEmergenciesController {
  constructor(
    @Inject(EmergenciesService)
    private readonly emergencies: EmergenciesService,
    @Inject(M04ContextService)
    private readonly context: M04ContextService,
  ) {}

  @Get('emergencies')
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ,
    'List privacy-filtered emergency summaries for linked elders',
    familyEmergencySummariesPageSchema,
    { querySchema: familyEmergenciesQuerySchema },
  )
  async list(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['family']);
    const parsed = parseSchema(familyEmergenciesQuerySchema, query);
    return this.emergencies.listFamily(
      context,
      { page: parsed.page, pageSize: parsed.pageSize },
      session,
    );
  }

  @Get('elders/:elderId/emergency-notification-preference')
  @M04ReadOperation(
    M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE,
    'Read own linked-elder emergency notification preference',
    familyEmergencyNotificationPreferenceSchema,
    { uuidParams: ['elderId'] },
  )
  async getPreference(
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['family']);
    return this.emergencies.getFamilyPreference(
      context,
      parseSchema(uuidSchema, elderId),
      session,
    );
  }

  @Put('elders/:elderId/emergency-notification-preference')
  @M04WriteOperation(
    M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE,
    'Replace own linked-elder emergency notification preference',
    familyEmergencyNotificationPreferenceSchema,
    familyEmergencyNotificationPreferenceUpdateRequestSchema,
    { uuidParams: ['elderId'] },
  )
  async updatePreference(
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['family']);
    return this.emergencies.updateFamilyPreference(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(
        familyEmergencyNotificationPreferenceUpdateRequestSchema,
        body,
      ),
      session,
    );
  }
}
