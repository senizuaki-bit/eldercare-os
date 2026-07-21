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
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { M02_PERMISSIONS } from '@eldercare/authz';
import {
  bedCreateRequestSchema,
  bedsQuerySchema,
  bedUpdateRequestSchema,
  buildingCreateRequestSchema,
  buildingsQuerySchema,
  buildingUpdateRequestSchema,
  careLevelCreateRequestSchema,
  careLevelsQuerySchema,
  careLevelUpdateRequestSchema,
  floorCreateRequestSchema,
  floorsQuerySchema,
  floorUpdateRequestSchema,
  roomCreateRequestSchema,
  roomsQuerySchema,
  roomUpdateRequestSchema,
  uuidSchema,
  zoneCreateRequestSchema,
  zonesQuerySchema,
  zoneUpdateRequestSchema,
  type Bed,
  type BedsPage,
  type Building,
  type BuildingsPage,
  type CareLevel,
  type CareLevelsPage,
  type Floor,
  type FloorsPage,
  type Room,
  type RoomsPage,
  type Zone,
  type ZonesPage,
} from '@eldercare/contracts';
import { CurrentSession, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { FacilityDirectoryService } from './facility-directory.service.js';
import { M02ContextService } from './m02-context.js';
import {
  BedDto,
  BedsPageDto,
  DirectoryPageDto,
  DirectoryRecordDto,
  RoomDto,
  RoomsPageDto,
} from './m02.dto.js';
import { M02ContextRoute } from './m02-context.guard.js';
import { openApiBody } from './m02-openapi.js';

@ApiTags('facility directory')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/directory')
export class FacilityDirectoryController {
  constructor(
    @Inject(FacilityDirectoryService) private readonly directory: FacilityDirectoryService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get('buildings')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'List buildings in the active facility' })
  @ApiOkResponse({ type: DirectoryPageDto })
  @ApiBadRequestResponse({ description: 'The query is invalid.' })
  @ApiNotFoundResponse({ description: 'The tenant context is unavailable.' })
  async listBuildings(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<BuildingsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listBuildings(context, parseSchema(buildingsQuerySchema, query));
  }

  @Post('buildings')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a building in the active facility' })
  @ApiBody(openApiBody(buildingCreateRequestSchema))
  @ApiCreatedResponse({ type: DirectoryRecordDto })
  @ApiBadRequestResponse({ description: 'The request is invalid.' })
  @ApiConflictResponse({ description: 'The code is already in use.' })
  @ApiForbiddenResponse({ description: 'The permission is missing.' })
  async createBuilding(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Building> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createBuilding(
      context,
      parseSchema(buildingCreateRequestSchema, body),
      session,
    );
  }

  @Get('buildings/:buildingId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'Read one building without tenant enumeration' })
  @ApiOkResponse({ type: DirectoryRecordDto })
  @ApiNotFoundResponse({ description: 'The record does not exist or is inaccessible.' })
  async getBuilding(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('buildingId') buildingId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Building> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getBuilding(context, parseSchema(uuidSchema, buildingId));
  }

  @Put('buildings/:buildingId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or archive a building with optimistic concurrency' })
  @ApiBody(openApiBody(buildingUpdateRequestSchema))
  @ApiOkResponse({ type: DirectoryRecordDto })
  @ApiConflictResponse({ description: 'The expected version is stale.' })
  @ApiNotFoundResponse({ description: 'The record does not exist or is inaccessible.' })
  async updateBuilding(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('buildingId') buildingId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Building> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateBuilding(
      context,
      parseSchema(uuidSchema, buildingId),
      parseSchema(buildingUpdateRequestSchema, body),
      session,
    );
  }

  @Get('floors')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'List floors in the active facility' })
  @ApiOkResponse({ type: DirectoryPageDto })
  async listFloors(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<FloorsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listFloors(context, parseSchema(floorsQuerySchema, query));
  }

  @Post('floors')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a floor under a facility building' })
  @ApiBody(openApiBody(floorCreateRequestSchema))
  @ApiCreatedResponse({ type: DirectoryRecordDto })
  async createFloor(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Floor> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createFloor(context, parseSchema(floorCreateRequestSchema, body), session);
  }

  @Get('floors/:floorId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'Read one floor without tenant enumeration' })
  @ApiOkResponse({ type: DirectoryRecordDto })
  async getFloor(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('floorId') floorId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Floor> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getFloor(context, parseSchema(uuidSchema, floorId));
  }

  @Put('floors/:floorId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or archive a floor with optimistic concurrency' })
  @ApiBody(openApiBody(floorUpdateRequestSchema))
  @ApiOkResponse({ type: DirectoryRecordDto })
  async updateFloor(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('floorId') floorId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Floor> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateFloor(
      context,
      parseSchema(uuidSchema, floorId),
      parseSchema(floorUpdateRequestSchema, body),
      session,
    );
  }

  @Get('zones')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'List care zones in the active facility' })
  @ApiOkResponse({ type: DirectoryPageDto })
  async listZones(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<ZonesPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listZones(context, parseSchema(zonesQuerySchema, query));
  }

  @Post('zones')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a care zone under a facility floor' })
  @ApiBody(openApiBody(zoneCreateRequestSchema))
  @ApiCreatedResponse({ type: DirectoryRecordDto })
  async createZone(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Zone> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createZone(context, parseSchema(zoneCreateRequestSchema, body), session);
  }

  @Get('zones/:zoneId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'Read one care zone without tenant enumeration' })
  @ApiOkResponse({ type: DirectoryRecordDto })
  async getZone(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('zoneId') zoneId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Zone> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getZone(context, parseSchema(uuidSchema, zoneId));
  }

  @Put('zones/:zoneId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or archive a care zone with optimistic concurrency' })
  @ApiBody(openApiBody(zoneUpdateRequestSchema))
  @ApiOkResponse({ type: DirectoryRecordDto })
  async updateZone(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('zoneId') zoneId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Zone> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateZone(
      context,
      parseSchema(uuidSchema, zoneId),
      parseSchema(zoneUpdateRequestSchema, body),
      session,
    );
  }

  @Get('rooms')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'List rooms with derived bed occupancy counts' })
  @ApiOkResponse({ type: RoomsPageDto })
  async listRooms(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<RoomsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listRooms(context, parseSchema(roomsQuerySchema, query));
  }

  @Post('rooms')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a room under a facility floor' })
  @ApiBody(openApiBody(roomCreateRequestSchema))
  @ApiCreatedResponse({ type: RoomDto })
  async createRoom(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Room> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createRoom(context, parseSchema(roomCreateRequestSchema, body), session);
  }

  @Get('rooms/:roomId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_READ)
  @ApiOperation({ summary: 'Read one room with derived occupancy' })
  @ApiOkResponse({ type: RoomDto })
  async getRoom(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('roomId') roomId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Room> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getRoom(context, parseSchema(uuidSchema, roomId));
  }

  @Put('rooms/:roomId')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or archive a room with optimistic concurrency' })
  @ApiBody(openApiBody(roomUpdateRequestSchema))
  @ApiOkResponse({ type: RoomDto })
  async updateRoom(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Room> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateRoom(
      context,
      parseSchema(uuidSchema, roomId),
      parseSchema(roomUpdateRequestSchema, body),
      session,
    );
  }

  @Get('beds')
  @RequirePermissions(
    M02_PERMISSIONS.FACILITY_DIRECTORY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
  )
  @ApiOperation({ summary: 'List beds with occupancy derived from active stays' })
  @ApiOkResponse({ type: BedsPageDto })
  async listBeds(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<BedsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listBeds(context, parseSchema(bedsQuerySchema, query));
  }

  @Post('beds')
  @RequirePermissions(M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a bed under a facility room' })
  @ApiBody(openApiBody(bedCreateRequestSchema))
  @ApiCreatedResponse({ type: BedDto })
  async createBed(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Bed> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createBed(context, parseSchema(bedCreateRequestSchema, body), session);
  }

  @Get('beds/:bedId')
  @RequirePermissions(
    M02_PERMISSIONS.FACILITY_DIRECTORY_READ,
    M02_PERMISSIONS.ELDER_READ_BASIC,
  )
  @ApiOperation({ summary: 'Read one bed with active occupancy' })
  @ApiOkResponse({ type: BedDto })
  async getBed(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('bedId') bedId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Bed> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getBed(context, parseSchema(uuidSchema, bedId));
  }

  @Put('beds/:bedId')
  @RequirePermissions(
    M02_PERMISSIONS.FACILITY_DIRECTORY_MANAGE,
    M02_PERMISSIONS.ELDER_READ_BASIC,
  )
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or retire a bed with optimistic concurrency' })
  @ApiBody(openApiBody(bedUpdateRequestSchema))
  @ApiOkResponse({ type: BedDto })
  async updateBed(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('bedId') bedId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Bed> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateBed(
      context,
      parseSchema(uuidSchema, bedId),
      parseSchema(bedUpdateRequestSchema, body),
      session,
    );
  }

  @Get('care-levels')
  @RequirePermissions(M02_PERMISSIONS.CARE_LEVEL_READ)
  @ApiOperation({ summary: 'List facility care levels' })
  @ApiOkResponse({ type: DirectoryPageDto })
  async listCareLevels(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Query() query: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CareLevelsPage> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.listCareLevels(context, parseSchema(careLevelsQuerySchema, query));
  }

  @Post('care-levels')
  @RequirePermissions(M02_PERMISSIONS.CARE_LEVEL_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Create a facility care level' })
  @ApiBody(openApiBody(careLevelCreateRequestSchema))
  @ApiCreatedResponse({ type: DirectoryRecordDto })
  async createCareLevel(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CareLevel> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.createCareLevel(
      context,
      parseSchema(careLevelCreateRequestSchema, body),
      session,
    );
  }

  @Get('care-levels/:careLevelId')
  @RequirePermissions(M02_PERMISSIONS.CARE_LEVEL_READ)
  @ApiOperation({ summary: 'Read one facility care level' })
  @ApiOkResponse({ type: DirectoryRecordDto })
  async getCareLevel(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('careLevelId') careLevelId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CareLevel> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.getCareLevel(context, parseSchema(uuidSchema, careLevelId));
  }

  @Put('care-levels/:careLevelId')
  @RequirePermissions(M02_PERMISSIONS.CARE_LEVEL_MANAGE)
  @ApiSecurity('csrf')
  @ApiOperation({ summary: 'Update or archive a care level with optimistic concurrency' })
  @ApiBody(openApiBody(careLevelUpdateRequestSchema))
  @ApiOkResponse({ type: DirectoryRecordDto })
  async updateCareLevel(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('careLevelId') careLevelId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<CareLevel> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.directory.updateCareLevel(
      context,
      parseSchema(uuidSchema, careLevelId),
      parseSchema(careLevelUpdateRequestSchema, body),
      session,
    );
  }
}
