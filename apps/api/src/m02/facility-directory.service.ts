import { Inject, Injectable } from '@nestjs/common';
import type {
  Bed,
  BedCreateRequest,
  BedsPage,
  BedsQuery,
  BedUpdateRequest,
  Building,
  BuildingCreateRequest,
  BuildingsPage,
  BuildingsQuery,
  BuildingUpdateRequest,
  CareLevel,
  CareLevelCreateRequest,
  CareLevelsPage,
  CareLevelsQuery,
  CareLevelUpdateRequest,
  Floor,
  FloorCreateRequest,
  FloorsPage,
  FloorsQuery,
  FloorUpdateRequest,
  Room,
  RoomCreateRequest,
  RoomsPage,
  RoomsQuery,
  RoomUpdateRequest,
  Zone,
  ZoneCreateRequest,
  ZonesPage,
  ZonesQuery,
  ZoneUpdateRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { M02FacilityContext } from './m02-context.js';
import { m02Conflict } from './m02-errors.js';
import { M02MutationService } from './m02-mutation.service.js';

@Injectable()
export class FacilityDirectoryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(M02MutationService) private readonly mutations: M02MutationService,
  ) {}

  async listBuildings(context: M02FacilityContext, query: BuildingsQuery): Promise<BuildingsPage> {
    const where: Prisma.BuildingWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : { OR: searchFields(query.search, ['code', 'name']) }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.building.count({ where }),
      this.database.client.building.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapBuilding), pageInfo: pageInfo(query, total) };
  }

  async getBuilding(context: M02FacilityContext, id: string): Promise<Building> {
    const record = await this.database.client.building.findFirst({ where: scoped(context, id) });
    if (record === null) throw resourceNotFound();
    return mapBuilding(record);
  }

  async createBuilding(
    context: M02FacilityContext,
    input: BuildingCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Building> {
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const record = await tx.building.create({
        data: { ...input, organizationId: context.organizationId, facilityId: context.facilityId },
      });
      await this.recordDirectoryMutation(tx, context, session, 'BUILDING', record.id, record.version, 'CREATED');
      return mapBuilding(record);
    }));
  }

  async updateBuilding(
    context: M02FacilityContext,
    id: string,
    input: BuildingUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Building> {
    return this.updateVersioned(
      context,
      id,
      input.expectedVersion,
      'BUILDING',
      session,
      async (tx) => {
        if (input.status !== undefined && input.status !== 'ACTIVE') {
          const activeChild = await tx.floor.findFirst({
            where: { ...scoped(context), buildingId: id, status: 'ACTIVE' },
            select: { id: true },
          });
          const activeStay = await tx.elderStay.findFirst({
            where: { ...scoped(context), status: 'ACTIVE', bed: { room: { floor: { buildingId: id } } } },
            select: { id: true },
          });
          if (activeChild !== null || activeStay !== null) throw m02Conflict('ACTIVE_CHILD_PREVENTS_DEACTIVATION');
        }
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.building.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count === 0) return null;
        return tx.building.findUniqueOrThrow({ where: { id } });
      },
      mapBuilding,
    );
  }

  async listFloors(context: M02FacilityContext, query: FloorsQuery): Promise<FloorsPage> {
    const where: Prisma.FloorWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.buildingId === undefined ? {} : { buildingId: query.buildingId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : { OR: searchFields(query.search, ['code', 'name']) }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.floor.count({ where }),
      this.database.client.floor.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapFloor), pageInfo: pageInfo(query, total) };
  }

  async getFloor(context: M02FacilityContext, id: string): Promise<Floor> {
    const record = await this.database.client.floor.findFirst({ where: scoped(context, id) });
    if (record === null) throw resourceNotFound();
    return mapFloor(record);
  }

  async createFloor(
    context: M02FacilityContext,
    input: FloorCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Floor> {
    await this.assertScopedParent('building', context, input.buildingId);
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const building = await tx.building.findFirst({
        where: { ...scoped(context, input.buildingId), status: 'ACTIVE' },
        select: { id: true },
      });
      if (building === null) throw m02Conflict('PARENT_NOT_ACTIVE');
      const record = await tx.floor.create({
        data: { ...input, organizationId: context.organizationId, facilityId: context.facilityId },
      });
      await this.recordDirectoryMutation(tx, context, session, 'FLOOR', record.id, record.version, 'CREATED');
      return mapFloor(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateFloor(
    context: M02FacilityContext,
    id: string,
    input: FloorUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Floor> {
    return this.updateVersioned(
      context,
      id,
      input.expectedVersion,
      'FLOOR',
      session,
      async (tx) => {
        if (input.status === 'ACTIVE') {
          const floor = await tx.floor.findFirst({
            where: { ...scoped(context), id, building: { status: 'ACTIVE' } },
            select: { id: true },
          });
          if (floor === null) throw m02Conflict('PARENT_NOT_ACTIVE');
        }
        if (input.status !== undefined && input.status !== 'ACTIVE') {
          const [zone, room, stay] = await Promise.all([
            tx.zone.findFirst({ where: { ...scoped(context), floorId: id, status: 'ACTIVE' }, select: { id: true } }),
            tx.room.findFirst({ where: { ...scoped(context), floorId: id, status: 'ACTIVE' }, select: { id: true } }),
            tx.elderStay.findFirst({
              where: { ...scoped(context), status: 'ACTIVE', bed: { room: { floorId: id } } },
              select: { id: true },
            }),
          ]);
          if (zone !== null || room !== null || stay !== null) throw m02Conflict('ACTIVE_CHILD_PREVENTS_DEACTIVATION');
        }
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.floor.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        return changed.count === 0 ? null : tx.floor.findUniqueOrThrow({ where: { id } });
      },
      mapFloor,
    );
  }

  async listZones(context: M02FacilityContext, query: ZonesQuery): Promise<ZonesPage> {
    const where: Prisma.ZoneWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.buildingId === undefined ? {} : { floor: { buildingId: query.buildingId } }),
      ...(query.floorId === undefined ? {} : { floorId: query.floorId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : { OR: searchFields(query.search, ['code', 'name']) }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.zone.count({ where }),
      this.database.client.zone.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapZone), pageInfo: pageInfo(query, total) };
  }

  async getZone(context: M02FacilityContext, id: string): Promise<Zone> {
    const record = await this.database.client.zone.findFirst({ where: scoped(context, id) });
    if (record === null) throw resourceNotFound();
    return mapZone(record);
  }

  async createZone(
    context: M02FacilityContext,
    input: ZoneCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Zone> {
    await this.assertScopedParent('floor', context, input.floorId);
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const floor = await tx.floor.findFirst({
        where: {
          ...scoped(context, input.floorId),
          status: 'ACTIVE',
          building: { status: 'ACTIVE' },
        },
        select: { id: true },
      });
      if (floor === null) throw m02Conflict('PARENT_NOT_ACTIVE');
      const record = await tx.zone.create({
        data: { ...input, organizationId: context.organizationId, facilityId: context.facilityId },
      });
      await this.recordDirectoryMutation(tx, context, session, 'ZONE', record.id, record.version, 'CREATED');
      return mapZone(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateZone(
    context: M02FacilityContext,
    id: string,
    input: ZoneUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Zone> {
    return this.updateVersioned(
      context,
      id,
      input.expectedVersion,
      'ZONE',
      session,
      async (tx) => {
        if (input.status === 'ACTIVE') {
          const zone = await tx.zone.findFirst({
            where: { ...scoped(context), id, floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } } },
            select: { id: true },
          });
          if (zone === null) throw m02Conflict('PARENT_NOT_ACTIVE');
        }
        if (input.status !== undefined && input.status !== 'ACTIVE') {
          const [room, stay] = await Promise.all([
            tx.room.findFirst({ where: { ...scoped(context), zoneId: id, status: 'ACTIVE' }, select: { id: true } }),
            tx.elderStay.findFirst({
              where: { ...scoped(context), status: 'ACTIVE', bed: { room: { zoneId: id } } },
              select: { id: true },
            }),
          ]);
          if (room !== null || stay !== null) throw m02Conflict('ACTIVE_CHILD_PREVENTS_DEACTIVATION');
        }
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.zone.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        return changed.count === 0 ? null : tx.zone.findUniqueOrThrow({ where: { id } });
      },
      mapZone,
    );
  }

  async listRooms(context: M02FacilityContext, query: RoomsQuery): Promise<RoomsPage> {
    const where = roomWhere(context, query);
    const [total, records] = await this.database.client.$transaction([
      this.database.client.room.count({ where }),
      this.database.client.room.findMany({
        where,
        include: roomOccupancyInclude,
        orderBy: query.sort === 'occupiedBedCount' ? { code: 'asc' } : roomOrderBy(query),
        ...(query.sort === 'occupiedBedCount'
          ? {}
          : { skip: pageSkip(query), take: query.pageSize }),
      }),
    ]);
    const mapped = records.map(mapRoom);
    const items = query.sort === 'occupiedBedCount'
      ? mapped
          .sort((left, right) => {
            const difference = left.occupiedBedCount - right.occupiedBedCount;
            return (difference === 0 ? left.code.localeCompare(right.code) : difference) *
              (query.direction === 'asc' ? 1 : -1);
          })
          .slice(pageSkip(query), pageSkip(query) + query.pageSize)
      : mapped;
    return { items, pageInfo: pageInfo(query, total) };
  }

  async getRoom(context: M02FacilityContext, id: string): Promise<Room> {
    const record = await this.database.client.room.findFirst({
      where: scoped(context, id),
      include: roomOccupancyInclude,
    });
    if (record === null) throw resourceNotFound();
    return mapRoom(record);
  }

  async createRoom(
    context: M02FacilityContext,
    input: RoomCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Room> {
    await this.assertScopedParent('floor', context, input.floorId);
    if (input.zoneId !== undefined) {
      const zone = await this.database.client.zone.findFirst({
        where: {
          ...scoped(context, input.zoneId),
          floorId: input.floorId,
          status: 'ACTIVE',
          floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
        },
        select: { id: true },
      });
      if (zone === null) throw resourceNotFound();
    }
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const parent = input.zoneId === undefined
        ? await tx.floor.findFirst({
            where: {
              ...scoped(context, input.floorId),
              status: 'ACTIVE',
              building: { status: 'ACTIVE' },
            },
            select: { id: true },
          })
        : await tx.zone.findFirst({
            where: {
              ...scoped(context, input.zoneId),
              floorId: input.floorId,
              status: 'ACTIVE',
              floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
            },
            select: { id: true },
          });
      if (parent === null) throw m02Conflict('PARENT_NOT_ACTIVE');
      const record = await tx.room.create({
        data: {
          ...input,
          zoneId: input.zoneId ?? null,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
        include: roomOccupancyInclude,
      });
      await this.recordDirectoryMutation(tx, context, session, 'ROOM', record.id, record.version, 'CREATED');
      return mapRoom(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateRoom(
    context: M02FacilityContext,
    id: string,
    input: RoomUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Room> {
    return this.updateVersioned(
      context,
      id,
      input.expectedVersion,
      'ROOM',
      session,
      async (tx) => {
        const current = await tx.room.findFirst({ where: scoped(context, id) });
        if (current === null) return null;
        const nextStatus = input.status ?? current.status;
        const nextZoneId = input.zoneId === undefined ? current.zoneId : input.zoneId;
        if (nextStatus === 'ACTIVE') {
          const activeParent = nextZoneId === null
            ? await tx.floor.findFirst({
                where: {
                  ...scoped(context),
                  id: current.floorId,
                  status: 'ACTIVE',
                  building: { status: 'ACTIVE' },
                },
                select: { id: true },
              })
            : await tx.zone.findFirst({
                where: {
                  ...scoped(context),
                  id: nextZoneId,
                  floorId: current.floorId,
                  status: 'ACTIVE',
                  floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
                },
                select: { id: true },
              });
          if (activeParent === null) throw m02Conflict('PARENT_NOT_ACTIVE');
        } else if (input.zoneId !== undefined && input.zoneId !== null) {
          const zone = await tx.zone.findFirst({
            where: {
              ...scoped(context),
              id: input.zoneId,
              floorId: current.floorId,
            },
            select: { id: true },
          });
          if (zone === null) throw resourceNotFound();
        }
        if (input.status !== undefined && input.status !== 'ACTIVE') {
          const [bed, stay] = await Promise.all([
            tx.bed.findFirst({ where: { ...scoped(context), roomId: id, operationalStatus: 'ACTIVE' }, select: { id: true } }),
            tx.elderStay.findFirst({
              where: { ...scoped(context), status: 'ACTIVE', bed: { roomId: id } },
              select: { id: true },
            }),
          ]);
          if (bed !== null || stay !== null) throw m02Conflict('ACTIVE_CHILD_PREVENTS_DEACTIVATION');
        }
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.room.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        return changed.count === 0
          ? null
          : tx.room.findUniqueOrThrow({ where: { id }, include: roomOccupancyInclude });
      },
      mapRoom,
    );
  }

  async listBeds(context: M02FacilityContext, query: BedsQuery): Promise<BedsPage> {
    const where = bedWhere(context, query);
    const [total, records] = await this.database.client.$transaction([
      this.database.client.bed.count({ where }),
      this.database.client.bed.findMany({
        where,
        include: bedOccupancyInclude,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapBed), pageInfo: pageInfo(query, total) };
  }

  async getBed(context: M02FacilityContext, id: string): Promise<Bed> {
    const record = await this.database.client.bed.findFirst({
      where: scoped(context, id),
      include: bedOccupancyInclude,
    });
    if (record === null) throw resourceNotFound();
    return mapBed(record);
  }

  async createBed(
    context: M02FacilityContext,
    input: BedCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Bed> {
    await this.assertScopedParent('room', context, input.roomId);
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const room = await tx.room.findFirst({
        where: {
          ...scoped(context, input.roomId),
          status: 'ACTIVE',
          floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
          OR: [{ zoneId: null }, { zone: { status: 'ACTIVE' } }],
        },
        select: { id: true },
      });
      if (room === null) throw m02Conflict('PARENT_NOT_ACTIVE');
      const record = await tx.bed.create({
        data: { ...input, organizationId: context.organizationId, facilityId: context.facilityId },
        include: bedOccupancyInclude,
      });
      await this.recordDirectoryMutation(tx, context, session, 'BED', record.id, record.version, 'CREATED');
      return mapBed(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateBed(
    context: M02FacilityContext,
    id: string,
    input: BedUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Bed> {
    return this.withUniqueConflict(async () => this.database.client.$transaction(
      async (tx) => {
        const current = await tx.bed.findFirst({ where: scoped(context, id) });
        if (current === null) throw resourceNotFound();
        const nextStatus = input.operationalStatus ?? current.operationalStatus;
        if (nextStatus === 'ACTIVE') {
          const room = await tx.room.findFirst({
            where: {
              ...scoped(context),
              id: current.roomId,
              status: 'ACTIVE',
              floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
              OR: [{ zoneId: null }, { zone: { status: 'ACTIVE' } }],
            },
            select: { id: true },
          });
          if (room === null) throw m02Conflict('PARENT_NOT_ACTIVE');
        }
        if (input.operationalStatus !== undefined && input.operationalStatus !== 'ACTIVE') {
          const occupied = await tx.elderStay.findFirst({
            where: { ...scoped(context), bedId: id, status: 'ACTIVE' },
            select: { id: true },
          });
          if (occupied !== null) throw m02Conflict('OCCUPIED_BED_CANNOT_BE_DISABLED');
        }
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.bed.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count === 0) {
          const exists = await tx.bed.findFirst({ where: scoped(context, id), select: { id: true } });
          if (exists === null) throw resourceNotFound();
          throw m02Conflict();
        }
        const record = await tx.bed.findUniqueOrThrow({ where: { id }, include: bedOccupancyInclude });
        await this.recordDirectoryMutation(tx, context, session, 'BED', record.id, record.version, 'UPDATED');
        return mapBed(record);
      },
      { isolationLevel: 'Serializable' },
    ));
  }

  async listCareLevels(context: M02FacilityContext, query: CareLevelsQuery): Promise<CareLevelsPage> {
    const where: Prisma.CareLevelWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : { OR: searchFields(query.search, ['code', 'name']) }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.careLevel.count({ where }),
      this.database.client.careLevel.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapCareLevel), pageInfo: pageInfo(query, total) };
  }

  async getCareLevel(context: M02FacilityContext, id: string): Promise<CareLevel> {
    const record = await this.database.client.careLevel.findFirst({ where: scoped(context, id) });
    if (record === null) throw resourceNotFound();
    return mapCareLevel(record);
  }

  async createCareLevel(
    context: M02FacilityContext,
    input: CareLevelCreateRequest,
    session: AuthenticatedSession,
  ): Promise<CareLevel> {
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (tx) => {
      const record = await tx.careLevel.create({
        data: {
          ...input,
          description: input.description ?? null,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
      });
      await this.recordDirectoryMutation(tx, context, session, 'CARE_LEVEL', record.id, record.version, 'CREATED');
      return mapCareLevel(record);
    }));
  }

  async updateCareLevel(
    context: M02FacilityContext,
    id: string,
    input: CareLevelUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<CareLevel> {
    return this.updateVersioned(
      context,
      id,
      input.expectedVersion,
      'CARE_LEVEL',
      session,
      async (tx) => {
        const { expectedVersion: _expectedVersion, ...data } = input;
        void _expectedVersion;
        const changed = await tx.careLevel.updateMany({
          where: { ...scoped(context, id), version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        return changed.count === 0 ? null : tx.careLevel.findUniqueOrThrow({ where: { id } });
      },
      mapCareLevel,
    );
  }

  private async updateVersioned<TRecord extends { id: string; version: number }, TOutput>(
    context: M02FacilityContext,
    id: string,
    expectedVersion: number,
    resourceType: string,
    session: AuthenticatedSession,
    update: (transaction: Prisma.TransactionClient) => Promise<TRecord | null>,
    map: (record: TRecord) => TOutput,
  ): Promise<TOutput> {
    return this.withUniqueConflict(async () => this.database.client.$transaction(async (transaction) => {
      const record = await update(transaction);
      if (record === null) {
        const exists = await modelExists(transaction, resourceType, context, id);
        if (!exists) throw resourceNotFound();
        throw m02Conflict();
      }
      await this.recordDirectoryMutation(
        transaction,
        context,
        session,
        resourceType,
        record.id,
        record.version,
        'UPDATED',
      );
      return map(record);
    }, { isolationLevel: 'Serializable' }));
  }

  private async recordDirectoryMutation(
    transaction: Prisma.TransactionClient,
    context: M02FacilityContext,
    session: AuthenticatedSession,
    resourceType: string,
    resourceId: string,
    version: number,
    verb: 'CREATED' | 'UPDATED',
  ): Promise<void> {
    await this.mutations.record(transaction, context, session, {
      action: `DIRECTORY.${resourceType}_${verb}`,
      eventType: `FACILITY.${resourceType}.${verb}.V1`,
      aggregateType: resourceType,
      aggregateId: resourceId,
      aggregateVersion: version,
      resourceType,
    });
  }

  private async assertScopedParent(
    model: 'building' | 'floor' | 'room',
    context: M02FacilityContext,
    id: string,
  ): Promise<void> {
    const where = scoped(context, id);
    const record = model === 'building'
      ? await this.database.client.building.findFirst({ where: { ...where, status: 'ACTIVE' }, select: { id: true } })
      : model === 'floor'
        ? await this.database.client.floor.findFirst({
            where: { ...where, status: 'ACTIVE', building: { status: 'ACTIVE' } },
            select: { id: true },
          })
        : await this.database.client.room.findFirst({
            where: {
              ...where,
              status: 'ACTIVE',
              floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
              OR: [{ zoneId: null }, { zone: { status: 'ACTIVE' } }],
            },
            select: { id: true },
          });
    if (record === null) throw resourceNotFound();
  }

  private async withUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) throw m02Conflict('DUPLICATE_RECORD');
      if (isPrismaCode(error, 'P2034')) throw m02Conflict('CONCURRENT_UPDATE');
      throw error;
    }
  }
}

const roomOccupancyInclude = {
  beds: {
    select: {
      id: true,
      operationalStatus: true,
      stays: { where: { status: 'ACTIVE' as const }, select: { id: true }, take: 1 },
    },
  },
} satisfies Prisma.RoomInclude;

const bedOccupancyInclude = {
  stays: {
    where: { status: 'ACTIVE' as const },
    orderBy: { admittedAt: 'desc' as const },
    take: 1,
    include: { elder: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.BedInclude;

type RoomWithOccupancy = Prisma.RoomGetPayload<{ include: typeof roomOccupancyInclude }>;
type BedWithOccupancy = Prisma.BedGetPayload<{ include: typeof bedOccupancyInclude }>;

function mapBuilding(record: Prisma.BuildingGetPayload<Record<string, never>>): Building {
  return { ...record, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function mapFloor(record: Prisma.FloorGetPayload<Record<string, never>>): Floor {
  return { ...record, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function mapZone(record: Prisma.ZoneGetPayload<Record<string, never>>): Zone {
  return { ...record, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function mapRoom(record: RoomWithOccupancy): Room {
  const capacity = deriveRoomCapacity(record.beds);
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    floorId: record.floorId,
    zoneId: record.zoneId,
    code: record.code,
    name: record.name,
    status: record.status,
    ...capacity,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function deriveRoomCapacity(
  beds: readonly { operationalStatus: string; stays: readonly unknown[] }[],
): Pick<Room, 'bedCount' | 'activeBedCount' | 'occupiedBedCount' | 'availableBedCount'> {
  const activeBeds = beds.filter((bed) => bed.operationalStatus === 'ACTIVE');
  const occupiedBedCount = activeBeds.filter((bed) => bed.stays.length > 0).length;
  return {
    bedCount: beds.length,
    activeBedCount: activeBeds.length,
    occupiedBedCount,
    availableBedCount: activeBeds.length - occupiedBedCount,
  };
}

function mapBed(record: BedWithOccupancy): Bed {
  const stay = record.stays[0];
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    roomId: record.roomId,
    code: record.code,
    label: record.label,
    operationalStatus: record.operationalStatus,
    occupancy: stay === undefined
      ? null
      : {
          elderId: stay.elder.id,
          elderDisplayName: stay.elder.displayName,
          stayId: stay.id,
          admittedAt: stay.admittedAt.toISOString(),
        },
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapCareLevel(record: Prisma.CareLevelGetPayload<Record<string, never>>): CareLevel {
  return { ...record, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function scoped(context: M02FacilityContext, id?: string): {
  organizationId: string;
  facilityId: string;
  id?: string;
} {
  return {
    organizationId: context.organizationId,
    facilityId: context.facilityId,
    ...(id === undefined ? {} : { id }),
  };
}

function pageSkip(query: { page: number; pageSize: number }): number {
  return (query.page - 1) * query.pageSize;
}

function pageInfo(query: { page: number; pageSize: number }, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

function searchFields(search: string, fields: readonly string[]): Record<string, unknown>[] {
  return fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' } }));
}

function roomWhere(context: M02FacilityContext, query: RoomsQuery): Prisma.RoomWhereInput {
  const occupancy = query.occupancy === 'AVAILABLE'
    ? { beds: { some: { operationalStatus: 'ACTIVE' as const, stays: { none: { status: 'ACTIVE' as const } } } } }
    : query.occupancy === 'OCCUPIED'
      ? {
          beds: {
            some: {
              operationalStatus: 'ACTIVE' as const,
              stays: { some: { status: 'ACTIVE' as const } },
            },
          },
        }
      : query.occupancy === 'FULL'
        ? {
            AND: [
              { beds: { some: { operationalStatus: 'ACTIVE' as const } } },
              { beds: { none: { operationalStatus: 'ACTIVE' as const, stays: { none: { status: 'ACTIVE' as const } } } } },
            ],
          }
        : {};
  return {
    ...scoped(context),
    ...(query.buildingId === undefined ? {} : { floor: { buildingId: query.buildingId } }),
    ...(query.floorId === undefined ? {} : { floorId: query.floorId }),
    ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.search === undefined
      ? {}
      : { OR: searchFields(query.search, ['code', 'name']) }),
    ...occupancy,
  };
}

function roomOrderBy(query: RoomsQuery): Prisma.RoomOrderByWithRelationInput {
  if (query.sort === 'bedCount') return { beds: { _count: query.direction } };
  if (query.sort === 'occupiedBedCount') return { code: 'asc' };
  return { [query.sort]: query.direction };
}

function bedWhere(context: M02FacilityContext, query: BedsQuery): Prisma.BedWhereInput {
  const hasRoomLocationFilter = query.buildingId !== undefined ||
    query.floorId !== undefined ||
    query.zoneId !== undefined;
  return {
    ...scoped(context),
    ...(hasRoomLocationFilter
      ? {
          room: {
            ...(query.buildingId === undefined ? {} : { floor: { buildingId: query.buildingId } }),
            ...(query.floorId === undefined ? {} : { floorId: query.floorId }),
            ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
          },
        }
      : {}),
    ...(query.roomId === undefined ? {} : { roomId: query.roomId }),
    ...(query.operationalStatus === undefined ? {} : { operationalStatus: query.operationalStatus }),
    ...(query.search === undefined
      ? {}
      : { OR: searchFields(query.search, ['code', 'label']) }),
    ...(query.occupancy === 'OCCUPIED'
      ? { stays: { some: { status: 'ACTIVE' } } }
      : query.occupancy === 'AVAILABLE'
        ? { operationalStatus: 'ACTIVE', stays: { none: { status: 'ACTIVE' } } }
        : {}),
  };
}

async function modelExists(
  transaction: Prisma.TransactionClient,
  resourceType: string,
  context: M02FacilityContext,
  id: string,
): Promise<boolean> {
  const where = scoped(context, id);
  const record = resourceType === 'BUILDING'
    ? await transaction.building.findFirst({ where, select: { id: true } })
    : resourceType === 'FLOOR'
      ? await transaction.floor.findFirst({ where, select: { id: true } })
      : resourceType === 'ZONE'
        ? await transaction.zone.findFirst({ where, select: { id: true } })
        : resourceType === 'ROOM'
          ? await transaction.room.findFirst({ where, select: { id: true } })
          : resourceType === 'BED'
            ? await transaction.bed.findFirst({ where, select: { id: true } })
            : await transaction.careLevel.findFirst({ where, select: { id: true } });
  return record !== null;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
