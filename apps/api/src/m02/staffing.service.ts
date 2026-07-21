import { Inject, Injectable } from '@nestjs/common';
import type {
  Shift,
  ShiftAssignment,
  ShiftAssignmentCreateRequest,
  ShiftAssignmentUpdateRequest,
  ShiftCreateRequest,
  ShiftsPage,
  ShiftsQuery,
  ShiftUpdateRequest,
  StaffCreateRequest,
  StaffPage,
  StaffProfile,
  StaffQuery,
  StaffUpdateRequest,
  Team,
  TeamCreateRequest,
  TeamMembership,
  TeamsPage,
  TeamsQuery,
  TeamUpdateRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { M02FacilityContext } from './m02-context.js';
import { m02Conflict, m02InvalidRequest, m02InvalidState } from './m02-errors.js';
import { M02MutationService } from './m02-mutation.service.js';

type TeamMembershipCreateInput = Parameters<Prisma.TeamMembershipDelegate['create']>[0]['data'];

const STAFF_CAPABLE_ROLE_CODES = [
  'ORG_ADMIN',
  'FACILITY_DIRECTOR',
  'NURSING_SUPERVISOR',
  'CAREGIVER',
  'CLINICAL_STAFF',
] as const;

@Injectable()
export class StaffingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(M02MutationService) private readonly mutations: M02MutationService,
  ) {}

  async listStaff(context: M02FacilityContext, query: StaffQuery): Promise<StaffPage> {
    const now = new Date();
    const where: Prisma.StaffProfileWhereInput = {
      ...scope(context),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.jobTitle === undefined ? {} : { jobTitle: query.jobTitle }),
      ...(query.teamId === undefined
        ? {}
        : {
            teamMemberships: {
              some: {
                teamId: query.teamId,
                activeFrom: { lte: now },
                OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
              },
            },
          }),
      ...(query.search === undefined
        ? {}
        : {
            OR: ['displayName', 'employeeCode', 'jobTitle'].map((field) => ({
              [field]: { contains: query.search, mode: 'insensitive' },
            })),
          }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.staffProfile.count({ where }),
      this.database.client.staffProfile.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: skip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapStaff), pageInfo: paging(query, total) };
  }

  async getStaff(context: M02FacilityContext, id: string): Promise<StaffProfile> {
    const record = await this.database.client.staffProfile.findFirst({ where: scope(context, id) });
    if (record === null) throw resourceNotFound();
    return mapStaff(record);
  }

  async createStaff(
    context: M02FacilityContext,
    input: StaffCreateRequest,
    session: AuthenticatedSession,
  ): Promise<StaffProfile> {
    const now = new Date();
    if (input.status === 'ACTIVE' && input.hiredAt !== undefined && input.hiredAt > todayDateOnly(now)) {
      throw m02InvalidRequest('hiredAt', 'ACTIVE_STAFF_CANNOT_START_IN_FUTURE');
    }
    const user = await this.database.client.user.findFirst({
      where: {
        id: input.userId,
        status: 'ACTIVE',
        userRoles: {
          some: {
            organizationId: context.organizationId,
            activeFrom: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            revokedAt: null,
            role: { code: { in: [...STAFF_CAPABLE_ROLE_CODES] } },
            dataScopes: {
              some: {
                facilityId: context.facilityId,
                validFrom: { lte: now },
                OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              },
            },
          },
        },
      },
      select: { id: true, displayName: true },
    });
    if (user === null) throw resourceNotFound();
    if (input.primaryTeamId !== undefined) await this.assertActiveTeam(context, input.primaryTeamId);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const record = await tx.staffProfile.create({
        data: {
          ...input,
          hiredAt: date(input.hiredAt),
          primaryTeamId: input.primaryTeamId ?? null,
          displayName: user.displayName,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
      });
      await this.record(tx, context, session, 'STAFF_PROFILE', record.id, record.version, 'CREATED');
      return mapStaff(record);
    }));
  }

  async updateStaff(
    context: M02FacilityContext,
    id: string,
    input: StaffUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<StaffProfile> {
    if (input.primaryTeamId !== undefined && input.primaryTeamId !== null) {
      await this.assertActiveTeam(context, input.primaryTeamId);
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.staffProfile.findFirst({ where: scope(context, id) });
      if (current === null) throw resourceNotFound();
      if (current.status === 'ARCHIVED') throw m02InvalidState('TERMINAL_STAFF_IMMUTABLE');
      const nextStatus = input.status ?? current.status;
      if (!isStaffStatusTransitionAllowed(current.status, nextStatus)) {
        throw m02InvalidState('INVALID_STAFF_STATUS_TRANSITION');
      }
      const nextHiredAt = input.hiredAt === undefined
        ? current.hiredAt
        : input.hiredAt === null
          ? null
          : new Date(`${input.hiredAt}T00:00:00.000Z`);
      const nextEndedAt = input.endedAt === undefined
        ? current.endedAt
        : input.endedAt === null
          ? null
          : new Date(`${input.endedAt}T00:00:00.000Z`);
      if (nextHiredAt !== null && nextEndedAt !== null && nextEndedAt < nextHiredAt) {
        throw m02InvalidRequest('endedAt', 'MUST_NOT_BE_BEFORE_HIRED_AT');
      }
      if (nextStatus === 'ACTIVE' && nextEndedAt !== null) {
        throw m02InvalidState('ACTIVE_STAFF_CANNOT_HAVE_END_DATE');
      }
      if (nextStatus === 'ACTIVE' && nextHiredAt !== null && nextHiredAt > todayUtc()) {
        throw m02InvalidState('ACTIVE_STAFF_CANNOT_START_IN_FUTURE');
      }
      if (current.status === 'ACTIVE' && nextStatus !== 'ACTIVE') {
        const now = new Date();
        const [membership, assignment] = await Promise.all([
          tx.teamMembership.findFirst({
            where: {
              ...scope(context),
              staffProfileId: id,
              activeFrom: { lte: now },
              OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
            },
            select: { id: true },
          }),
          tx.shiftAssignment.findFirst({
            where: {
              ...scope(context),
              staffProfileId: id,
              status: { in: ['ASSIGNED', 'ACCEPTED'] },
              shift: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
            },
            select: { id: true },
          }),
        ]);
        if (membership !== null || assignment !== null) {
          throw m02InvalidState('ACTIVE_STAFF_DEPENDENCIES');
        }
      }
      const {
        expectedVersion: _expectedVersion,
        hiredAt,
        endedAt,
        reasonCode,
        ...rest
      } = input;
      void _expectedVersion;
      const changed = await tx.staffProfile.updateMany({
        where: { ...scope(context, id), version: input.expectedVersion },
        data: {
          ...rest,
          ...(hiredAt === undefined ? {} : { hiredAt: date(hiredAt) }),
          ...(endedAt === undefined ? {} : { endedAt: date(endedAt) }),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) {
        await assertExistsOrConflict(tx.staffProfile, context, id);
      }
      const record = await tx.staffProfile.findUniqueOrThrow({ where: { id } });
      await this.record(
        tx,
        context,
        session,
        'STAFF_PROFILE',
        record.id,
        record.version,
        'UPDATED',
        reasonCode,
      );
      return mapStaff(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async listTeams(context: M02FacilityContext, query: TeamsQuery): Promise<TeamsPage> {
    const now = new Date();
    const where: Prisma.TeamWhereInput = {
      ...scope(context),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : {
            OR: ['code', 'name'].map((field) => ({
              [field]: { contains: query.search, mode: 'insensitive' },
            })),
          }),
    };
    const include = activeMembershipInclude(now);
    const [total, records] = await this.database.client.$transaction([
      this.database.client.team.count({ where }),
      this.database.client.team.findMany({
        where,
        include,
        orderBy: query.sort === 'activeMemberCount'
          ? { name: query.direction }
          : ({ [query.sort]: query.direction }),
        ...(query.sort === 'activeMemberCount'
          ? {}
          : { skip: skip(query), take: query.pageSize }),
      }),
    ]);
    let items = records.map(mapTeam);
    if (query.sort === 'activeMemberCount') {
      items.sort((left, right) =>
        (left.activeMemberCount - right.activeMemberCount) * (query.direction === 'asc' ? 1 : -1),
      );
      items = items.slice(skip(query), skip(query) + query.pageSize);
    }
    return { items, pageInfo: paging(query, total) };
  }

  async getTeam(context: M02FacilityContext, id: string): Promise<Team> {
    const record = await this.database.client.team.findFirst({
      where: scope(context, id),
      include: activeMembershipInclude(new Date()),
    });
    if (record === null) throw resourceNotFound();
    return mapTeam(record);
  }

  async createTeam(
    context: M02FacilityContext,
    input: TeamCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Team> {
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const record = await tx.team.create({
        data: {
          ...input,
          description: input.description ?? null,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
        include: activeMembershipInclude(new Date()),
      });
      await this.record(tx, context, session, 'TEAM', record.id, record.version, 'CREATED');
      return mapTeam(record);
    }));
  }

  async updateTeam(
    context: M02FacilityContext,
    id: string,
    input: TeamUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Team> {
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.team.findFirst({ where: scope(context, id) });
      if (current === null) throw resourceNotFound();
      if (current.status === 'ARCHIVED') throw m02InvalidState('TERMINAL_TEAM_IMMUTABLE');
      const nextStatus = input.status ?? current.status;
      if (!isTeamStatusTransitionAllowed(current.status, nextStatus)) {
        throw m02InvalidState('INVALID_TEAM_STATUS_TRANSITION');
      }
      if (current.status === 'ACTIVE' && nextStatus !== 'ACTIVE') {
        const now = new Date();
        const [membership, shift] = await Promise.all([
          tx.teamMembership.findFirst({
            where: {
              ...scope(context),
              teamId: id,
              activeFrom: { lte: now },
              OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
            },
            select: { id: true },
          }),
          tx.shift.findFirst({
            where: { ...scope(context), teamId: id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
            select: { id: true },
          }),
        ]);
        if (membership !== null || shift !== null) {
          throw m02InvalidState('ACTIVE_TEAM_DEPENDENCIES');
        }
      }
      const { expectedVersion: _expectedVersion, reasonCode, ...data } = input;
      void _expectedVersion;
      const changed = await tx.team.updateMany({
        where: { ...scope(context, id), version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (changed.count === 0) await assertExistsOrConflict(tx.team, context, id);
      const record = await tx.team.findUniqueOrThrow({
        where: { id },
        include: activeMembershipInclude(new Date()),
      });
      await this.record(
        tx,
        context,
        session,
        'TEAM',
        record.id,
        record.version,
        'UPDATED',
        reasonCode,
      );
      return mapTeam(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async listTeamMemberships(
    context: M02FacilityContext,
    teamId: string,
    rawQuery: Record<string, unknown>,
  ): Promise<unknown> {
    await this.assertTeam(context, teamId);
    const query = basicPage(rawQuery);
    const where = { ...scope(context), teamId };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.teamMembership.count({ where }),
      this.database.client.teamMembership.findMany({
        where,
        orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
        skip: skip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapMembership), pageInfo: paging(query, total) };
  }

  async createTeamMembership(
    context: M02FacilityContext,
    teamId: string,
    input: {
      staffProfileId: string;
      role: 'LEAD' | 'MEMBER';
      activeFrom: string;
      activeUntil?: string;
    },
    session: AuthenticatedSession,
  ): Promise<TeamMembership> {
    const activeFrom = new Date(input.activeFrom);
    const activeUntil = input.activeUntil === undefined ? null : new Date(input.activeUntil);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const today = todayUtc();
      const [team, staff, overlap] = await Promise.all([
        tx.team.findFirst({
          where: { ...scope(context, teamId), status: 'ACTIVE' },
          select: { id: true },
        }),
        tx.staffProfile.findFirst({
          where: {
            ...scope(context, input.staffProfileId),
            status: 'ACTIVE',
            endedAt: null,
            OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
          },
          select: { id: true },
        }),
        tx.teamMembership.findFirst({
          where: {
            ...scope(context),
            teamId,
            staffProfileId: input.staffProfileId,
            activeFrom: { lt: activeUntil ?? new Date('9999-12-31T00:00:00.000Z') },
            OR: [{ activeUntil: null }, { activeUntil: { gt: activeFrom } }],
          },
          select: { id: true },
        }),
      ]);
      if (team === null || staff === null) throw m02InvalidState('TEAM_MEMBERSHIP_NOT_ALLOWED');
      if (overlap !== null) throw m02Conflict('TEAM_MEMBERSHIP_OVERLAP');
      const data: TeamMembershipCreateInput = {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        teamId,
        staffProfileId: input.staffProfileId,
        role: input.role,
        activeFrom,
        activeUntil,
      };
      const record = await tx.teamMembership.create({ data });
      await this.record(tx, context, session, 'TEAM_MEMBERSHIP', record.id, record.version, 'CREATED');
      return mapMembership(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateTeamMembership(
    context: M02FacilityContext,
    teamId: string,
    id: string,
    input: {
      expectedVersion: number;
      role?: 'MEMBER' | 'LEAD';
      activeUntil?: string | null;
      reasonCode?: string;
    },
    session: AuthenticatedSession,
  ): Promise<TeamMembership> {
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.teamMembership.findFirst({
        where: { ...scope(context, id), teamId },
      });
      if (current === null) throw resourceNotFound();
      const nextActiveUntil = input.activeUntil === undefined
        ? current.activeUntil
        : dateTime(input.activeUntil);
      if (nextActiveUntil !== null && nextActiveUntil <= current.activeFrom) {
        throw m02InvalidRequest('activeUntil', 'MUST_BE_AFTER_ACTIVE_FROM');
      }
      if (nextActiveUntil === null || nextActiveUntil > new Date()) {
        const [team, staff] = await Promise.all([
          tx.team.findFirst({ where: { ...scope(context, teamId), status: 'ACTIVE' }, select: { id: true } }),
          tx.staffProfile.findFirst({
            where: {
              ...scope(context, current.staffProfileId),
              status: 'ACTIVE',
              endedAt: null,
              OR: [{ hiredAt: null }, { hiredAt: { lte: todayUtc() } }],
            },
            select: { id: true },
          }),
        ]);
        if (team === null || staff === null) throw m02InvalidState('MEMBERSHIP_ACTIVATION_NOT_ALLOWED');
      }
      if (input.activeUntil !== undefined) {
        const overlap = await tx.teamMembership.findFirst({
          where: {
            ...scope(context),
            id: { not: id },
            teamId,
            staffProfileId: current.staffProfileId,
            activeFrom: { lt: nextActiveUntil ?? new Date('9999-12-31T00:00:00.000Z') },
            OR: [{ activeUntil: null }, { activeUntil: { gt: current.activeFrom } }],
          },
          select: { id: true },
        });
        if (overlap !== null) throw m02Conflict('TEAM_MEMBERSHIP_OVERLAP');
      }
      const { reasonCode } = input;
      const changed = await tx.teamMembership.updateMany({
        where: { ...scope(context, id), teamId, version: input.expectedVersion },
        data: {
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.activeUntil === undefined ? {} : { activeUntil: dateTime(input.activeUntil) }),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) await assertExistsOrConflict(tx.teamMembership, context, id, { teamId });
      const record = await tx.teamMembership.findUniqueOrThrow({ where: { id } });
      await this.record(
        tx,
        context,
        session,
        'TEAM_MEMBERSHIP',
        record.id,
        record.version,
        'UPDATED',
        reasonCode,
      );
      return mapMembership(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async listShifts(context: M02FacilityContext, query: ShiftsQuery): Promise<ShiftsPage> {
    const where: Prisma.ShiftWhereInput = {
      ...scope(context),
      startsAt: { lt: new Date(query.to) },
      endsAt: { gt: new Date(query.from) },
      ...(query.teamId === undefined ? {} : { teamId: query.teamId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.staffProfileId === undefined
        ? {}
        : { assignments: { some: { staffProfileId: query.staffProfileId } } }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.shift.count({ where }),
      this.database.client.shift.findMany({
        where,
        include: shiftInclude,
        orderBy: { [query.sort]: query.direction },
        skip: skip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapShift), pageInfo: paging(query, total) };
  }

  async getShift(context: M02FacilityContext, id: string): Promise<Shift> {
    const record = await this.database.client.shift.findFirst({ where: scope(context, id), include: shiftInclude });
    if (record === null) throw resourceNotFound();
    return mapShift(record);
  }

  async createShift(
    context: M02FacilityContext,
    input: ShiftCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Shift> {
    if (input.teamId !== undefined) await this.assertActiveTeam(context, input.teamId);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      if (input.teamId !== undefined) {
        const team = await tx.team.findFirst({
          where: { ...scope(context, input.teamId), status: 'ACTIVE' },
          select: { id: true },
        });
        if (team === null) throw m02InvalidState('SHIFT_TEAM_NOT_ACTIVE');
      }
      const record = await tx.shift.create({
        data: {
          ...input,
          teamId: input.teamId ?? null,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
        include: shiftInclude,
      });
      await this.record(tx, context, session, 'SHIFT', record.id, record.version, 'CREATED');
      return mapShift(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateShift(
    context: M02FacilityContext,
    id: string,
    input: ShiftUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<Shift> {
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.shift.findFirst({ where: scope(context, id) });
      if (current === null) throw resourceNotFound();
      const nextStatus = input.status ?? current.status;
      if (!isShiftStatusTransitionAllowed(current.status, nextStatus)) {
        throw m02InvalidState('INVALID_SHIFT_STATUS_TRANSITION');
      }
      if (isTerminalShiftStatus(current.status) && hasShiftMutation(input, current.status)) {
        throw m02InvalidState('TERMINAL_SHIFT_IMMUTABLE');
      }
      if (input.teamId !== undefined && input.teamId !== null) {
        const team = await tx.team.findFirst({
          where: { ...scope(context, input.teamId), status: 'ACTIVE' },
          select: { id: true },
        });
        if (team === null) throw resourceNotFound();
      }
      const startsAt = input.startsAt === undefined ? current.startsAt : new Date(input.startsAt);
      const endsAt = input.endsAt === undefined ? current.endsAt : new Date(input.endsAt);
      if (endsAt <= startsAt) throw m02InvalidRequest('endsAt', 'MUST_BE_AFTER_START');
      const {
        expectedVersion: _expectedVersion,
        startsAt: _startsAt,
        endsAt: _endsAt,
        reasonCode,
        ...rest
      } = input;
      void _expectedVersion;
      void _startsAt;
      void _endsAt;
      const changed = await tx.shift.updateMany({
        where: { ...scope(context, id), version: input.expectedVersion },
        data: { ...rest, startsAt, endsAt, version: { increment: 1 } },
      });
      if (changed.count === 0) await assertExistsOrConflict(tx.shift, context, id);
      const record = await tx.shift.findUniqueOrThrow({ where: { id }, include: shiftInclude });
      await this.record(
        tx,
        context,
        session,
        'SHIFT',
        record.id,
        record.version,
        'UPDATED',
        reasonCode,
      );
      return mapShift(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async createShiftAssignment(
    context: M02FacilityContext,
    shiftId: string,
    input: ShiftAssignmentCreateRequest,
    session: AuthenticatedSession,
  ): Promise<ShiftAssignment> {
    if (input.status !== 'ASSIGNED') {
      throw m02InvalidState('SHIFT_ASSIGNMENT_MUST_START_ASSIGNED');
    }
    const elderAssignments = input.elderAssignments ?? [];
    await Promise.all([
      this.assertShift(context, shiftId),
      this.assertStaff(context, input.staffProfileId),
      this.assertAssignmentReferences(context, input.scopes, elderAssignments),
    ]);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const [shift, staff] = await Promise.all([
        tx.shift.findFirst({
          where: { ...scope(context, shiftId), status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
          select: { id: true },
        }),
        tx.staffProfile.findFirst({
          where: {
            ...scope(context, input.staffProfileId),
            status: 'ACTIVE',
            endedAt: null,
            OR: [{ hiredAt: null }, { hiredAt: { lte: todayUtc() } }],
          },
          select: { id: true },
        }),
      ]);
      if (shift === null || staff === null) throw m02InvalidState('SHIFT_ASSIGNMENT_NOT_ALLOWED');
      const record = await tx.shiftAssignment.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          shiftId,
          staffProfileId: input.staffProfileId,
          status: input.status,
          scopes: {
            create: input.scopes.map((item) => ({
              ...item,
              organizationId: context.organizationId,
              facilityId: context.facilityId,
            })),
          },
          elderAssignments: {
            create: elderAssignments.map((item) => ({
              ...item,
              organizationId: context.organizationId,
              facilityId: context.facilityId,
            })),
          },
        },
        include: assignmentInclude,
      });
      await this.record(tx, context, session, 'SHIFT_ASSIGNMENT', record.id, record.version, 'CREATED');
      return mapAssignment(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateShiftAssignment(
    context: M02FacilityContext,
    shiftId: string,
    id: string,
    input: ShiftAssignmentUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<ShiftAssignment> {
    await this.assertAssignmentReferences(context, input.scopes ?? [], input.elderAssignments ?? []);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.shiftAssignment.findFirst({
        where: { ...scope(context, id), shiftId },
        include: {
          shift: { select: { status: true } },
          staffProfile: { select: { status: true, hiredAt: true, endedAt: true } },
        },
      });
      if (current === null) throw resourceNotFound();
      if (isTerminalShiftStatus(current.shift.status)) {
        throw m02InvalidState('TERMINAL_SHIFT_ASSIGNMENTS_IMMUTABLE');
      }
      const nextStatus = input.status ?? current.status;
      if (!isShiftAssignmentStatusTransitionAllowed(current.status, nextStatus)) {
        throw m02InvalidState('INVALID_SHIFT_ASSIGNMENT_STATUS_TRANSITION');
      }
      if (current.status === 'CANCELLED' && hasAssignmentMutation(input, current.status)) {
        throw m02InvalidState('TERMINAL_SHIFT_ASSIGNMENT_IMMUTABLE');
      }
      if (nextStatus === 'ACCEPTED') {
        if (
          !['SCHEDULED', 'IN_PROGRESS'].includes(current.shift.status) ||
          current.staffProfile.status !== 'ACTIVE' ||
          current.staffProfile.endedAt !== null ||
          (current.staffProfile.hiredAt !== null && current.staffProfile.hiredAt > todayUtc())
        ) {
          throw m02InvalidState('SHIFT_ASSIGNMENT_ACCEPTANCE_NOT_ALLOWED');
        }
      }
      const { reasonCode } = input;
      const changed = await tx.shiftAssignment.updateMany({
        where: { ...scope(context, id), shiftId, version: input.expectedVersion },
        data: {
          ...(input.status === undefined ? {} : { status: input.status }),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) await assertExistsOrConflict(tx.shiftAssignment, context, id, { shiftId });
      if (input.scopes !== undefined) {
        await tx.shiftAssignmentScope.deleteMany({ where: { shiftAssignmentId: id } });
        await tx.shiftAssignmentScope.createMany({
          data: input.scopes.map((item) => ({
            ...item,
            shiftAssignmentId: id,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
          })),
        });
      }
      if (input.elderAssignments !== undefined) {
        await tx.elderCareAssignment.deleteMany({ where: { shiftAssignmentId: id } });
        await tx.elderCareAssignment.createMany({
          data: input.elderAssignments.map((item) => ({
            ...item,
            shiftAssignmentId: id,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
          })),
        });
      }
      const record = await tx.shiftAssignment.findUniqueOrThrow({ where: { id }, include: assignmentInclude });
      await this.record(
        tx,
        context,
        session,
        'SHIFT_ASSIGNMENT',
        record.id,
        record.version,
        'UPDATED',
        reasonCode,
      );
      return mapAssignment(record);
    }, { isolationLevel: 'Serializable' }));
  }

  private async assertAssignmentReferences(
    context: M02FacilityContext,
    scopes: readonly { kind: string; floorId?: string; zoneId?: string }[],
    elders: readonly { elderId: string }[],
  ): Promise<void> {
    const floorIds = [...new Set(scopes.flatMap((item) => item.floorId === undefined ? [] : [item.floorId]))];
    const zonePairs = scopes.flatMap((item) =>
      item.kind === 'ZONE' && item.floorId !== undefined && item.zoneId !== undefined
        ? [{ floorId: item.floorId, zoneId: item.zoneId }]
        : [],
    );
    const elderIds = [...new Set(elders.map((item) => item.elderId))];
    const [floorCount, zoneCount, elderCount] = await Promise.all([
      this.database.client.floor.count({
        where: {
          ...scope(context),
          id: { in: floorIds },
          status: 'ACTIVE',
          building: { status: 'ACTIVE' },
        },
      }),
      zonePairs.length === 0
        ? Promise.resolve(0)
        : this.database.client.zone.count({
            where: {
              ...scope(context),
              status: 'ACTIVE',
              floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
              OR: zonePairs.map((pair) => ({ id: pair.zoneId, floorId: pair.floorId })),
            },
          }),
      this.database.client.elder.count({
        where: { ...scope(context), id: { in: elderIds }, status: 'ACTIVE' },
      }),
    ]);
    if (floorCount !== floorIds.length || zoneCount !== zonePairs.length || elderCount !== elderIds.length) {
      throw resourceNotFound();
    }
  }

  private async assertTeam(context: M02FacilityContext, id: string): Promise<void> {
    const record = await this.database.client.team.findFirst({ where: scope(context, id), select: { id: true } });
    if (record === null) throw resourceNotFound();
  }

  private async assertActiveTeam(context: M02FacilityContext, id: string): Promise<void> {
    const record = await this.database.client.team.findFirst({
      where: { ...scope(context, id), status: 'ACTIVE' },
      select: { id: true },
    });
    if (record === null) throw resourceNotFound();
  }

  private async assertStaff(context: M02FacilityContext, id: string): Promise<void> {
    const record = await this.database.client.staffProfile.findFirst({ where: scope(context, id), select: { id: true } });
    if (record === null) throw resourceNotFound();
  }

  private async assertShift(context: M02FacilityContext, id: string): Promise<void> {
    const record = await this.database.client.shift.findFirst({ where: scope(context, id), select: { id: true } });
    if (record === null) throw resourceNotFound();
  }

  private async record(
    tx: Prisma.TransactionClient,
    context: M02FacilityContext,
    session: AuthenticatedSession,
    resourceType: string,
    id: string,
    version: number,
    verb: 'CREATED' | 'UPDATED',
    reasonCode?: string,
  ): Promise<void> {
    await this.mutations.record(tx, context, session, {
      action: `STAFFING.${resourceType}_${verb}`,
      eventType: `STAFFING.${resourceType}.${verb}.V1`,
      aggregateType: resourceType,
      aggregateId: id,
      aggregateVersion: version,
      resourceType,
      reasonCode,
    });
  }

  private async unique<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) throw m02Conflict('DUPLICATE_RECORD');
      if (isPrismaCode(error, 'P2034')) throw m02Conflict('CONCURRENT_UPDATE');
      throw error;
    }
  }
}

const shiftInclude = {
  assignments: {
    orderBy: { assignedAt: 'asc' as const },
    include: {
      staffProfile: { select: { displayName: true } },
      scopes: true,
      elderAssignments: true,
    },
  },
} satisfies Prisma.ShiftInclude;

const assignmentInclude = {
  staffProfile: { select: { displayName: true } },
  scopes: true,
  elderAssignments: true,
} satisfies Prisma.ShiftAssignmentInclude;

type TeamWithMembers = Prisma.TeamGetPayload<{ include: ReturnType<typeof activeMembershipInclude> }>;
type ShiftWithAssignments = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;
type AssignmentWithRelations = Prisma.ShiftAssignmentGetPayload<{ include: typeof assignmentInclude }>;

function activeMembershipInclude(now: Date) {
  return {
    memberships: {
      where: { activeFrom: { lte: now }, OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
      select: { id: true },
    },
  } satisfies Prisma.TeamInclude;
}

function mapStaff(record: Prisma.StaffProfileGetPayload<Record<string, never>>): StaffProfile {
  return {
    ...record,
    hiredAt: dateOnly(record.hiredAt),
    endedAt: dateOnly(record.endedAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapTeam(record: TeamWithMembers): Team {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    code: record.code,
    name: record.name,
    description: record.description,
    status: record.status,
    activeMemberCount: record.memberships.length,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapMembership(record: Prisma.TeamMembershipGetPayload<Record<string, never>>): TeamMembership {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    teamId: record.teamId,
    staffProfileId: record.staffProfileId,
    role: record.role,
    activeFrom: record.activeFrom.toISOString(),
    activeUntil: record.activeUntil?.toISOString() ?? null,
    version: record.version,
  };
}

function mapShift(record: ShiftWithAssignments): Shift {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    teamId: record.teamId,
    code: record.code,
    name: record.name,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    status: record.status,
    assignments: record.assignments.map(mapAssignment),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapAssignment(record: AssignmentWithRelations): ShiftAssignment {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    shiftId: record.shiftId,
    staffProfileId: record.staffProfileId,
    staffDisplayName: record.staffProfile.displayName,
    status: record.status,
    scopes: record.scopes.map((item) => ({
      id: item.id,
      shiftAssignmentId: item.shiftAssignmentId,
      kind: item.kind,
      ...(item.floorId === null ? {} : { floorId: item.floorId }),
      ...(item.zoneId === null ? {} : { zoneId: item.zoneId }),
    })),
    elderAssignments: record.elderAssignments.map((item) => ({
      id: item.id,
      shiftAssignmentId: item.shiftAssignmentId,
      elderId: item.elderId,
      role: item.role,
    })),
    version: record.version,
    assignedAt: record.assignedAt.toISOString(),
  };
}

function scope(context: M02FacilityContext, id?: string) {
  return {
    organizationId: context.organizationId,
    facilityId: context.facilityId,
    ...(id === undefined ? {} : { id }),
  };
}

function skip(query: { page: number; pageSize: number }): number {
  return (query.page - 1) * query.pageSize;
}

function basicPage(raw: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Number(raw['page'] ?? 1);
  const pageSize = Number(raw['pageSize'] ?? 20);
  if (!Number.isInteger(page) || page < 1) throw m02InvalidRequest('page', 'INVALID_PAGE');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw m02InvalidRequest('pageSize', 'INVALID_PAGE_SIZE');
  }
  return { page, pageSize };
}

function paging(query: { page: number; pageSize: number }, total: number) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

function date(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function dateTime(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function todayDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function todayUtc(now = new Date()): Date {
  return new Date(`${todayDateOnly(now)}T00:00:00.000Z`);
}

const STAFF_STATUS_TRANSITIONS = {
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
} as const satisfies Record<StaffProfile['status'], readonly StaffProfile['status'][]>;

const TEAM_STATUS_TRANSITIONS = {
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
} as const satisfies Record<Team['status'], readonly Team['status'][]>;

const SHIFT_STATUS_TRANSITIONS = {
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Record<Shift['status'], readonly Shift['status'][]>;

const SHIFT_ASSIGNMENT_STATUS_TRANSITIONS = {
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['CANCELLED'],
  CANCELLED: [],
} as const satisfies Record<ShiftAssignment['status'], readonly ShiftAssignment['status'][]>;

export function isStaffStatusTransitionAllowed(
  current: StaffProfile['status'],
  next: StaffProfile['status'],
): boolean {
  return current === next || STAFF_STATUS_TRANSITIONS[current].includes(next as never);
}

export function isTeamStatusTransitionAllowed(
  current: Team['status'],
  next: Team['status'],
): boolean {
  return current === next || TEAM_STATUS_TRANSITIONS[current].includes(next as never);
}

export function isShiftStatusTransitionAllowed(
  current: Shift['status'],
  next: Shift['status'],
): boolean {
  return current === next || SHIFT_STATUS_TRANSITIONS[current].includes(next as never);
}

export function isShiftAssignmentStatusTransitionAllowed(
  current: ShiftAssignment['status'],
  next: ShiftAssignment['status'],
): boolean {
  return current === next || SHIFT_ASSIGNMENT_STATUS_TRANSITIONS[current].includes(next as never);
}

function isTerminalShiftStatus(status: Shift['status']): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function hasShiftMutation(input: ShiftUpdateRequest, currentStatus: Shift['status']): boolean {
  return input.status !== undefined && input.status !== currentStatus ||
    Object.keys(input).some((key) => !['expectedVersion', 'reasonCode', 'status'].includes(key));
}

function hasAssignmentMutation(
  input: ShiftAssignmentUpdateRequest,
  currentStatus: ShiftAssignment['status'],
): boolean {
  return input.status !== undefined && input.status !== currentStatus ||
    input.scopes !== undefined || input.elderAssignments !== undefined;
}

interface FindFirstDelegate {
  findFirst(args: { where: Record<string, unknown>; select: { id: true } }): Promise<{ id: string } | null>;
}

async function assertExistsOrConflict(
  delegate: FindFirstDelegate,
  context: M02FacilityContext,
  id: string,
  extra: Record<string, unknown> = {},
): Promise<never> {
  const exists = await delegate.findFirst({ where: { ...scope(context, id), ...extra }, select: { id: true } });
  if (exists === null) throw resourceNotFound();
  throw m02Conflict();
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
