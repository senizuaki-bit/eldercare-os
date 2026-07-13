import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type {
  AccessibilityProfile,
  AdmitElderRequest,
  CaregiverElderSummary,
  CommunicationPreference,
  ConsentRecord,
  ConsentRecordCreateRequest,
  DischargeElderStayRequest,
  ElderCreateRequest,
  ElderDetail,
  ElderListItem,
  ElderStay,
  EldersPage,
  EldersQuery,
  ElderUpdateRequest,
  FamilyElderSummary,
  FamilyRelationship,
  FamilyRelationshipCreateRequest,
  PersonalBaseline,
  PersonalBaselineCreateRequest,
  SharingPreferencesUpdateRequest,
  TransferElderStayRequest,
} from '@eldercare/contracts';
import type { FamilyShareableElderField } from '@eldercare/authz';
import type { Prisma } from '@eldercare/db';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ElderAccessService } from './elder-access.service.js';
import type { M02FacilityContext } from './m02-context.js';
import { m02Conflict, m02InvalidRequest, m02InvalidState } from './m02-errors.js';
import { M02MutationService } from './m02-mutation.service.js';

@Injectable()
export class EldersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ElderAccessService) private readonly access: ElderAccessService,
    @Inject(M02MutationService) private readonly mutations: M02MutationService,
  ) {}

  async list(
    context: M02FacilityContext,
    query: EldersQuery,
    session: AuthenticatedSession,
  ): Promise<EldersPage> {
    const where = elderWhere(context, query);
    if (session.principal.portal === 'admin') {
      const [total, records] = await this.database.client.$transaction([
        this.database.client.elder.count({ where }),
        this.database.client.elder.findMany({
          where,
          include: elderSummaryInclude,
          orderBy: query.sort === 'admittedAt' ? { displayName: 'asc' } : elderOrder(query),
          ...(query.sort === 'admittedAt' ? {} : { skip: pageSkip(query), take: query.pageSize }),
        }),
      ]);
      const ordered = query.sort === 'admittedAt'
        ? sortByAdmission(records, query.direction).slice(pageSkip(query), pageSkip(query) + query.pageSize)
        : records;
      return { items: ordered.map(mapElderList), pageInfo: pageInfo(query, total) };
    }

    const candidates = await this.database.client.elder.findMany({
      where,
      include: elderSummaryInclude,
      orderBy: elderOrder(query),
      take: 500,
    });
    const allowed: ElderSummaryRecord[] = [];
    for (const candidate of candidates) {
      try {
        await this.access.assert(context, candidate.id, session, 'BASIC');
        allowed.push(candidate);
      } catch (error) {
        if (!isResourceNotFound(error)) throw error;
      }
    }
    if (query.sort === 'admittedAt') sortByAdmission(allowed, query.direction);
    const start = pageSkip(query);
    return {
      items: allowed.slice(start, start + query.pageSize).map(mapElderList),
      pageInfo: pageInfo(query, allowed.length),
    };
  }

  async get(
    context: M02FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
    view: 'BASIC' | 'SENSITIVE',
  ): Promise<ElderDetail> {
    await this.access.assert(context, elderId, session, view);
    const record = await this.database.client.elder.findFirst({
      where: { ...scope(context), id: elderId },
      include: elderSummaryInclude,
    });
    if (record === null) throw resourceNotFound();
    return mapElderDetail(record);
  }

  async create(
    context: M02FacilityContext,
    input: ElderCreateRequest,
    session: AuthenticatedSession,
  ): Promise<ElderDetail> {
    await this.assertElderReferences(context, input.careLevelId, input.portalUserId);
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const { careLevelId, birthDate, preferredName, portalUserId, ...recordFields } = input;
      const record = await tx.elder.create({
        data: {
          ...recordFields,
          birthDate: dateOnlyInput(birthDate),
          preferredName: preferredName ?? null,
          portalUserId: portalUserId ?? null,
          currentCareLevelId: careLevelId ?? null,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
        },
        include: elderSummaryInclude,
      });
      await this.recordElderMutation(tx, context, session, record.id, record.version, 'CREATED', {
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'ELDER_RECORD_CREATED',
      });
      return mapElderDetail(record);
    }));
  }

  async update(
    context: M02FacilityContext,
    elderId: string,
    input: ElderUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<ElderDetail> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    await this.assertElderReferences(context, input.careLevelId ?? undefined, input.portalUserId ?? undefined);
    if (input.status !== undefined) {
      const activeStay = await this.database.client.elderStay.findFirst({
        where: { ...scope(context), elderId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (input.status === 'ACTIVE' && activeStay === null) {
        throw m02InvalidState('ACTIVE_STATUS_REQUIRES_ACTIVE_STAY');
      }
      if (input.status !== 'ACTIVE' && activeStay !== null) {
        throw m02InvalidState('ACTIVE_STAY_MUST_END_BEFORE_STATUS_CHANGE');
      }
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const { expectedVersion: _expectedVersion, birthDate, careLevelId, ...rest } = input;
      void _expectedVersion;
      const changed = await tx.elder.updateMany({
        where: { ...scope(context), id: elderId, version: input.expectedVersion },
        data: {
          ...rest,
          ...(birthDate === undefined ? {} : { birthDate: dateOnlyInput(birthDate) }),
          ...(careLevelId === undefined ? {} : { currentCareLevelId: careLevelId }),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) await assertElderExistsOrConflict(tx, context, elderId);
      const record = await tx.elder.findUniqueOrThrow({ where: { id: elderId }, include: elderSummaryInclude });
      await this.recordElderMutation(tx, context, session, record.id, record.version, 'UPDATED', {
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'ELDER_RECORD_UPDATED',
      });
      return mapElderDetail(record);
    }));
  }

  async getSensitive(
    context: M02FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const now = new Date();
    const record = await this.database.client.elder.findFirst({
      where: { ...scope(context), id: elderId },
      include: {
        emergencyContacts: { orderBy: [{ priority: 'asc' }, { id: 'asc' }] },
        accessibilityProfile: true,
        communicationPreference: true,
        personalBaselines: { where: { supersededAt: null }, orderBy: { observedAt: 'desc' } },
        consentRecords: {
          where: {
            supersededAt: null,
            effectiveAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          orderBy: { effectiveAt: 'desc' },
        },
      },
    });
    if (record === null) throw resourceNotFound();
    return {
      elderId,
      birthDate: dateOnlyOutput(record.birthDate),
      emergencyContacts: record.emergencyContacts.map(mapEmergencyContact),
      accessibilityProfile: record.accessibilityProfile === null ? null : mapAccessibility(record.accessibilityProfile),
      communicationPreference: record.communicationPreference === null
        ? null
        : mapCommunication(record.communicationPreference),
      personalBaselines: record.personalBaselines.map(mapBaseline),
      currentConsents: record.consentRecords.map(mapConsent),
    };
  }

  async listStays(
    context: M02FacilityContext,
    elderId: string,
    rawQuery: Record<string, unknown>,
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'BASIC');
    const query = basicPage(rawQuery);
    const where = { ...scope(context), elderId };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.elderStay.count({ where }),
      this.database.client.elderStay.findMany({
        where,
        orderBy: [{ admittedAt: 'desc' }, { id: 'desc' }],
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapStay), pageInfo: pageInfo(query, total) };
  }

  async admit(
    context: M02FacilityContext,
    elderId: string,
    input: AdmitElderRequest,
    session: AuthenticatedSession,
  ): Promise<ElderStay> {
    await this.access.assert(context, elderId, session, 'BASIC');
    try {
      return await this.database.client.$transaction(async (tx) => {
        const [elder, bed, activeStay] = await Promise.all([
          tx.elder.findFirst({ where: { ...scope(context), id: elderId } }),
          tx.bed.findFirst({
            where: {
              ...scope(context),
              id: input.bedId,
              operationalStatus: 'ACTIVE',
              room: {
                status: 'ACTIVE',
                floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
                OR: [{ zoneId: null }, { zone: { status: 'ACTIVE' } }],
              },
            },
          }),
          tx.elderStay.findFirst({ where: { ...scope(context), elderId, status: 'ACTIVE' }, select: { id: true } }),
        ]);
        if (elder === null || bed === null) throw resourceNotFound();
        if (elder.version !== input.expectedElderVersion) throw m02Conflict();
        if (elder.status === 'ARCHIVED') throw m02InvalidState('ARCHIVED_ELDER_CANNOT_BE_ADMITTED');
        if (activeStay !== null) throw m02InvalidState('ELDER_ALREADY_ADMITTED');
        const admittedAt = new Date(input.admittedAt);
        assertNotFuture(admittedAt, 'admittedAt');
        const occupied = await tx.elderStay.findFirst({
          where: {
            ...scope(context),
            bedId: input.bedId,
            admittedAt: { lte: admittedAt },
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: admittedAt } }],
          },
          select: { id: true },
        });
        if (occupied !== null) throw m02Conflict('BED_STAY_OVERLAP');
        const admission = await tx.admissionRecord.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId,
            admissionNumber: createAdmissionNumber(elder.recordNumber, elderId, admittedAt),
            admittedAt,
            admissionReasonCode: input.admissionReasonCode ?? null,
          },
        });
        const stay = await tx.elderStay.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            admissionRecordId: admission.id,
            elderId,
            bedId: input.bedId,
            status: 'ACTIVE',
            admittedAt,
            admissionReasonCode: input.admissionReasonCode ?? null,
          },
        });
        await tx.elder.update({ where: { id: elderId }, data: { status: 'ACTIVE', version: { increment: 1 } } });
        await this.recordElderMutation(tx, context, session, elderId, stay.version, 'STAY_STARTED', {
          aggregateType: 'ELDER_STAY',
          aggregateId: stay.id,
          visibility: 'FAMILY_ELIGIBLE',
          safeSummaryCode: 'ELDER_ADMITTED',
          safeMetadata: { bedId: input.bedId },
        });
        return mapStay(stay);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isOverlapError(error)) throw m02Conflict('BED_STAY_OVERLAP');
      throw error;
    }
  }

  async transfer(
    context: M02FacilityContext,
    elderId: string,
    stayId: string,
    input: TransferElderStayRequest,
    session: AuthenticatedSession,
  ): Promise<ElderStay> {
    await this.access.assert(context, elderId, session, 'BASIC');
    try {
      return await this.database.client.$transaction(async (tx) => {
        const [stay, targetBed] = await Promise.all([
          tx.elderStay.findFirst({ where: { ...scope(context), id: stayId, elderId } }),
          tx.bed.findFirst({
            where: {
              ...scope(context),
              id: input.targetBedId,
              operationalStatus: 'ACTIVE',
              room: {
                status: 'ACTIVE',
                floor: { status: 'ACTIVE', building: { status: 'ACTIVE' } },
                OR: [{ zoneId: null }, { zone: { status: 'ACTIVE' } }],
              },
            },
          }),
        ]);
        if (stay === null || targetBed === null) throw resourceNotFound();
        if (stay.version !== input.expectedStayVersion) throw m02Conflict();
        if (stay.status !== 'ACTIVE' || stay.dischargedAt !== null) throw m02InvalidState('STAY_NOT_ACTIVE');
        if (stay.bedId === input.targetBedId) throw m02InvalidRequest('targetBedId', 'TARGET_BED_UNCHANGED');
        const transferredAt = new Date(input.transferredAt);
        assertNotFuture(transferredAt, 'transferredAt');
        if (transferredAt <= stay.admittedAt) throw m02InvalidRequest('transferredAt', 'MUST_BE_AFTER_ADMISSION');
        const occupied = await tx.elderStay.findFirst({
          where: {
            ...scope(context),
            bedId: input.targetBedId,
            admittedAt: { lte: transferredAt },
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: transferredAt } }],
          },
          select: { id: true },
        });
        if (occupied !== null) throw m02Conflict('BED_STAY_OVERLAP');
        await tx.elderStay.update({
          where: { id: stay.id },
          data: {
            status: 'DISCHARGED',
            dischargedAt: transferredAt,
            dischargeReasonCode: input.reasonCode,
            version: { increment: 1 },
          },
        });
        const next = await tx.elderStay.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            admissionRecordId: stay.admissionRecordId,
            elderId,
            bedId: input.targetBedId,
            previousStayId: stay.id,
            status: 'ACTIVE',
            admittedAt: transferredAt,
            admissionReasonCode: input.reasonCode,
          },
        });
        await tx.elder.update({ where: { id: elderId }, data: { version: { increment: 1 } } });
        await this.recordElderMutation(tx, context, session, elderId, next.version, 'STAY_TRANSFERRED', {
          aggregateType: 'ELDER_STAY',
          aggregateId: next.id,
          reasonCode: input.reasonCode,
          visibility: 'FAMILY_ELIGIBLE',
          safeSummaryCode: 'ELDER_ROOM_TRANSFERRED',
          safeMetadata: { bedId: input.targetBedId },
        });
        return mapStay(next);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isOverlapError(error)) throw m02Conflict('BED_STAY_OVERLAP');
      throw error;
    }
  }

  async discharge(
    context: M02FacilityContext,
    elderId: string,
    stayId: string,
    input: DischargeElderStayRequest,
    session: AuthenticatedSession,
  ): Promise<ElderStay> {
    await this.access.assert(context, elderId, session, 'BASIC');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const stay = await tx.elderStay.findFirst({ where: { ...scope(context), id: stayId, elderId } });
      if (stay === null) throw resourceNotFound();
      if (stay.version !== input.expectedStayVersion) throw m02Conflict();
      if (stay.status !== 'ACTIVE' || stay.dischargedAt !== null) throw m02InvalidState('STAY_NOT_ACTIVE');
      const dischargedAt = new Date(input.dischargedAt);
      assertNotFuture(dischargedAt, 'dischargedAt');
      if (dischargedAt <= stay.admittedAt) throw m02InvalidRequest('dischargedAt', 'MUST_BE_AFTER_ADMISSION');
      const updated = await tx.elderStay.update({
        where: { id: stay.id },
        data: {
          status: 'DISCHARGED',
          dischargedAt,
          dischargeReasonCode: input.reasonCode,
          version: { increment: 1 },
        },
      });
      if (stay.admissionRecordId !== null) {
        await tx.admissionRecord.update({
          where: { id: stay.admissionRecordId },
          data: {
            status: 'DISCHARGED',
            dischargedAt,
            dischargeReasonCode: input.reasonCode,
            version: { increment: 1 },
          },
        });
      }
      await tx.elder.update({
        where: { id: elderId },
        data: { status: 'DISCHARGED', version: { increment: 1 } },
      });
      await this.recordElderMutation(tx, context, session, elderId, updated.version, 'STAY_DISCHARGED', {
        aggregateType: 'ELDER_STAY',
        aggregateId: updated.id,
        reasonCode: input.reasonCode,
        visibility: 'FAMILY_ELIGIBLE',
        safeSummaryCode: 'ELDER_DISCHARGED',
      });
      return mapStay(updated);
    }, { isolationLevel: 'Serializable' }));
  }

  async listRelationships(
    context: M02FacilityContext,
    elderId: string,
    rawQuery: Record<string, unknown>,
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const query = basicPage(rawQuery);
    const where = { ...scope(context), elderId };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.familyRelationship.count({ where }),
      this.database.client.familyRelationship.findMany({
        where,
        include: { sharingPreferences: { orderBy: [{ field: 'asc' }, { version: 'desc' }] } },
        orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapRelationship), pageInfo: pageInfo(query, total) };
  }

  async createRelationship(
    context: M02FacilityContext,
    elderId: string,
    input: FamilyRelationshipCreateRequest,
    session: AuthenticatedSession,
  ): Promise<FamilyRelationship> {
    await this.access.assert(context, elderId, session, 'BASIC');
    if (input.relationshipKind === 'OTHER' && input.relationshipLabel === undefined) {
      throw m02InvalidRequest('relationshipLabel', 'REQUIRED_FOR_OTHER_RELATIONSHIP');
    }
    const familyUser = await this.database.client.user.findFirst({
      where: {
        id: input.familyUserId,
        userRoles: {
          some: {
            organizationId: context.organizationId,
            revokedAt: null,
            role: { code: 'FAMILY' },
          },
        },
      },
      select: { id: true },
    });
    if (familyUser === null) throw resourceNotFound();
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const record = await tx.familyRelationship.create({
        data: {
          ...input,
          relationshipLabel: input.relationshipLabel ?? null,
          activeFrom: new Date(input.activeFrom),
          activeUntil: input.activeUntil === undefined ? null : new Date(input.activeUntil),
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
        },
        include: { sharingPreferences: true },
      });
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'FAMILY_RELATIONSHIP_CREATED', {
        aggregateType: 'FAMILY_RELATIONSHIP',
        aggregateId: record.id,
        visibility: 'INTERNAL',
        safeSummaryCode: 'FAMILY_RELATIONSHIP_PENDING',
      });
      return mapRelationship(record);
    }));
  }

  async decideRelationship(
    context: M02FacilityContext,
    elderId: string,
    relationshipId: string,
    decision: 'REVOKED' | 'VERIFIED',
    input: { expectedVersion: number; reasonCode?: string },
    session: AuthenticatedSession,
  ): Promise<FamilyRelationship> {
    await this.access.assert(context, elderId, session, 'BASIC');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.familyRelationship.findFirst({
        where: { ...scope(context), id: relationshipId, elderId },
        select: { activeFrom: true },
      });
      if (current === null) throw resourceNotFound();
      const changed = await tx.familyRelationship.updateMany({
        where: {
          ...scope(context),
          id: relationshipId,
          elderId,
          version: input.expectedVersion,
          ...(decision === 'VERIFIED' ? { status: 'PENDING' } : { status: { in: ['PENDING', 'VERIFIED'] } }),
        },
        data: decision === 'VERIFIED'
          ? { status: 'VERIFIED', verifiedAt: now, verifiedByUserId: session.userId, version: { increment: 1 } }
          : {
              status: 'REVOKED',
              revokedAt: now,
              activeUntil: current.activeFrom < now ? now : null,
              version: { increment: 1 },
            },
      });
      if (changed.count === 0) await assertRelationshipExistsOrConflict(tx, context, elderId, relationshipId);
      const record = await tx.familyRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        include: { sharingPreferences: { orderBy: [{ field: 'asc' }, { version: 'desc' }] } },
      });
      await this.recordElderMutation(
        tx,
        context,
        session,
        elderId,
        record.version,
        `FAMILY_RELATIONSHIP_${decision}`,
        {
          aggregateType: 'FAMILY_RELATIONSHIP',
          aggregateId: record.id,
          reasonCode: input.reasonCode,
          visibility: 'INTERNAL',
          safeSummaryCode: `FAMILY_RELATIONSHIP_${decision}`,
        },
      );
      return mapRelationship(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateSharingPreferences(
    context: M02FacilityContext,
    elderId: string,
    relationshipId: string,
    input: SharingPreferencesUpdateRequest,
    session: AuthenticatedSession,
  ): Promise<FamilyRelationship> {
    await this.access.assert(context, elderId, session, 'BASIC');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const relationshipChanged = await tx.familyRelationship.updateMany({
        where: {
          ...scope(context),
          id: relationshipId,
          elderId,
          status: 'VERIFIED',
          version: input.expectedVersion,
        },
        data: { version: { increment: 1 } },
      });
      if (relationshipChanged.count === 0) {
        await assertRelationshipExistsOrConflict(tx, context, elderId, relationshipId);
      }
      const replacementAt = new Date();
      const invalidValidityWindow = input.preferences.find(
        (preference) => preference.validUntil !== undefined &&
          new Date(preference.validUntil) <= replacementAt,
      );
      if (invalidValidityWindow !== undefined) {
        throw m02InvalidRequest('validUntil', 'MUST_BE_AFTER_REPLACEMENT');
      }
      const consent = await tx.consentRecord.findFirst({
        where: {
          ...scope(context),
          elderId,
          purpose: 'FAMILY_SHARING',
          decision: 'GRANTED',
          supersededAt: null,
          effectiveAt: { lte: replacementAt },
          OR: [{ expiresAt: null }, { expiresAt: { gt: replacementAt } }],
        },
        orderBy: { consentVersion: 'desc' },
      });
      if (consent === null && input.preferences.some((preference) => preference.allowed)) {
        throw m02InvalidState('FAMILY_SHARING_CONSENT_REQUIRED');
      }
      const existingPreferences = await tx.sharingPreference.findMany({
        where: { ...scope(context), elderId, familyRelationshipId: relationshipId },
        orderBy: [{ field: 'asc' }, { version: 'desc' }],
      });
      const existingByField = new Map<
        FamilyShareableElderField,
        (typeof existingPreferences[number])[]
      >();
      for (const existing of existingPreferences) {
        const records = existingByField.get(existing.field) ?? [];
        records.push(existing);
        existingByField.set(existing.field, records);
      }
      const requestedByField = new Map(
        input.preferences.map((preference) => [preference.field, preference] as const),
      );
      const replacementFields = new Set<FamilyShareableElderField>([
        ...existingByField.keys(),
        ...requestedByField.keys(),
      ]);
      for (const field of replacementFields) {
        const existingForField = existingByField.get(field) ?? [];
        let latestVersion = 0;
        let priorConsentRecordId: string | null = null;
        for (const existing of existingForField) {
          latestVersion = Math.max(latestVersion, existing.version);
          priorConsentRecordId ??= existing.consentRecordId;
          if (existing.validUntil !== null && existing.validUntil <= replacementAt) continue;
          if (existing.validFrom < replacementAt) {
            await tx.sharingPreference.update({
              where: { id: existing.id },
              data: { validUntil: replacementAt },
            });
            continue;
          }
          await tx.sharingPreference.update({
            where: { id: existing.id },
            data: {
              allowed: false,
              ...(existing.validUntil === null
                ? { validUntil: new Date(existing.validFrom.getTime() + 1) }
                : {}),
            },
          });
        }
        const requested = requestedByField.get(field);
        await tx.sharingPreference.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId,
            familyRelationshipId: relationshipId,
            consentRecordId: requested?.allowed === true
              ? consent?.id ?? null
              : consent?.id ?? priorConsentRecordId,
            field,
            allowed: requested?.allowed ?? false,
            validFrom: replacementAt,
            validUntil: requested?.validUntil === undefined ? null : new Date(requested.validUntil),
            version: latestVersion + 1,
          },
        });
      }
      const updated = await tx.familyRelationship.findUniqueOrThrow({
        where: { id: relationshipId },
        include: { sharingPreferences: { orderBy: [{ field: 'asc' }, { version: 'desc' }] } },
      });
      await this.recordElderMutation(tx, context, session, elderId, updated.version, 'FAMILY_SHARING_UPDATED', {
        aggregateType: 'FAMILY_RELATIONSHIP',
        aggregateId: updated.id,
        visibility: 'INTERNAL',
        safeSummaryCode: 'FAMILY_SHARING_UPDATED',
      });
      return mapRelationship(updated);
    }, { isolationLevel: 'Serializable' }));
  }

  async listEmergencyContacts(
    context: M02FacilityContext,
    elderId: string,
    rawQuery: Record<string, unknown>,
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const query = basicPage(rawQuery);
    const where = { ...scope(context), elderId };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.emergencyContact.count({ where }),
      this.database.client.emergencyContact.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapEmergencyContact), pageInfo: pageInfo(query, total) };
  }

  async createEmergencyContact(
    context: M02FacilityContext,
    elderId: string,
    input: {
      familyRelationshipId?: string;
      displayName: string;
      relationshipLabel: string;
      contactValue: string;
      priority: number;
      isPrimary: boolean;
      active: boolean;
    },
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    if (input.isPrimary && !input.active) {
      throw m02InvalidRequest('isPrimary', 'PRIMARY_CONTACT_MUST_BE_ACTIVE');
    }
    if (input.familyRelationshipId !== undefined) {
      const relationship = await this.database.client.familyRelationship.findFirst({
        where: { ...scope(context), id: input.familyRelationshipId, elderId },
        select: { id: true },
      });
      if (relationship === null) throw resourceNotFound();
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.emergencyContact.updateMany({
          where: { ...scope(context), elderId, isPrimary: true },
          data: { isPrimary: false, version: { increment: 1 } },
        });
      }
      const record = await tx.emergencyContact.create({
        data: {
          ...input,
          familyRelationshipId: input.familyRelationshipId ?? null,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
        },
      });
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'EMERGENCY_CONTACT_CREATED', {
        aggregateType: 'EMERGENCY_CONTACT',
        aggregateId: record.id,
        visibility: 'INTERNAL',
        safeSummaryCode: 'EMERGENCY_CONTACT_UPDATED',
      });
      return mapEmergencyContact(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async updateEmergencyContact(
    context: M02FacilityContext,
    elderId: string,
    contactId: string,
    input: {
      expectedVersion: number;
      familyRelationshipId?: string | null;
      displayName?: string;
      relationshipLabel?: string;
      contactValue?: string;
      priority?: number;
      isPrimary?: boolean;
      active?: boolean;
    },
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    if (input.familyRelationshipId !== undefined && input.familyRelationshipId !== null) {
      const relationship = await this.database.client.familyRelationship.findFirst({
        where: { ...scope(context), id: input.familyRelationshipId, elderId },
        select: { id: true },
      });
      if (relationship === null) throw resourceNotFound();
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.emergencyContact.findFirst({
        where: { ...scope(context), id: contactId, elderId },
      });
      if (current === null) throw resourceNotFound();
      const nextPrimary = input.isPrimary ?? current.isPrimary;
      const nextActive = input.active ?? current.active;
      if (nextPrimary && !nextActive) {
        throw m02InvalidRequest('isPrimary', 'PRIMARY_CONTACT_MUST_BE_ACTIVE');
      }
      if (nextPrimary && !current.isPrimary) {
        await tx.emergencyContact.updateMany({
          where: { ...scope(context), elderId, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false, version: { increment: 1 } },
        });
      }
      const { expectedVersion: _expectedVersion, ...data } = input;
      void _expectedVersion;
      const changed = await tx.emergencyContact.updateMany({
        where: { ...scope(context), id: contactId, elderId, version: input.expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (changed.count === 0) await assertChildExistsOrConflict(tx.emergencyContact, context, elderId, contactId);
      const record = await tx.emergencyContact.findUniqueOrThrow({ where: { id: contactId } });
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'EMERGENCY_CONTACT_UPDATED', {
        aggregateType: 'EMERGENCY_CONTACT',
        aggregateId: record.id,
        visibility: 'INTERNAL',
        safeSummaryCode: 'EMERGENCY_CONTACT_UPDATED',
      });
      return mapEmergencyContact(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async getAccessibilityProfile(
    context: M02FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
  ): Promise<AccessibilityProfile | null> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const record = await this.database.client.accessibilityProfile.findFirst({ where: { ...scope(context), elderId } });
    return record === null ? null : mapAccessibility(record);
  }

  async updateAccessibilityProfile(
    context: M02FacilityContext,
    elderId: string,
    input: Partial<Omit<AccessibilityProfile, 'elderId' | 'version' | 'updatedAt'>> & { expectedVersion: number },
    session: AuthenticatedSession,
  ): Promise<AccessibilityProfile> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const existing = await tx.accessibilityProfile.findFirst({ where: { ...scope(context), elderId } });
      const { expectedVersion: _expectedVersion, ...data } = input;
      void _expectedVersion;
      let record;
      if (existing === null) {
        record = await tx.accessibilityProfile.create({
            data: { ...data, organizationId: context.organizationId, facilityId: context.facilityId, elderId },
          });
      } else {
        const changed = await tx.accessibilityProfile.updateMany({
          where: { ...scope(context), id: existing.id, elderId, version: input.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count === 0) throw m02Conflict();
        record = await tx.accessibilityProfile.findUniqueOrThrow({ where: { id: existing.id } });
      }
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'ACCESSIBILITY_UPDATED', {
        aggregateType: 'ACCESSIBILITY_PROFILE',
        aggregateId: record.id,
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'ACCESSIBILITY_PREFERENCE_UPDATED',
      });
      return mapAccessibility(record);
    }));
  }

  async getCommunicationPreference(
    context: M02FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
  ): Promise<CommunicationPreference | null> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const record = await this.database.client.communicationPreference.findFirst({ where: { ...scope(context), elderId } });
    return record === null ? null : mapCommunication(record);
  }

  async updateCommunicationPreference(
    context: M02FacilityContext,
    elderId: string,
    input: Partial<Omit<CommunicationPreference, 'elderId' | 'version' | 'updatedAt'>> & { expectedVersion: number },
    session: AuthenticatedSession,
  ): Promise<CommunicationPreference> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const existing = await tx.communicationPreference.findFirst({ where: { ...scope(context), elderId } });
      const { expectedVersion: _expectedVersion, quietHoursStart, quietHoursEnd, ...data } = input;
      void _expectedVersion;
      const nextQuietHoursStart = quietHoursStart === undefined
        ? existing?.quietHoursStart ?? null
        : timeInput(quietHoursStart);
      const nextQuietHoursEnd = quietHoursEnd === undefined
        ? existing?.quietHoursEnd ?? null
        : timeInput(quietHoursEnd);
      if ((nextQuietHoursStart === null) !== (nextQuietHoursEnd === null)) {
        throw m02InvalidRequest('quietHoursEnd', 'QUIET_HOURS_REQUIRE_BOTH_VALUES');
      }
      const dbData = {
        ...data,
        ...(quietHoursStart === undefined ? {} : { quietHoursStart: nextQuietHoursStart }),
        ...(quietHoursEnd === undefined ? {} : { quietHoursEnd: nextQuietHoursEnd }),
      };
      let record;
      if (existing === null) {
        record = await tx.communicationPreference.create({
            data: { ...dbData, organizationId: context.organizationId, facilityId: context.facilityId, elderId },
          });
      } else {
        const changed = await tx.communicationPreference.updateMany({
          where: { ...scope(context), id: existing.id, elderId, version: input.expectedVersion },
          data: { ...dbData, version: { increment: 1 } },
        });
        if (changed.count === 0) throw m02Conflict();
        record = await tx.communicationPreference.findUniqueOrThrow({ where: { id: existing.id } });
      }
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'COMMUNICATION_UPDATED', {
        aggregateType: 'COMMUNICATION_PREFERENCE',
        aggregateId: record.id,
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'COMMUNICATION_PREFERENCE_UPDATED',
      });
      return mapCommunication(record);
    }));
  }

  async listPersonalBaselines(
    context: M02FacilityContext,
    elderId: string,
    rawQuery: Record<string, unknown>,
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const query = basicPage(rawQuery);
    const where = { ...scope(context), elderId };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.personalBaseline.count({ where }),
      this.database.client.personalBaseline.findMany({
        where,
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapBaseline), pageInfo: pageInfo(query, total) };
  }

  async createPersonalBaseline(
    context: M02FacilityContext,
    elderId: string,
    input: PersonalBaselineCreateRequest,
    session: AuthenticatedSession,
  ): Promise<PersonalBaseline> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const validFrom = new Date(input.validFrom);
    assertNotFuture(validFrom, 'validFrom');
    assertNotFuture(new Date(input.observedAt), 'observedAt');
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const elder = await tx.elder.findFirst({
        where: { ...scope(context), id: elderId },
        select: { version: true, portalUserId: true },
      });
      if (elder === null) throw resourceNotFound();
      await this.assertBaselineReferences(tx, context, elderId, elder.portalUserId, input);
      const claimed = await tx.elder.updateMany({
        where: { ...scope(context), id: elderId, version: elder.version },
        data: { version: { increment: 1 } },
      });
      if (claimed.count === 0) throw m02Conflict();
      const now = new Date(input.validFrom);
      const current = await tx.personalBaseline.findFirst({
        where: { elderId, domain: input.domain, baselineKey: input.baselineKey, supersededAt: null },
        orderBy: { version: 'desc' },
      });
      if (current !== null) {
        if (validFrom <= current.validFrom) {
          throw m02InvalidRequest('validFrom', 'MUST_BE_AFTER_CURRENT_VERSION');
        }
        await tx.personalBaseline.update({ where: { id: current.id }, data: { supersededAt: now } });
      }
      const record = await tx.personalBaseline.create({
        data: {
          ...input,
          sourceUserId: input.sourceUserId ?? null,
          confirmedByStaffProfileId: input.confirmedByStaffProfileId ?? null,
          inferenceMethod: input.inferenceMethod ?? null,
          confidence: input.confidence ?? null,
          observedAt: new Date(input.observedAt),
          validFrom: now,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          version: (current?.version ?? 0) + 1,
        },
      });
      await this.recordElderMutation(tx, context, session, elderId, record.version, 'PERSONAL_BASELINE_CREATED', {
        aggregateType: 'PERSONAL_BASELINE',
        aggregateId: record.id,
        visibility: 'INTERNAL',
        safeSummaryCode: 'PERSONAL_BASELINE_UPDATED',
      });
      return mapBaseline(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async listConsents(
    context: M02FacilityContext,
    elderId: string,
    query: {
      page: number;
      pageSize: number;
      purpose?: string;
      decision?: string;
      currentOnly: boolean;
      sort: 'effectiveAt' | 'purpose' | 'createdAt';
      direction: 'asc' | 'desc';
    },
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'SENSITIVE');
    const where: Prisma.ConsentRecordWhereInput = {
      ...scope(context),
      elderId,
      ...(query.purpose === undefined ? {} : { purpose: query.purpose as Prisma.EnumConsentPurposeFilter['equals'] }),
      ...(query.decision === undefined ? {} : { decision: query.decision as Prisma.EnumConsentDecisionFilter['equals'] }),
      ...(query.currentOnly ? { supersededAt: null } : {}),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.consentRecord.count({ where }),
      this.database.client.consentRecord.findMany({
        where,
        orderBy: { [query.sort]: query.direction },
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapConsent), pageInfo: pageInfo(query, total) };
  }

  async createConsent(
    context: M02FacilityContext,
    elderId: string,
    input: ConsentRecordCreateRequest,
    session: AuthenticatedSession,
  ): Promise<ConsentRecord> {
    await this.access.assert(context, elderId, session, 'BASIC');
    if (new Date(input.effectiveAt) > new Date()) {
      throw m02InvalidRequest('effectiveAt', 'FUTURE_EFFECTIVE_AT_NOT_SUPPORTED');
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const claimed = await tx.elder.updateMany({
        where: { ...scope(context), id: elderId, version: input.expectedElderVersion },
        data: { version: { increment: 1 } },
      });
      if (claimed.count === 0) await assertElderExistsOrConflict(tx, context, elderId);
      const effectiveAt = new Date(input.effectiveAt);
      const current = await tx.consentRecord.findFirst({
        where: { elderId, purpose: input.purpose, supersededAt: null },
        orderBy: { consentVersion: 'desc' },
      });
      if (current !== null) {
        if (effectiveAt <= current.effectiveAt) {
          throw m02InvalidRequest('effectiveAt', 'MUST_BE_AFTER_CURRENT_VERSION');
        }
        const superseded = await tx.consentRecord.updateMany({
          where: { id: current.id, supersededAt: null, consentVersion: current.consentVersion },
          data: { supersededAt: effectiveAt },
        });
        if (superseded.count === 0) throw m02Conflict();
      }
      const record = await tx.consentRecord.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          purpose: input.purpose,
          decision: input.decision,
          authority: input.authority,
          consentVersion: (current?.consentVersion ?? 0) + 1,
          effectiveAt,
          expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
          reasonCode: input.reasonCode ?? null,
          recordedByUserId: session.userId,
        },
      });
      await this.recordElderMutation(tx, context, session, elderId, record.consentVersion, 'CONSENT_RECORDED', {
        aggregateType: 'CONSENT_RECORD',
        aggregateId: record.id,
        reasonCode: input.reasonCode,
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'CONSENT_DECISION_RECORDED',
        safeMetadata: { purpose: record.purpose, decision: record.decision },
      });
      return mapConsent(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async withdrawConsent(
    context: M02FacilityContext,
    elderId: string,
    consentId: string,
    input: {
      expectedConsentVersion: number;
      effectiveAt: string;
      authority: 'AUTHORIZED_REPRESENTATIVE' | 'ELDER' | 'LEGAL_BASIS';
      reasonCode?: string;
    },
    session: AuthenticatedSession,
  ): Promise<ConsentRecord> {
    await this.access.assert(context, elderId, session, 'BASIC');
    if (new Date(input.effectiveAt) > new Date()) {
      throw m02InvalidRequest('effectiveAt', 'FUTURE_EFFECTIVE_AT_NOT_SUPPORTED');
    }
    return this.unique(async () => this.database.client.$transaction(async (tx) => {
      const current = await tx.consentRecord.findFirst({
        where: { ...scope(context), id: consentId, elderId, supersededAt: null },
      });
      if (current === null) throw resourceNotFound();
      if (current.consentVersion !== input.expectedConsentVersion) throw m02Conflict();
      if (current.decision !== 'GRANTED') throw m02InvalidState('CONSENT_NOT_GRANTED');
      const effectiveAt = new Date(input.effectiveAt);
      if (effectiveAt <= current.effectiveAt) {
        throw m02InvalidRequest('effectiveAt', 'MUST_BE_AFTER_CURRENT_VERSION');
      }
      const superseded = await tx.consentRecord.updateMany({
        where: {
          id: current.id,
          elderId,
          decision: 'GRANTED',
          supersededAt: null,
          consentVersion: input.expectedConsentVersion,
        },
        data: { supersededAt: effectiveAt },
      });
      if (superseded.count === 0) throw m02Conflict();
      const record = await tx.consentRecord.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          purpose: current.purpose,
          decision: 'WITHDRAWN',
          authority: input.authority,
          consentVersion: current.consentVersion + 1,
          effectiveAt,
          reasonCode: input.reasonCode ?? null,
          recordedByUserId: session.userId,
        },
      });
      const elder = await tx.elder.findFirst({ where: { ...scope(context), id: elderId }, select: { version: true } });
      if (elder === null) throw resourceNotFound();
      const elderChanged = await tx.elder.updateMany({
        where: { ...scope(context), id: elderId, version: elder.version },
        data: { version: { increment: 1 } },
      });
      if (elderChanged.count === 0) throw m02Conflict();
      await this.recordElderMutation(tx, context, session, elderId, record.consentVersion, 'CONSENT_WITHDRAWN', {
        aggregateType: 'CONSENT_RECORD',
        aggregateId: record.id,
        reasonCode: input.reasonCode,
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'CONSENT_WITHDRAWN',
        safeMetadata: { purpose: record.purpose },
      });
      return mapConsent(record);
    }, { isolationLevel: 'Serializable' }));
  }

  async listTimeline(
    context: M02FacilityContext,
    elderId: string,
    query: {
      page: number;
      pageSize: number;
      eventType?: string;
      visibility?: string;
      occurredFrom?: string;
      occurredTo?: string;
      direction: 'asc' | 'desc';
    },
    session: AuthenticatedSession,
  ): Promise<unknown> {
    await this.access.assert(context, elderId, session, 'TIMELINE');
    const where: Prisma.ElderTimelineEntryWhereInput = {
      ...scope(context),
      elderId,
      ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
      ...(query.visibility === undefined ? {} : { visibility: query.visibility as Prisma.EnumTimelineVisibilityFilter['equals'] }),
      ...(query.occurredFrom === undefined && query.occurredTo === undefined
        ? {}
        : {
            occurredAt: {
              ...(query.occurredFrom === undefined ? {} : { gte: new Date(query.occurredFrom) }),
              ...(query.occurredTo === undefined ? {} : { lte: new Date(query.occurredTo) }),
            },
          }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.elderTimelineEntry.count({ where }),
      this.database.client.elderTimelineEntry.findMany({
        where,
        orderBy: [{ occurredAt: query.direction }, { id: query.direction }],
        skip: pageSkip(query),
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapTimeline), pageInfo: pageInfo(query, total) };
  }

  async listFamilyElders(
    session: AuthenticatedSession,
    rawQuery: Record<string, unknown>,
    correlationId: string,
  ): Promise<{ items: FamilyElderSummary[]; pageInfo: Record<string, number> }> {
    const context = activeContext(session, correlationId);
    const query = basicPage(rawQuery);
    const relationships = await this.database.client.familyRelationship.findMany({
      where: {
        ...scope(context),
        familyUserId: session.userId,
        status: 'VERIFIED',
        activeFrom: { lte: new Date() },
        revokedAt: null,
        OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
      },
      select: { elderId: true },
      take: 500,
    });
    const summaries: FamilyElderSummary[] = [];
    for (const relationship of relationships) {
      try {
        summaries.push(await this.getFamilyElder(session, relationship.elderId, correlationId));
      } catch (error) {
        if (!isResourceNotFound(error)) throw error;
      }
    }
    const start = pageSkip(query);
    return { items: summaries.slice(start, start + query.pageSize), pageInfo: pageInfo(query, summaries.length) };
  }

  async getFamilyElder(
    session: AuthenticatedSession,
    elderId: string,
    correlationId: string,
  ): Promise<FamilyElderSummary> {
    const context = activeContext(session, correlationId);
    const access = await this.access.assert(context, elderId, session, 'FAMILY_SUMMARY');
    if (access.familyRelationshipId === undefined) throw resourceNotFound();
    if (access.familyConsentRecordId === undefined) throw resourceNotFound();
    const now = new Date();
    const [elder, preferences, baselines, consents, timeline] = await Promise.all([
      this.database.client.elder.findFirst({ where: { ...scope(context), id: elderId }, include: elderSummaryInclude }),
      this.database.client.sharingPreference.findMany({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          familyRelationshipId: access.familyRelationshipId,
          consentRecordId: access.familyConsentRecordId,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
        orderBy: [{ field: 'asc' }, { version: 'desc' }],
      }),
      this.database.client.personalBaseline.findMany({
        where: { ...scope(context), elderId, validFrom: { lte: now }, supersededAt: null },
        orderBy: { observedAt: 'desc' },
        take: 20,
      }),
      this.database.client.consentRecord.findMany({
        where: {
          ...scope(context),
          elderId,
          effectiveAt: { lte: now },
          supersededAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { purpose: 'asc' },
      }),
      this.database.client.elderTimelineEntry.findMany({
        where: { ...scope(context), elderId, visibility: 'FAMILY_ELIGIBLE' },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
    ]);
    if (elder === null) throw resourceNotFound();
    const sharedFields = selectAllowedFieldsForCurrentGrant(
      preferences,
      access.familyConsentRecordId,
      now,
    );
    return familyProjection(elder, sharedFields, baselines, consents, timeline);
  }

  async listCaregiverElders(
    session: AuthenticatedSession,
    rawQuery: Record<string, unknown>,
    correlationId: string,
  ): Promise<{ items: CaregiverElderSummary[]; pageInfo: Record<string, number> }> {
    const context = activeContext(session, correlationId);
    const query = basicPage(rawQuery);
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const staff = await this.database.client.staffProfile.findFirst({
      where: {
        ...scope(context),
        userId: session.userId,
        status: 'ACTIVE',
        endedAt: null,
        OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
      },
      select: { id: true },
    });
    if (staff === null) throw resourceNotFound();
    const assignments = await this.database.client.shiftAssignment.findMany({
      where: {
        ...scope(context),
        staffProfileId: staff.id,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: { startsAt: { lte: now }, endsAt: { gt: now }, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      },
      include: { scopes: true, elderAssignments: true },
    });
    const candidateIds = new Set<string>();
    for (const assignment of assignments) {
      assignment.elderAssignments.forEach((item) => candidateIds.add(item.elderId));
      const facilityWide = assignment.scopes.some((item) => item.kind === 'FACILITY');
      const floorIds = assignment.scopes.flatMap((item) => item.floorId === null ? [] : [item.floorId]);
      const zoneIds = assignment.scopes.flatMap((item) => item.zoneId === null ? [] : [item.zoneId]);
      const elders = await this.database.client.elder.findMany({
        where: {
          ...scope(context),
          stays: {
            some: {
              status: 'ACTIVE',
              ...(facilityWide
                ? {}
                : { bed: { room: { OR: [{ floorId: { in: floorIds } }, { zoneId: { in: zoneIds } }] } } }),
            },
          },
        },
        select: { id: true },
      });
      elders.forEach((item) => candidateIds.add(item.id));
    }
    const summaries: CaregiverElderSummary[] = [];
    for (const elderId of candidateIds) {
      try {
        const result = await this.access.assert(context, elderId, session, 'CAREGIVER_SUMMARY');
        const elder = await this.database.client.elder.findFirst({
          where: { ...scope(context), id: elderId },
          include: { ...elderSummaryInclude, accessibilityProfile: true },
        });
        if (elder !== null && result.shiftAssignmentId !== undefined) {
          const residence = elder.stays[0];
          if (residence !== undefined) {
            summaries.push({
              id: elder.id,
              displayName: elder.displayName,
              preferredName: elder.preferredName,
              currentResidence: mapResidence(residence),
              careLevel: mapCareLevelSummary(elder.currentCareLevel),
              accessibilitySummary: elder.accessibilityProfile === null
                ? null
                : {
                    hearingSupport: elder.accessibilityProfile.hearingSupport,
                    visionSupport: elder.accessibilityProfile.visionSupport,
                    mobilitySupport: elder.accessibilityProfile.mobilitySupport,
                    preferredInputMode: elder.accessibilityProfile.preferredInputMode,
                  },
              operationalAttention: [],
              shiftAssignmentId: result.shiftAssignmentId,
            });
          }
        }
      } catch (error) {
        if (!isResourceNotFound(error)) throw error;
      }
    }
    const start = pageSkip(query);
    return { items: summaries.slice(start, start + query.pageSize), pageInfo: pageInfo(query, summaries.length) };
  }

  private async assertElderReferences(
    context: M02FacilityContext,
    careLevelId?: string | null,
    portalUserId?: string | null,
  ): Promise<void> {
    const [careLevel, portalUser] = await Promise.all([
      careLevelId == null
        ? Promise.resolve({ id: 'none' })
        : this.database.client.careLevel.findFirst({ where: { ...scope(context), id: careLevelId }, select: { id: true } }),
      portalUserId == null
        ? Promise.resolve({ id: 'none' })
        : this.database.client.user.findFirst({
            where: {
              id: portalUserId,
              userRoles: { some: { organizationId: context.organizationId, revokedAt: null, role: { code: 'ELDER' } } },
            },
            select: { id: true },
          }),
    ]);
    if (careLevel === null || portalUser === null) throw resourceNotFound();
  }

  private async assertBaselineReferences(
    client: Prisma.TransactionClient,
    context: M02FacilityContext,
    elderId: string,
    portalUserId: string | null,
    input: PersonalBaselineCreateRequest,
  ): Promise<void> {
    if (input.sourceKind === 'ELDER_STATED') {
      if (portalUserId === null || input.sourceUserId !== portalUserId) throw resourceNotFound();
      const elderUser = await client.user.findFirst({
        where: {
          id: portalUserId,
          status: 'ACTIVE',
          elderProfile: { id: elderId, ...scope(context) },
        },
        select: { id: true },
      });
      if (elderUser === null) throw resourceNotFound();
      return;
    }

    if (input.sourceKind === 'STAFF_CONFIRMED') {
      const staff = await client.staffProfile.findFirst({
        where: {
          ...scope(context),
          id: input.confirmedByStaffProfileId,
          status: 'ACTIVE',
          endedAt: null,
          OR: [{ hiredAt: null }, { hiredAt: { lte: new Date() } }],
          user: { status: 'ACTIVE' },
        },
        select: { id: true, userId: true },
      });
      if (staff === null || (input.sourceUserId !== undefined && input.sourceUserId !== staff.userId)) {
        throw resourceNotFound();
      }
      return;
    }

    if (input.sourceUserId !== undefined) {
      const sourceUser = await client.user.findFirst({
        where: {
          id: input.sourceUserId,
          status: 'ACTIVE',
          userRoles: { some: { organizationId: context.organizationId, revokedAt: null } },
        },
        select: { id: true },
      });
      if (sourceUser === null) throw resourceNotFound();
    }
  }

  private async recordElderMutation(
    tx: Prisma.TransactionClient,
    context: M02FacilityContext,
    session: AuthenticatedSession,
    elderId: string,
    version: number,
    verb: string,
    detail: {
      aggregateType?: string;
      aggregateId?: string;
      reasonCode?: string;
      visibility: 'ELDER_VISIBLE' | 'FAMILY_ELIGIBLE' | 'INTERNAL';
      safeSummaryCode: string;
      safeMetadata?: Readonly<Record<string, Prisma.JsonValue>>;
    },
  ): Promise<void> {
    await this.mutations.record(tx, context, session, {
      action: `ELDER.${verb}`,
      eventType: `ELDER.${verb}.V1`,
      aggregateType: detail.aggregateType ?? 'ELDER',
      aggregateId: detail.aggregateId ?? elderId,
      aggregateVersion: version,
      resourceType: detail.aggregateType ?? 'ELDER',
      reasonCode: detail.reasonCode,
      elderTimeline: {
        elderId,
        visibility: detail.visibility,
        safeSummaryCode: detail.safeSummaryCode,
        safeMetadata: detail.safeMetadata,
      },
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

const elderSummaryInclude = {
  currentCareLevel: true,
  accessibilityProfile: true,
  communicationPreference: true,
  stays: {
    where: { status: 'ACTIVE' as const },
    orderBy: { admittedAt: 'desc' as const },
    take: 1,
    include: {
      bed: {
        include: {
          room: {
            include: {
              floor: { include: { building: true } },
              zone: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ElderInclude;

type ElderSummaryRecord = Prisma.ElderGetPayload<{ include: typeof elderSummaryInclude }>;
type ResidenceRecord = ElderSummaryRecord['stays'][number];

function mapElderList(record: ElderSummaryRecord): ElderListItem {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    recordNumber: record.recordNumber,
    displayName: record.displayName,
    preferredName: record.preferredName,
    status: record.status,
    careLevel: mapCareLevelSummary(record.currentCareLevel),
    currentResidence: record.stays[0] === undefined ? null : mapResidence(record.stays[0]),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapElderDetail(record: ElderSummaryRecord): ElderDetail {
  return {
    ...mapElderList(record),
    portalUserId: record.portalUserId,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapCareLevelSummary(
  record: ElderSummaryRecord['currentCareLevel'],
): { id: string; code: string; name: string; rank: number } | null {
  return record === null
    ? null
    : { id: record.id, code: record.code, name: record.name, rank: record.rank };
}

function mapResidence(record: ResidenceRecord) {
  const room = record.bed.room;
  return {
    stayId: record.id,
    buildingId: room.floor.building.id,
    buildingName: room.floor.building.name,
    floorId: room.floor.id,
    floorName: room.floor.name,
    zoneId: room.zone?.id ?? null,
    zoneName: room.zone?.name ?? null,
    roomId: room.id,
    roomName: room.name,
    bedId: record.bed.id,
    bedLabel: record.bed.label,
    admittedAt: record.admittedAt.toISOString(),
  };
}

function mapStay(record: Prisma.ElderStayGetPayload<Record<string, never>>): ElderStay {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    bedId: record.bedId,
    previousStayId: record.previousStayId,
    status: record.status,
    admittedAt: record.admittedAt.toISOString(),
    dischargedAt: record.dischargedAt?.toISOString() ?? null,
    admissionReasonCode: record.admissionReasonCode,
    dischargeReasonCode: record.dischargeReasonCode,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

type RelationshipWithPreferences = Prisma.FamilyRelationshipGetPayload<{
  include: { sharingPreferences: true };
}>;

function mapRelationship(record: RelationshipWithPreferences): FamilyRelationship {
  const latest = new Map<string, RelationshipWithPreferences['sharingPreferences'][number]>();
  for (const preference of record.sharingPreferences) {
    const current = latest.get(preference.field);
    if (current === undefined || preference.version > current.version) latest.set(preference.field, preference);
  }
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    familyUserId: record.familyUserId,
    relationshipKind: record.relationshipKind,
    relationshipLabel: record.relationshipLabel,
    status: record.status,
    activeFrom: record.activeFrom.toISOString(),
    activeUntil: record.activeUntil?.toISOString() ?? null,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    sharingPreferences: [...latest.values()].map((preference) => ({
      field: preference.field,
      allowed: preference.allowed,
      validFrom: preference.validFrom.toISOString(),
      validUntil: preference.validUntil?.toISOString() ?? null,
    })),
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapEmergencyContact(record: Prisma.EmergencyContactGetPayload<Record<string, never>>) {
  return {
    id: record.id,
    elderId: record.elderId,
    familyRelationshipId: record.familyRelationshipId,
    displayName: record.displayName,
    relationshipLabel: record.relationshipLabel,
    contactValue: record.contactValue,
    priority: record.priority,
    isPrimary: record.isPrimary,
    active: record.active,
    version: record.version,
  };
}

function mapAccessibility(record: Prisma.AccessibilityProfileGetPayload<Record<string, never>>): AccessibilityProfile {
  return {
    elderId: record.elderId,
    preferredTextScale: record.preferredTextScale,
    highContrast: record.highContrast,
    reducedMotion: record.reducedMotion,
    hearingSupport: record.hearingSupport,
    visionSupport: record.visionSupport,
    mobilitySupport: record.mobilitySupport,
    preferredInputMode: record.preferredInputMode,
    humanHandoffPreferred: record.humanHandoffPreferred,
    notes: record.notes,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapCommunication(
  record: Prisma.CommunicationPreferenceGetPayload<Record<string, never>>,
): CommunicationPreference {
  return {
    elderId: record.elderId,
    preferredLanguage: record.preferredLanguage,
    speakingPace: record.speakingPace,
    repeatKeyInformation: record.repeatKeyInformation,
    preferredChannel: record.preferredChannel,
    quietHoursStart: timeOutput(record.quietHoursStart),
    quietHoursEnd: timeOutput(record.quietHoursEnd),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapBaseline(record: Prisma.PersonalBaselineGetPayload<Record<string, never>>): PersonalBaseline {
  return {
    id: record.id,
    elderId: record.elderId,
    baselineKey: record.baselineKey,
    domain: record.domain,
    value: record.value,
    sourceKind: record.sourceKind,
    sourceUserId: record.sourceUserId,
    confirmedByStaffProfileId: record.confirmedByStaffProfileId,
    inferenceMethod: record.inferenceMethod,
    confidence: record.confidence,
    observedAt: record.observedAt.toISOString(),
    validFrom: record.validFrom.toISOString(),
    supersededAt: record.supersededAt?.toISOString() ?? null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapConsent(record: Prisma.ConsentRecordGetPayload<Record<string, never>>): ConsentRecord {
  return {
    id: record.id,
    elderId: record.elderId,
    purpose: record.purpose,
    decision: record.decision,
    authority: record.authority,
    consentVersion: record.consentVersion,
    effectiveAt: record.effectiveAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
    supersededAt: record.supersededAt?.toISOString() ?? null,
    reasonCode: record.reasonCode,
    recordedByUserId: record.recordedByUserId,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapTimeline(record: Prisma.ElderTimelineEntryGetPayload<Record<string, never>>) {
  return {
    id: record.id,
    elderId: record.elderId,
    eventType: record.eventType,
    sourceResourceType: record.sourceResourceType,
    sourceResourceId: record.sourceResourceId,
    visibility: record.visibility,
    safeSummaryCode: record.safeSummaryCode,
    safeMetadata: safeMetadata(record.safeMetadata),
    occurredAt: record.occurredAt.toISOString(),
  };
}

function familyProjection(
  elder: ElderSummaryRecord,
  sharedFields: readonly FamilyShareableElderField[],
  baselines: readonly Prisma.PersonalBaselineGetPayload<Record<string, never>>[],
  consents: readonly Prisma.ConsentRecordGetPayload<Record<string, never>>[],
  timeline: readonly Prisma.ElderTimelineEntryGetPayload<Record<string, never>>[],
): FamilyElderSummary {
  const shared = new Set(sharedFields);
  return {
    id: elder.id,
    displayName: elder.displayName,
    ...(shared.has('PREFERRED_NAME') ? { preferredName: elder.preferredName } : {}),
    ...(shared.has('CURRENT_RESIDENCE')
      ? { currentResidence: elder.stays[0] === undefined ? null : mapResidence(elder.stays[0]) }
      : {}),
    ...(shared.has('CARE_LEVEL') ? { careLevel: mapCareLevelSummary(elder.currentCareLevel) } : {}),
    ...(shared.has('ACCESSIBILITY_SUMMARY') && elder.accessibilityProfile !== null
      ? {
          accessibilitySummary: {
            preferredTextScale: elder.accessibilityProfile.preferredTextScale,
            hearingSupport: elder.accessibilityProfile.hearingSupport,
            visionSupport: elder.accessibilityProfile.visionSupport,
            mobilitySupport: elder.accessibilityProfile.mobilitySupport,
          },
        }
      : {}),
    ...(shared.has('COMMUNICATION_PREFERENCE') && elder.communicationPreference !== null
      ? {
          communicationPreference: {
            preferredLanguage: elder.communicationPreference.preferredLanguage,
            speakingPace: elder.communicationPreference.speakingPace,
            repeatKeyInformation: elder.communicationPreference.repeatKeyInformation,
            preferredChannel: elder.communicationPreference.preferredChannel,
            quietHoursStart: timeOutput(elder.communicationPreference.quietHoursStart),
            quietHoursEnd: timeOutput(elder.communicationPreference.quietHoursEnd),
          },
        }
      : {}),
    ...(shared.has('PERSONAL_BASELINE_SUMMARY')
      ? { personalBaselineSummary: baselines.map((baseline) => baseline.value.slice(0, 240)) }
      : {}),
    ...(shared.has('CONSENT_SUMMARY')
      ? {
          consentSummary: consents.map((consent) => ({
            purpose: consent.purpose,
            active: consent.decision === 'GRANTED' &&
              (consent.expiresAt === null || consent.expiresAt > new Date()),
          })),
        }
      : {}),
    ...(shared.has('TIMELINE_SUMMARY')
      ? {
          timelineSummary: timeline.map((entry) => ({
            id: entry.id,
            eventType: entry.eventType,
            safeSummaryCode: entry.safeSummaryCode,
            occurredAt: entry.occurredAt.toISOString(),
          })),
        }
      : {}),
    sharedFields: [...sharedFields],
  };
}

interface SharingPreferenceCandidate {
  readonly field: FamilyShareableElderField;
  readonly allowed: boolean;
  readonly consentRecordId: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly version: number;
}

export function selectAllowedFieldsForCurrentGrant(
  preferences: readonly SharingPreferenceCandidate[],
  currentConsentRecordId: string,
  now: Date,
): FamilyShareableElderField[] {
  const latest = new Map<FamilyShareableElderField, SharingPreferenceCandidate>();
  for (const preference of preferences) {
    if (
      preference.consentRecordId !== currentConsentRecordId ||
      preference.validFrom > now ||
      (preference.validUntil !== null && preference.validUntil <= now)
    ) {
      continue;
    }
    const existing = latest.get(preference.field);
    if (existing === undefined || preference.version > existing.version) {
      latest.set(preference.field, preference);
    }
  }
  return [...latest.values()].filter((preference) => preference.allowed).map((preference) => preference.field);
}

export function createAdmissionNumber(
  recordNumber: string,
  elderId: string,
  admittedAt: Date,
): string {
  const suffix = createHash('sha256')
    .update(JSON.stringify(['admission-v1', elderId, admittedAt.toISOString()]))
    .digest('hex')
    .slice(0, 16);
  return `${recordNumber.slice(0, 47)}-${suffix}`;
}

function elderWhere(context: M02FacilityContext, query: EldersQuery): Prisma.ElderWhereInput {
  return {
    ...scope(context),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.careLevelId === undefined ? {} : { currentCareLevelId: query.careLevelId }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { displayName: { contains: query.search, mode: 'insensitive' } },
            { preferredName: { contains: query.search, mode: 'insensitive' } },
            { recordNumber: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
    ...(query.buildingId === undefined && query.floorId === undefined && query.zoneId === undefined &&
      query.roomId === undefined && query.bedId === undefined && query.stayStatus === undefined
      ? {}
      : {
          stays: {
            some: {
              status: query.stayStatus ?? 'ACTIVE',
              ...(query.bedId === undefined ? {} : { bedId: query.bedId }),
              ...(query.roomId === undefined && query.zoneId === undefined && query.floorId === undefined && query.buildingId === undefined
                ? {}
                : {
                    bed: {
                      room: {
                        ...(query.roomId === undefined ? {} : { id: query.roomId }),
                        ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
                        ...(query.floorId === undefined ? {} : { floorId: query.floorId }),
                        ...(query.buildingId === undefined ? {} : { floor: { buildingId: query.buildingId } }),
                      },
                    },
                  }),
            },
          },
        }),
  };
}

function elderOrder(query: EldersQuery): Prisma.ElderOrderByWithRelationInput {
  if (query.sort === 'careLevel') return { currentCareLevel: { rank: query.direction } };
  if (query.sort === 'admittedAt') return { displayName: 'asc' };
  return { [query.sort]: query.direction };
}

function sortByAdmission(
  records: ElderSummaryRecord[],
  direction: 'asc' | 'desc',
): ElderSummaryRecord[] {
  return records.sort((left, right) => {
    const leftTime = left.stays[0]?.admittedAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.stays[0]?.admittedAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const difference = leftTime - rightTime;
    return (difference === 0 ? left.displayName.localeCompare(right.displayName) : difference) *
      (direction === 'asc' ? 1 : -1);
  });
}

function activeContext(session: AuthenticatedSession, correlationId: string): M02FacilityContext {
  const facilityId = session.principal.activeContext.facilityId;
  if (facilityId === null) throw resourceNotFound();
  return {
    organizationId: session.principal.activeContext.organizationId,
    facilityId,
    correlationId,
  };
}

function scope(context: M02FacilityContext) {
  return { organizationId: context.organizationId, facilityId: context.facilityId };
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

function dateOnlyInput(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function dateOnlyOutput(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function timeInput(value: string | null): Date | null {
  return value === null ? null : new Date(`1970-01-01T${value}:00.000Z`);
}

function timeOutput(value: Date | null): string | null {
  return value?.toISOString().slice(11, 16) ?? null;
}

function assertNotFuture(value: Date, field: string, allowedClockSkewMs = 5 * 60 * 1000): void {
  if (value.getTime() > Date.now() + allowedClockSkewMs) {
    throw m02InvalidRequest(field, 'FUTURE_TIMESTAMP_NOT_SUPPORTED');
  }
}

function safeMetadata(value: Prisma.JsonValue): Record<string, string | number | boolean | null> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      result[key] = item as string | number | boolean | null;
    }
  }
  return result;
}

interface ChildFindFirstDelegate {
  findFirst(args: { where: Record<string, unknown>; select: { id: true } }): Promise<{ id: string } | null>;
}

async function assertChildExistsOrConflict(
  delegate: ChildFindFirstDelegate,
  context: M02FacilityContext,
  elderId: string,
  id: string,
): Promise<never> {
  const record = await delegate.findFirst({ where: { ...scope(context), elderId, id }, select: { id: true } });
  if (record === null) throw resourceNotFound();
  throw m02Conflict();
}

async function assertElderExistsOrConflict(
  tx: Prisma.TransactionClient,
  context: M02FacilityContext,
  elderId: string,
): Promise<never> {
  const record = await tx.elder.findFirst({ where: { ...scope(context), id: elderId }, select: { id: true } });
  if (record === null) throw resourceNotFound();
  throw m02Conflict();
}

async function assertRelationshipExistsOrConflict(
  tx: Prisma.TransactionClient,
  context: M02FacilityContext,
  elderId: string,
  id: string,
): Promise<never> {
  const record = await tx.familyRelationship.findFirst({
    where: { ...scope(context), elderId, id },
    select: { id: true },
  });
  if (record === null) throw resourceNotFound();
  throw m02Conflict();
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isOverlapError(error: unknown): boolean {
  if (isPrismaCode(error, 'P2004') || isPrismaCode(error, 'P2034')) return true;
  return error instanceof Error && /elder_stays_(?:bed|elder)_no_overlap|exclusion constraint/i.test(error.message);
}

function isResourceNotFound(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 404;
}
