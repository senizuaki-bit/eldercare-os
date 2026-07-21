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
import { M02_PERMISSIONS } from '@eldercare/authz';
import {
  shiftAssignmentCreateRequestSchema,
  shiftAssignmentUpdateRequestSchema,
  shiftCreateRequestSchema,
  shiftsQuerySchema,
  shiftUpdateRequestSchema,
  staffCreateRequestSchema,
  staffQuerySchema,
  staffUpdateRequestSchema,
  teamCreateRequestSchema,
  teamMembershipCreateRequestSchema,
  teamMembershipUpdateRequestSchema,
  teamsQuerySchema,
  teamUpdateRequestSchema,
  uuidSchema,
  type Shift,
  type ShiftAssignment,
  type ShiftsPage,
  type StaffPage,
  type StaffProfile,
  type Team,
  type TeamMembership,
  type TeamsPage,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M02ContextService } from './m02-context.js';
import {
  ElderRelatedPageDto,
  ElderRelatedRecordDto,
  ShiftDto,
  ShiftsPageDto,
  StaffDto,
  StaffPageDto,
  TeamDto,
  TeamsPageDto,
} from './m02.dto.js';
import { M02ContextRoute } from './m02-context.guard.js';
import { M02ReadOperation, M02WriteOperation } from './m02-openapi.js';
import { StaffingService } from './staffing.service.js';

@ApiTags('staffing and shifts')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId')
export class StaffingController {
  constructor(
    @Inject(StaffingService) private readonly staffing: StaffingService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get('staff')
  @M02ReadOperation(M02_PERMISSIONS.STAFF_READ, 'List facility staff profiles', StaffPageDto)
  async listStaff(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.listStaff(context, parseSchema(staffQuerySchema, query));
  }

  @Post('staff')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Create a staff profile for an existing user',
    StaffDto,
    staffCreateRequestSchema,
    'created',
  )
  async createStaff(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffProfile> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.createStaff(context, parseSchema(staffCreateRequestSchema, body), session);
  }

  @Get('staff/:staffProfileId')
  @M02ReadOperation(M02_PERMISSIONS.STAFF_READ, 'Read one facility staff profile', StaffDto)
  async getStaff(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('staffProfileId') staffProfileId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffProfile> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.getStaff(context, parseSchema(uuidSchema, staffProfileId));
  }

