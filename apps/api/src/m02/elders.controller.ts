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
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { M02_PERMISSIONS } from '@eldercare/authz';
import {
  accessibilityProfileUpdateRequestSchema,
  admitElderRequestSchema,
  communicationPreferenceUpdateRequestSchema,
  consentHistoryQuerySchema,
  consentRecordCreateRequestSchema,
  consentWithdrawalRequestSchema,
  dischargeElderStayRequestSchema,
  elderCreateRequestSchema,
  elderTimelineQuerySchema,
  eldersQuerySchema,
  elderUpdateRequestSchema,
  emergencyContactCreateRequestSchema,
  emergencyContactUpdateRequestSchema,
  familyRelationshipCreateRequestSchema,
  familyRelationshipDecisionRequestSchema,
  personalBaselineCreateRequestSchema,
  sharingPreferencesUpdateRequestSchema,
  transferElderStayRequestSchema,
  uuidSchema,
  type AccessibilityProfile,
  type CaregiverElderSummary,
  type CommunicationPreference,
  type ConsentRecord,
  type ElderDetail,
  type ElderStay,
  type EldersPage,
  type FamilyElderSummary,
  type FamilyRelationship,
  type PersonalBaseline,
} from '@eldercare/contracts';
import { CurrentSession, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { EldersService } from './elders.service.js';
import { M02ContextService } from './m02-context.js';
import {
  CaregiverEldersPageDto,
  ElderDto,
  ElderRelatedPageDto,
  ElderRelatedRecordDto,
  EldersPageDto,
  FamilyElderSummaryDto,
  FamilyEldersPageDto,
} from './m02.dto.js';
import { M02ContextRoute } from './m02-context.guard.js';
import { M02ReadOperation, M02WriteOperation } from './m02-openapi.js';

@ApiTags('elder records')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/elders')
export class EldersController {
  constructor(
    @Inject(EldersService) private readonly elders: EldersService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get()
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_BASIC, 'List accessible elders', EldersPageDto)
  async list(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<EldersPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.list(context, parseSchema(eldersQuerySchema, query), session);
  }

  @Post()
  @M02WriteOperation(M02_PERMISSIONS.ELDER_CREATE, 'Create an elder record', ElderDto, elderCreateRequestSchema, 'created')
  async create(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderDetail> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.create(context, parseSchema(elderCreateRequestSchema, body), session);
  }

  @Get(':elderId')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_BASIC, 'Read an accessible elder summary', ElderDto)
  async get(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderDetail> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.get(
      context,
      parseSchema(uuidSchema, elderId),
      session,
      'BASIC',
    );
  }

  @Put(':elderId')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_UPDATE, 'Update an elder record', ElderDto, elderUpdateRequestSchema)
  async update(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderDetail> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.update(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(elderUpdateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/sensitive')
  @M02ReadOperation(
    M02_PERMISSIONS.ELDER_READ_SENSITIVE,
    'Read sensitive elder fields with resource authorization',
    ElderRelatedRecordDto,
  )
  async getSensitive(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.getSensitive(context, parseSchema(uuidSchema, elderId), session);
  }

  @Get(':elderId/stays')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_BASIC, 'List admission and bed-stay history', ElderRelatedPageDto)
  async listStays(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listStays(
      context,
      parseSchema(uuidSchema, elderId),
      query,
      session,
    );
  }

  @Post(':elderId/stays')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_STAY_MANAGE, 'Admit an elder to an available bed', ElderRelatedRecordDto, admitElderRequestSchema, 'created')
  async admit(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderStay> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.admit(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(admitElderRequestSchema, body),
      session,
    );
  }

  @Post(':elderId/stays/:stayId/transfer')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_STAY_MANAGE, 'Transfer an active stay to another bed', ElderRelatedRecordDto, transferElderStayRequestSchema, 'created')
  async transfer(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('stayId') stayId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderStay> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.transfer(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, stayId),
      parseSchema(transferElderStayRequestSchema, body),
      session,
    );
  }

  @Post(':elderId/stays/:stayId/discharge')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_STAY_MANAGE, 'Discharge an active elder stay', ElderRelatedRecordDto, dischargeElderStayRequestSchema, 'created')
  async discharge(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('stayId') stayId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ElderStay> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.discharge(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, stayId),
      parseSchema(dischargeElderStayRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/family-relationships')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'List family relationships and sharing state', ElderRelatedPageDto)
  async listRelationships(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listRelationships(context, parseSchema(uuidSchema, elderId), query, session);
  }

  @Post(':elderId/family-relationships')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_RELATIONSHIP_MANAGE, 'Create a pending family relationship', ElderRelatedRecordDto, familyRelationshipCreateRequestSchema, 'created')
  async createRelationship(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FamilyRelationship> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.createRelationship(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(familyRelationshipCreateRequestSchema, body),
      session,
    );
  }

  @Post(':elderId/family-relationships/:relationshipId/verify')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_RELATIONSHIP_MANAGE, 'Verify a family relationship', ElderRelatedRecordDto, familyRelationshipDecisionRequestSchema, 'created')
  async verifyRelationship(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('relationshipId') relationshipId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FamilyRelationship> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.decideRelationship(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, relationshipId),
      'VERIFIED',
      parseSchema(familyRelationshipDecisionRequestSchema, body),
      session,
    );
  }

  @Post(':elderId/family-relationships/:relationshipId/revoke')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_RELATIONSHIP_MANAGE, 'Revoke a family relationship', ElderRelatedRecordDto, familyRelationshipDecisionRequestSchema, 'created')
  async revokeRelationship(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('relationshipId') relationshipId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FamilyRelationship> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.decideRelationship(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, relationshipId),
      'REVOKED',
      parseSchema(familyRelationshipDecisionRequestSchema, body),
      session,
    );
  }

  @Put(':elderId/family-relationships/:relationshipId/sharing-preferences')
  @M02WriteOperation(M02_PERMISSIONS.ELDER_RELATIONSHIP_MANAGE, 'Replace family sharing preferences now; omitted and scheduled fields are denied', ElderRelatedRecordDto, sharingPreferencesUpdateRequestSchema)
  async updateSharingPreferences(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('relationshipId') relationshipId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FamilyRelationship> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.updateSharingPreferences(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, relationshipId),
      parseSchema(sharingPreferencesUpdateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/emergency-contacts')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'List elder emergency contacts', ElderRelatedPageDto)
  async listEmergencyContacts(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listEmergencyContacts(context, parseSchema(uuidSchema, elderId), query, session);
  }

  @Post(':elderId/emergency-contacts')
  @M02WriteOperation([M02_PERMISSIONS.ELDER_UPDATE, M02_PERMISSIONS.ELDER_READ_SENSITIVE], 'Create an elder emergency contact', ElderRelatedRecordDto, emergencyContactCreateRequestSchema, 'created')
  async createEmergencyContact(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.createEmergencyContact(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(emergencyContactCreateRequestSchema, body),
      session,
    );
  }

  @Put(':elderId/emergency-contacts/:contactId')
  @M02WriteOperation([M02_PERMISSIONS.ELDER_UPDATE, M02_PERMISSIONS.ELDER_READ_SENSITIVE], 'Update an elder emergency contact', ElderRelatedRecordDto, emergencyContactUpdateRequestSchema)
  async updateEmergencyContact(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.updateEmergencyContact(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, contactId),
      parseSchema(emergencyContactUpdateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/accessibility-profile')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'Read the elder accessibility profile', ElderRelatedRecordDto)
  async getAccessibilityProfile(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessibilityProfile | null> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.getAccessibilityProfile(context, parseSchema(uuidSchema, elderId), session);
  }

  @Put(':elderId/accessibility-profile')
  @M02WriteOperation([M02_PERMISSIONS.ELDER_UPDATE, M02_PERMISSIONS.ELDER_READ_SENSITIVE], 'Upsert the elder accessibility profile', ElderRelatedRecordDto, accessibilityProfileUpdateRequestSchema)
  async updateAccessibilityProfile(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessibilityProfile> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.updateAccessibilityProfile(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(accessibilityProfileUpdateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/communication-preference')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'Read the elder communication preference', ElderRelatedRecordDto)
  async getCommunicationPreference(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CommunicationPreference | null> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.getCommunicationPreference(context, parseSchema(uuidSchema, elderId), session);
  }

  @Put(':elderId/communication-preference')
  @M02WriteOperation([M02_PERMISSIONS.ELDER_UPDATE, M02_PERMISSIONS.ELDER_READ_SENSITIVE], 'Upsert the elder communication preference', ElderRelatedRecordDto, communicationPreferenceUpdateRequestSchema)
  async updateCommunicationPreference(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CommunicationPreference> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.updateCommunicationPreference(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(communicationPreferenceUpdateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/personal-baselines')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'List personal baselines with explicit provenance', ElderRelatedPageDto)
  async listPersonalBaselines(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listPersonalBaselines(
      context,
      parseSchema(uuidSchema, elderId),
      query,
      session,
    );
  }

  @Post(':elderId/personal-baselines')
  @M02WriteOperation([M02_PERMISSIONS.ELDER_UPDATE, M02_PERMISSIONS.ELDER_READ_SENSITIVE], 'Create a provenance-labelled personal baseline', ElderRelatedRecordDto, personalBaselineCreateRequestSchema, 'created')
  async createPersonalBaseline(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<PersonalBaseline> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.createPersonalBaseline(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(personalBaselineCreateRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/consents')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_READ_SENSITIVE, 'List append-only elder consent history', ElderRelatedPageDto)
  async listConsents(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listConsents(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(consentHistoryQuerySchema, query),
      session,
    );
  }

  @Post(':elderId/consents')
  @M02WriteOperation(M02_PERMISSIONS.CONSENT_MANAGE, 'Record a grant or decline as a new consent version', ElderRelatedRecordDto, consentRecordCreateRequestSchema, 'created')
  async createConsent(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentRecord> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.createConsent(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(consentRecordCreateRequestSchema, body),
      session,
    );
  }

  @Post(':elderId/consents/:consentId/withdraw')
  @M02WriteOperation(M02_PERMISSIONS.CONSENT_MANAGE, 'Withdraw consent as an append-only version', ElderRelatedRecordDto, consentWithdrawalRequestSchema, 'created')
  async withdrawConsent(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Param('consentId') consentId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentRecord> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.withdrawConsent(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(uuidSchema, consentId),
      parseSchema(consentWithdrawalRequestSchema, body),
      session,
    );
  }

  @Get(':elderId/timeline')
  @M02ReadOperation(M02_PERMISSIONS.ELDER_TIMELINE_READ, 'List audit-safe elder timeline entries', ElderRelatedPageDto)
  async listTimeline(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('elderId') elderId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.elders.listTimeline(
      context,
      parseSchema(uuidSchema, elderId),
      parseSchema(elderTimelineQuerySchema, query),
      session,
    );
  }
}

@ApiTags('role elder summaries')
@ApiCookieAuth('sessionCookie')
@Controller()
export class PortalEldersController {
  constructor(@Inject(EldersService) private readonly elders: EldersService) {}

  @Get('family/elders')
  @RequirePermissions(M02_PERMISSIONS.ELDER_READ_BASIC)
  @ApiOperation({ summary: 'List only verified, consented and field-filtered linked elders' })
  @ApiOkResponse({ type: FamilyEldersPageDto })
  async listFamilyElders(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ items: FamilyElderSummary[]; pageInfo: Record<string, number> }> {
    return this.elders.listFamilyElders(session, query, request.correlationId ?? 'unknown-correlation');
  }

  @Get('family/elders/:elderId')
  @RequirePermissions(M02_PERMISSIONS.ELDER_READ_BASIC)
  @ApiOperation({ summary: 'Read one linked elder through consent-aware field projection' })
  @ApiOkResponse({ type: FamilyElderSummaryDto })
  async getFamilyElder(
    @Param('elderId') elderId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FamilyElderSummary> {
    return this.elders.getFamilyElder(
      session,
      parseSchema(uuidSchema, elderId),
      request.correlationId ?? 'unknown-correlation',
    );
  }

  @Get('caregiver/elders')
  @RequirePermissions(M02_PERMISSIONS.ELDER_READ_BASIC)
  @ApiOperation({ summary: 'List elders assigned through a currently active caregiver shift' })
  @ApiOkResponse({ type: CaregiverEldersPageDto })
  async listCaregiverElders(
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ items: CaregiverElderSummary[]; pageInfo: Record<string, number> }> {
    return this.elders.listCaregiverElders(
      session,
      query,
      request.correlationId ?? 'unknown-correlation',
    );
  }
}