  @Put('staff/:staffProfileId')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Update or archive a staff profile',
    StaffDto,
    staffUpdateRequestSchema,
  )
  async updateStaff(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('staffProfileId') staffProfileId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffProfile> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.updateStaff(
      context,
      parseSchema(uuidSchema, staffProfileId),
      parseSchema(staffUpdateRequestSchema, body),
      session,
    );
  }

  @Get('teams')
  @M02ReadOperation(M02_PERMISSIONS.STAFF_READ, 'List facility care teams', TeamsPageDto)
  async listTeams(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<TeamsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.listTeams(context, parseSchema(teamsQuerySchema, query));
  }

  @Post('teams')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Create a facility care team',
    TeamDto,
    teamCreateRequestSchema,
    'created',
  )
  async createTeam(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Team> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.createTeam(context, parseSchema(teamCreateRequestSchema, body), session);
  }

  @Get('teams/:teamId')
  @M02ReadOperation(M02_PERMISSIONS.STAFF_READ, 'Read one facility care team', TeamDto)
  async getTeam(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('teamId') teamId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Team> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.getTeam(context, parseSchema(uuidSchema, teamId));
  }

  @Put('teams/:teamId')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Update or archive a facility care team',
    TeamDto,
    teamUpdateRequestSchema,
  )
  async updateTeam(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Team> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.updateTeam(
      context,
      parseSchema(uuidSchema, teamId),
      parseSchema(teamUpdateRequestSchema, body),
      session,
    );
  }

  @Get('teams/:teamId/memberships')
  @M02ReadOperation(M02_PERMISSIONS.STAFF_READ, 'List team membership history', ElderRelatedPageDto)
  async listTeamMemberships(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('teamId') teamId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.listTeamMemberships(context, parseSchema(uuidSchema, teamId), query);
  }

  @Post('teams/:teamId/memberships')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Add a time-bounded team membership',
    ElderRelatedRecordDto,
    teamMembershipCreateRequestSchema,
    'created',
  )
  async createTeamMembership(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<TeamMembership> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.createTeamMembership(
      context,
      parseSchema(uuidSchema, teamId),
      parseSchema(teamMembershipCreateRequestSchema, body),
      session,
    );
  }

  @Put('teams/:teamId/memberships/:membershipId')
  @M02WriteOperation(
    M02_PERMISSIONS.STAFF_MANAGE,
    'Update a team membership with optimistic concurrency',
    ElderRelatedRecordDto,
    teamMembershipUpdateRequestSchema,
  )
  async updateTeamMembership(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<TeamMembership> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.updateTeamMembership(
      context,
      parseSchema(uuidSchema, teamId),
      parseSchema(uuidSchema, membershipId),
      parseSchema(teamMembershipUpdateRequestSchema, body),
      session,
    );
  }

  @Get('shifts')
  @M02ReadOperation(M02_PERMISSIONS.SHIFT_READ, 'List shifts in a bounded week-view range', ShiftsPageDto)
  async listShifts(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShiftsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.listShifts(context, parseSchema(shiftsQuerySchema, query));
  }

  @Post('shifts')
  @M02WriteOperation(
    M02_PERMISSIONS.SHIFT_MANAGE,
    'Create a facility shift',
    ShiftDto,
    shiftCreateRequestSchema,
    'created',
  )
  async createShift(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Shift> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.createShift(context, parseSchema(shiftCreateRequestSchema, body), session);
  }

  @Get('shifts/:shiftId')
  @M02ReadOperation(M02_PERMISSIONS.SHIFT_READ, 'Read one shift and its assignments', ShiftDto)
  async getShift(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('shiftId') shiftId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Shift> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.getShift(context, parseSchema(uuidSchema, shiftId));
  }

  @Put('shifts/:shiftId')
  @M02WriteOperation(
    M02_PERMISSIONS.SHIFT_MANAGE,
    'Update a shift with optimistic concurrency',
    ShiftDto,
    shiftUpdateRequestSchema,
  )
  async updateShift(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('shiftId') shiftId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Shift> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.updateShift(
      context,
      parseSchema(uuidSchema, shiftId),
      parseSchema(shiftUpdateRequestSchema, body),
      session,
    );
  }

  @Post('shifts/:shiftId/assignments')
  @M02WriteOperation(
    M02_PERMISSIONS.SHIFT_MANAGE,
    'Assign staff with explicit floor, zone or elder scopes',
    ElderRelatedRecordDto,
    shiftAssignmentCreateRequestSchema,
    'created',
  )
  async createShiftAssignment(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('shiftId') shiftId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShiftAssignment> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.createShiftAssignment(
      context,
      parseSchema(uuidSchema, shiftId),
      parseSchema(shiftAssignmentCreateRequestSchema, body),
      session,
    );
  }

  @Put('shifts/:shiftId/assignments/:assignmentId')
  @M02WriteOperation(
    M02_PERMISSIONS.SHIFT_MANAGE,
    'Update a shift assignment and its resource scopes',
    ElderRelatedRecordDto,
    shiftAssignmentUpdateRequestSchema,
  )
  async updateShiftAssignment(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('shiftId') shiftId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShiftAssignment> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.staffing.updateShiftAssignment(
      context,
      parseSchema(uuidSchema, shiftId),
      parseSchema(uuidSchema, assignmentId),
      parseSchema(shiftAssignmentUpdateRequestSchema, body),
      session,
    );
  }
}
