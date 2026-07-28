import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { M04_PERMISSIONS } from '@eldercare/authz';
import type { ServiceConfig } from '@eldercare/config';
import type {
  CaregiverEmergency,
  ElderEmergencyStatus,
  EmergencyAcknowledgeRequest,
  EmergencyAssignRequest,
  EmergencyMilestoneRequest,
  EmergencyResolveRequest,
  EmergencyReviewRequest,
  ElderEmergencySignalRequest,
  FamilyEmergencyNotificationPreference,
  FamilyEmergencyPreferenceUpdateRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { buildM04EmergencyEventData } from '@eldercare/events';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { SERVICE_CONFIG } from '../tokens.js';
import {
  activeCaregiverDataScopeWhere,
  activeCaregiverRoleWhere,
  caregiverRoleHasCurrentScopeAccess,
  type CurrentCaregiverDataScope,
} from '../m03/caregiver-current-access.js';
import { activeElderRoleWhere } from '../m03/elder-current-access.js';
import {
  assertEmergencyCommandActor,
  assertEmergencyTransition,
  assertResponseMilestone,
} from './emergency-state-machine.js';
import { normalizeEmergencyResolutionChecklist } from './emergency-resolution-checklist.js';
import type { M04FacilityContext } from './m04-context.service.js';
import { m04BadRequest, m04Conflict } from './m04-errors.js';
import {
  EMERGENCY_DETAIL_INCLUDE,
  mapEmergencyDetail,
  mapEmergencyListItem,
  mapFamilyEmergencySummary,
  type EmergencyEventRecord,
} from './m04-mappers.js';
import {
  createM04FamilyProviderKey,
  M04MutationService,
  type M04MutationActor,
} from './m04-mutation.service.js';

const EMERGENCY_ELEVATION_TTL_MS = 15 * 60 * 1000;
const RESPONDER_ASSIGN_COMMAND_KIND = 'RESPONDER_ASSIGN';
const FAMILY_PREFERENCE_UPDATE_COMMAND_KIND =
  'FAMILY_NOTIFICATION_PREFERENCE_UPDATE';
const EMERGENCY_EVENT_RESOURCE_TYPE = 'EMERGENCY_EVENT';
const FAMILY_PREFERENCE_RESOURCE_TYPE =
  'FAMILY_EMERGENCY_NOTIFICATION_PREFERENCE';
const SERIALIZABLE_MAX_RETRIES = 3;
const SERIALIZABLE_RETRY_BASE_DELAY_MS = 10;

export interface EmergencyListQueryInput {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED';
  readonly elderId?: string;
  readonly sourceKind?: 'ELDER_BUTTON' | 'VOICE_RISK' | 'IOT_BUTTON' | 'STAFF_MANUAL';
  readonly locationState?: 'CURRENT' | 'STALE' | 'ROOM_FALLBACK' | 'UNKNOWN';
  readonly search?: string;
  readonly sortBy?: 'openedAt' | 'updatedAt' | 'status';
  readonly sortDirection?: 'asc' | 'desc';
}

export type EmergencySignalInput = ElderEmergencySignalRequest;

export interface AdminEmergencyCreateInput extends EmergencySignalInput {
  readonly elderId: string;
}

export type EmergencyResponderAssignInput = EmergencyAssignRequest;
export type EmergencyAcknowledgeInput = EmergencyAcknowledgeRequest;
export type EmergencyMilestoneInput = EmergencyMilestoneRequest;
export type EmergencyResolveInput = EmergencyResolveRequest;
export type EmergencyReviewInput = EmergencyReviewRequest;
export type FamilyEmergencyPreferenceInput =
  FamilyEmergencyPreferenceUpdateRequest;

interface CaregiverAuthorization {
  readonly staffProfileId: string;
  readonly shiftAssignmentId: string;
  readonly teamId: string;
  readonly responderId: string;
}

interface CaregiverIdentity {
  readonly staffProfileId: string;
  readonly roleScopes: readonly CurrentCaregiverDataScope[];
  readonly shiftAssignments: readonly {
    readonly id: string;
    readonly teamId: string | null;
  }[];
}

interface CommandReceiptIdentity {
  readonly commandKind:
    | typeof RESPONDER_ASSIGN_COMMAND_KIND
    | typeof FAMILY_PREFERENCE_UPDATE_COMMAND_KIND;
  readonly resourceType:
    | typeof EMERGENCY_EVENT_RESOURCE_TYPE
    | typeof FAMILY_PREFERENCE_RESOURCE_TYPE;
  readonly resourceId: string;
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

@Injectable()
export class EmergenciesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(M04MutationService) private readonly mutations: M04MutationService,
    @Inject(SERVICE_CONFIG) private readonly config: ServiceConfig,
  ) {}

  async listAdmin(
    context: M04FacilityContext,
    query: EmergencyListQueryInput,
    session: AuthenticatedSession,
  ) {
    const now = new Date();
    await this.assertCurrentAdminAccess(
      this.database.client,
      context,
      session,
      [M04_PERMISSIONS.EMERGENCY_READ],
    );
    const where: Prisma.EmergencyEventWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.elderId === undefined ? {} : { elderId: query.elderId }),
      ...(query.sourceKind === undefined
        ? {}
        : { sourceKind: query.sourceKind }),
      ...(query.locationState === undefined
        ? {}
        : emergencyLocationStateWhere(query.locationState, now)),
      ...(query.search === undefined
        ? {}
        : {
            OR: [
              {
                reasonCode: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                elder: {
                  displayName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                elder: {
                  preferredName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.emergencyEvent.count({ where }),
      this.database.client.emergencyEvent.findMany({
        where,
        include: EMERGENCY_DETAIL_INCLUDE,
        orderBy: emergencyOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: records.map((record) => mapEmergencyListItem(record, now)),
      pageInfo: pageInfo(query.page, query.pageSize, total),
    };
  }

  async getAdmin(
    context: M04FacilityContext,
    emergencyEventId: string,
    session: AuthenticatedSession,
  ) {
    await this.assertCurrentAdminAccess(
      this.database.client,
      context,
      session,
      [M04_PERMISSIONS.EMERGENCY_READ],
    );
    return mapEmergencyDetail(
      await this.findScoped(context, emergencyEventId),
    );
  }

  async createElderEmergency(
    context: M04FacilityContext,
    input: EmergencySignalInput,
    session: AuthenticatedSession,
  ) {
    const result = await this.createUserEmergency(
      context,
      input,
      session,
      'ELDER_BUTTON',
      undefined,
    );
    return elderEmergencyProjection(
      result,
      this.config.emergencyFallbackPhone,
    );
  }

  async createAdminEmergency(
    context: M04FacilityContext,
    input: AdminEmergencyCreateInput,
    session: AuthenticatedSession,
  ) {
    await this.assertCurrentAdminAccess(
      this.database.client,
      context,
      session,
      [M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE],
    );
    return mapEmergencyDetail(
      await this.createUserEmergency(
        context,
        input,
        session,
        'STAFF_MANUAL',
        input.elderId,
      ),
    );
  }

  async getElderEmergency(
    context: M04FacilityContext,
    emergencyEventId: string,
    session: AuthenticatedSession,
  ) {
    const record = await this.database.client.emergencyEvent.findFirst({
      where: {
        id: emergencyEventId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elder: {
          portalUserId: session.userId,
          status: 'ACTIVE',
        },
      },
      include: EMERGENCY_DETAIL_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    await this.assertElderOwnedAccess(
      this.database.client,
      context,
      record.elderId,
      session,
      M04_PERMISSIONS.EMERGENCY_READ,
    );
    return elderEmergencyProjection(
      record,
      this.config.emergencyFallbackPhone,
    );
  }

  async assignResponder(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyResponderAssignInput,
    session: AuthenticatedSession,
  ) {
    const receiptIdentity = commandReceiptIdentity(
      RESPONDER_ASSIGN_COMMAND_KIND,
      EMERGENCY_EVENT_RESOURCE_TYPE,
      emergencyEventId,
      session.userId,
      input.idempotencyKey,
      {
        staffProfileId: input.staffProfileId,
        shiftAssignmentId: input.shiftAssignmentId,
        expectedVersion: input.expectedVersion,
        reasonCode: input.reasonCode,
        emergencyElevationReasonCode:
          input.emergencyElevationReasonCode ?? null,
      },
    );
    const resultVersion = await this.serializable(async (tx) => {
      const current = await this.findScopedInTransaction(
        tx,
        context,
        emergencyEventId,
      );
      await this.assertCurrentAdminAccess(tx, context, session, [
        M04_PERMISSIONS.EMERGENCY_ASSIGN,
      ]);
      const receipt = await findCommandReceipt(
        tx,
        context,
        receiptIdentity,
      );
      if (receipt !== null) {
        assertCommandReceiptMatches(receipt, context, receiptIdentity);
        return receipt.resultVersion;
      }
      if (['RESOLVED', 'REVIEWED'].includes(current.status)) {
        throw m04Conflict('EMERGENCY_ASSIGNMENT_CLOSED');
      }
      this.assertVersion(current.version, input.expectedVersion);

      const assignment = await this.resolveResponderAssignment(
        tx,
        context,
        current.elderId,
        input,
      );
      const changed = await tx.emergencyEvent.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          version: input.expectedVersion,
          status: current.status,
        },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
      }
      const nextVersion = input.expectedVersion + 1;
      const assignedAt = new Date();
      const isEmergencyElevation =
        input.emergencyElevationReasonCode !== undefined;

      await tx.emergencyResponder.updateMany({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          staffProfileId: { not: input.staffProfileId },
          status: { in: ['OFFERED', 'ASSIGNED', 'ACKNOWLEDGED'] },
        },
        data: {
          status: 'RELEASED',
          releasedAt: assignedAt,
        },
      });
      await tx.emergencyResponder.upsert({
        where: {
          emergencyEventId_staffProfileId: {
            emergencyEventId: current.id,
            staffProfileId: input.staffProfileId,
          },
        },
        create: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          staffProfileId: input.staffProfileId,
          shiftAssignmentId: input.shiftAssignmentId,
          teamId: assignment.teamId,
          status: 'ASSIGNED',
          assignedByUserId: session.userId,
          assignedAt,
          reasonCode: input.reasonCode,
          isEmergencyElevation,
          elevationReasonCode:
            input.emergencyElevationReasonCode,
          elevationExpiresAt: assignment.elevationExpiresAt,
        },
        update: {
          shiftAssignmentId: input.shiftAssignmentId,
          teamId: assignment.teamId,
          status: 'ASSIGNED',
          assignedByUserId: session.userId,
          assignedAt,
          acknowledgedAt: null,
          releasedAt: null,
          reasonCode: input.reasonCode,
          isEmergencyElevation,
          elevationReasonCode:
            input.emergencyElevationReasonCode ?? null,
          elevationExpiresAt: assignment.elevationExpiresAt,
        },
      });
      await tx.emergencyResponderAssignment.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          staffProfileId: input.staffProfileId,
          shiftAssignmentId: input.shiftAssignmentId,
          teamId: assignment.teamId,
          assignedByUserId: session.userId,
          fromVersion: input.expectedVersion,
          toVersion: nextVersion,
          assignedAt,
          reasonCode: input.reasonCode,
          isEmergencyElevation,
          elevationReasonCode:
            input.emergencyElevationReasonCode ?? null,
          elevationExpiresAt: assignment.elevationExpiresAt,
          correlationId: context.correlationId,
        },
      });

      await this.mutations.auditOnly(
        tx,
        context,
        userActor(session),
        {
          action: 'EMERGENCY.RESPONDER_ASSIGN',
          aggregateType: 'EMERGENCY_EVENT',
          aggregateId: current.id,
          aggregateVersion: nextVersion,
          resourceType: 'EMERGENCY_EVENT',
          reasonCode: input.reasonCode,
          timelineEventType: 'EMERGENCY_RESPONDER_ASSIGNED',
          payload: {
            emergencyEventId: current.id,
            staffProfileId: input.staffProfileId,
            status: current.status,
            version: nextVersion,
          },
          elderTimeline: {
            elderId: current.elderId,
            visibility: 'INTERNAL',
            safeSummaryCode: 'EMERGENCY_RESPONDER_ASSIGNED',
            safeMetadata: { emergencyEventId: current.id },
          },
        },
      );
      await createCommandReceipt(
        tx,
        context,
        receiptIdentity,
        nextVersion,
      );
      return nextVersion;
    });
    const projection = await this.getAdmin(
      context,
      emergencyEventId,
      session,
    );
    if (projection.version < resultVersion) {
      throw new Error('Responder assignment receipt result is unavailable');
    }
    return projection;
  }

  async listCaregiver(
    context: M04FacilityContext,
    session: AuthenticatedSession,
  ) {
    const caregiver = await this.activeCaregiver(
      this.database.client,
      context,
      session,
      M04_PERMISSIONS.EMERGENCY_READ,
    );
    const shiftIds = caregiver.shiftAssignments.map((item) => item.id);
    const records = await this.database.client.emergencyEvent.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'RESPONDING'] },
        responders: {
          some: {
            staffProfileId: caregiver.staffProfileId,
            shiftAssignmentId: { in: shiftIds },
            status: { in: ['OFFERED', 'ASSIGNED', 'ACKNOWLEDGED'] },
          },
        },
      },
      include: EMERGENCY_DETAIL_INCLUDE,
      orderBy: [
        { currentDeadlineAt: { sort: 'asc', nulls: 'last' } },
        { openedAt: 'asc' },
      ],
    });
    return {
      items: records.map(caregiverEmergencyProjection),
      pageInfo: pageInfo(1, Math.max(records.length, 1), records.length),
    };
  }

  async getCaregiver(
    context: M04FacilityContext,
    emergencyEventId: string,
    session: AuthenticatedSession,
  ) {
    await this.assertCaregiverResponderAccess(
      this.database.client,
      context,
      emergencyEventId,
      session,
      M04_PERMISSIONS.EMERGENCY_READ,
    );
    return caregiverEmergencyProjection(
      await this.findScoped(context, emergencyEventId),
    );
  }

  async acknowledge(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyAcknowledgeInput,
    session: AuthenticatedSession,
  ) {
    assertEmergencyCommandActor('ACKNOWLEDGE', 'USER');
    const requestFingerprint = emergencyCommandFingerprint(
      'ACKNOWLEDGE',
      emergencyEventId,
      session.userId,
      input,
    );
    await this.serializable(async (tx) => {
      const current = await this.findScopedInTransaction(
        tx,
        context,
        emergencyEventId,
      );
      const access = await this.assertCaregiverResponderAccess(
        tx,
        context,
        current.id,
        session,
        M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE,
      );
      if (
        await this.isCommandReplay(
          tx,
          context,
          current.id,
          session,
          'EMERGENCY.ACKNOWLEDGED',
          input.idempotencyKey,
          requestFingerprint,
        )
      ) {
        return;
      }
      assertEmergencyTransition(current.status, 'ACKNOWLEDGED');
      this.assertVersion(current.version, input.expectedVersion);
      const now = new Date();
      const clientObservedAt = validateClientObservedAt(
        input.clientObservedAt,
        now,
      );
      const changed = await tx.emergencyEvent.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'OPEN',
          version: input.expectedVersion,
          acknowledgement: null,
        },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: now,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw m04Conflict('EMERGENCY_ALREADY_ACKNOWLEDGED');
      }
      const nextVersion = input.expectedVersion + 1;
      await tx.emergencyAcknowledgement.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          staffProfileId: access.staffProfileId,
          shiftAssignmentId: access.shiftAssignmentId,
          actorUserId: session.userId,
          clientObservedAt,
          acknowledgedAt: now,
          correlationId: context.correlationId,
        },
      });
      await tx.emergencyResponder.update({
        where: { id: access.responderId },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: now },
      });
      await this.createTransition(
        tx,
        context,
        current,
        'ACKNOWLEDGED',
        input.expectedVersion,
        nextVersion,
        userActor(session),
        input.reasonCode,
        now,
      );
      await this.cancelEscalations(
        tx,
        current.id,
        'ACKNOWLEDGEMENT',
        now,
      );
      await this.refreshDeadline(tx, current.id);
      await this.mutations.record(
        tx,
        context,
        userActor(session),
        emergencyMutation(
          current,
          'EMERGENCY.ACKNOWLEDGED',
          'EMERGENCY.ACKNOWLEDGED',
          nextVersion,
          'ACKNOWLEDGED',
          input.reasonCode,
          {
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
          },
        ),
        now,
      );
    });
    return this.getCaregiver(context, emergencyEventId, session);
  }

  async markEnRoute(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyMilestoneInput,
    session: AuthenticatedSession,
  ) {
    return this.recordMilestone(
      context,
      emergencyEventId,
      input,
      session,
      'EN_ROUTE',
    );
  }

  async markOnSite(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyMilestoneInput,
    session: AuthenticatedSession,
  ) {
    return this.recordMilestone(
      context,
      emergencyEventId,
      input,
      session,
      'ON_SITE',
    );
  }

  async resolveCaregiver(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyResolveInput,
    session: AuthenticatedSession,
  ) {
    return this.resolve(
      context,
      emergencyEventId,
      input,
      session,
      'CAREGIVER',
    );
  }

  async resolveAdmin(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyResolveInput,
    session: AuthenticatedSession,
  ) {
    return this.resolve(
      context,
      emergencyEventId,
      input,
      session,
      'ADMIN',
    );
  }

  async review(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyReviewInput,
    session: AuthenticatedSession,
  ) {
    assertEmergencyCommandActor('REVIEW', 'USER');
    validateReview(input);
    const reasonCode = reviewReasonCode(input);
    const requestFingerprint = emergencyCommandFingerprint(
      'REVIEW',
      emergencyEventId,
      session.userId,
      input,
    );
    await this.serializable(async (tx) => {
      const current = await this.findScopedInTransaction(
        tx,
        context,
        emergencyEventId,
      );
      await this.assertCurrentAdminAccess(tx, context, session, [
        M04_PERMISSIONS.EMERGENCY_REVIEW,
      ]);
      if (
        await this.isCommandReplay(
          tx,
          context,
          current.id,
          session,
          'EMERGENCY.REVIEWED',
          input.idempotencyKey,
          requestFingerprint,
        )
      ) {
        return;
      }
      assertEmergencyTransition(current.status, 'REVIEWED');
      this.assertVersion(current.version, input.expectedVersion);
      if (current.resolution === null) {
        throw m04Conflict('EMERGENCY_RESOLUTION_REQUIRED');
      }
      const now = new Date();
      const changed = await tx.emergencyEvent.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'RESOLVED',
          version: input.expectedVersion,
          review: null,
        },
        data: {
          status: 'REVIEWED',
          reviewedAt: now,
          currentDeadlineAt: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
      }
      const nextVersion = input.expectedVersion + 1;
      await tx.emergencyReview.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          reviewedByUserId: session.userId,
          kind: input.kind,
          summary: input.summary ?? null,
          waiverReasonCode: input.waiverReasonCode ?? null,
          reviewedAt: now,
          correlationId: context.correlationId,
        },
      });
      await this.createTransition(
        tx,
        context,
        current,
        'REVIEWED',
        input.expectedVersion,
        nextVersion,
        userActor(session),
        reasonCode,
        now,
      );
      await this.publishFamilyStage(
        tx,
        context,
        current,
        'REVIEWED',
        false,
        now,
      );
      await this.mutations.record(
        tx,
        context,
        userActor(session),
        emergencyMutation(
          current,
          'EMERGENCY.REVIEW',
          'EMERGENCY.REVIEWED',
          nextVersion,
          'REVIEWED',
          reasonCode,
          {
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
          },
        ),
        now,
      );
    });
    return this.getAdmin(context, emergencyEventId, session);
  }

  async listFamily(
    context: M04FacilityContext,
    query: Pick<EmergencyListQueryInput, 'page' | 'pageSize' | 'elderId'>,
    session: AuthenticatedSession,
  ) {
    const now = new Date();
    const scopedElderIds = await this.currentFamilyElderIds(
      this.database.client,
      context,
      session,
      M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ,
      now,
    );
    const visibleElderIds =
      query.elderId === undefined
        ? scopedElderIds
        : scopedElderIds.includes(query.elderId)
          ? [query.elderId]
          : [];
    if (visibleElderIds.length === 0) throw resourceNotFound();
    const where: Prisma.EmergencyFamilySummaryWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      elderId: { in: visibleElderIds },
      elder: {
        familyRelationships: {
          some: familyRelationshipWhere(context, session.userId, now),
        },
      },
    };
    const [total, summaries] = await this.database.client.$transaction([
      this.database.client.emergencyFamilySummary.count({ where }),
      this.database.client.emergencyFamilySummary.findMany({
        where,
        include: {
          elder: {
            select: {
              displayName: true,
              preferredName: true,
            },
          },
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: summaries.map((summary) =>
        mapFamilyEmergencySummary(
          summary,
          summary.elder.preferredName ?? summary.elder.displayName,
        ),
      ),
      pageInfo: pageInfo(query.page, query.pageSize, total),
    };
  }

  async getFamilyPreference(
    context: M04FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
  ) {
    const relationship = await this.assertFamilyRelationship(
      this.database.client,
      context,
      elderId,
      session,
      M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE,
    );
    const preference =
      await this.database.client.familyEmergencyNotificationPreference.findFirst(
        {
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId,
            familyRelationshipId: relationship.id,
          },
        },
      );
    return mapFamilyPreference(elderId, preference);
  }

  async updateFamilyPreference(
    context: M04FacilityContext,
    elderId: string,
    input: FamilyEmergencyPreferenceInput,
    session: AuthenticatedSession,
  ) {
    const expectedVersion = input.expectedVersion ?? 0;
    const receiptIdentity = commandReceiptIdentity(
      FAMILY_PREFERENCE_UPDATE_COMMAND_KIND,
      FAMILY_PREFERENCE_RESOURCE_TYPE,
      elderId,
      session.userId,
      input.idempotencyKey,
      {
        expectedVersion,
        enabled: input.enabled,
        notifyOnOpened: input.notifyOnOpened,
        notifyOnResolved: input.notifyOnResolved,
        channel: input.channel,
      },
    );
    const result = await this.serializable(async (tx) => {
      const relationship = await this.assertFamilyRelationship(
        tx,
        context,
        elderId,
        session,
        M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE,
      );
      const receipt = await findCommandReceipt(
        tx,
        context,
        receiptIdentity,
      );
      const current =
        await tx.familyEmergencyNotificationPreference.findFirst({
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId,
            familyRelationshipId: relationship.id,
          },
        });
      if (receipt !== null) {
        assertCommandReceiptMatches(receipt, context, receiptIdentity);
        if (
          current === null ||
          current.version < receipt.resultVersion
        ) {
          throw new Error(
            'Family preference receipt result is unavailable',
          );
        }
        return current;
      }
      const version = current?.version ?? 0;
      if (version !== expectedVersion) {
        throw m04Conflict('EMERGENCY_PREFERENCE_VERSION_CONFLICT');
      }

      const preference =
        current === null
          ? await tx.familyEmergencyNotificationPreference.create({
              data: {
                organizationId: context.organizationId,
                facilityId: context.facilityId,
                elderId,
                familyRelationshipId: relationship.id,
                enabled: input.enabled,
                notifyOnOpened: input.notifyOnOpened,
                notifyOnResolved: input.notifyOnResolved,
                channel: input.channel,
                updatedByUserId: session.userId,
              },
            })
          : await this.updateFamilyPreferenceVersioned(
              tx,
              current.id,
              relationship.id,
              expectedVersion,
              input,
              session.userId,
            );
      await this.mutations.auditOnly(
        tx,
        context,
        userActor(session),
        {
          action: 'EMERGENCY.NOTIFICATION_PREFERENCE_UPDATE',
          aggregateType: 'FAMILY_EMERGENCY_NOTIFICATION_PREFERENCE',
          aggregateId: preference.id,
          aggregateVersion: preference.version,
          resourceType: 'FAMILY_EMERGENCY_NOTIFICATION_PREFERENCE',
          reasonCode: 'FAMILY_PREFERENCE_UPDATED',
          payload: {
            elderId,
            version: preference.version,
          },
        },
      );
      await createCommandReceipt(
        tx,
        context,
        receiptIdentity,
        preference.version,
      );
      return preference;
    });
    return mapFamilyPreference(elderId, result);
  }

  private async updateFamilyPreferenceVersioned(
    tx: Prisma.TransactionClient,
    preferenceId: string,
    familyRelationshipId: string,
    expectedVersion: number,
    input: FamilyEmergencyPreferenceInput,
    actorUserId: string,
  ) {
    const changed =
      await tx.familyEmergencyNotificationPreference.updateMany({
        where: {
          id: preferenceId,
          version: expectedVersion,
          familyRelationshipId,
        },
        data: {
          enabled: input.enabled,
          notifyOnOpened: input.notifyOnOpened,
          notifyOnResolved: input.notifyOnResolved,
          channel: input.channel,
          updatedByUserId: actorUserId,
          version: { increment: 1 },
        },
      });
    if (changed.count !== 1) {
      throw m04Conflict('EMERGENCY_PREFERENCE_VERSION_CONFLICT');
    }
    return tx.familyEmergencyNotificationPreference.findUniqueOrThrow({
      where: { id: preferenceId },
    });
  }

  private async createUserEmergency(
    context: M04FacilityContext,
    input: EmergencySignalInput,
    session: AuthenticatedSession,
    sourceKind: 'ELDER_BUTTON' | 'STAFF_MANUAL',
    requestedElderId: string | undefined,
  ): Promise<EmergencyEventRecord> {
    const sourceIdentityKey = `user:${session.userId}:${sourceKind}`;
    const actor = userActor(session);
    const observedAt =
      input.clientObservedAt === undefined
        ? null
        : new Date(input.clientObservedAt);
    const fingerprint = signalFingerprint(
      context,
      sourceKind,
      sourceIdentityKey,
      input,
      requestedElderId,
    );

    const createdId = await this.serializable(async (tx) => {
      const elderId =
        sourceKind === 'ELDER_BUTTON'
          ? await this.resolveOwnedElder(tx, context, session)
          : await this.resolveAdminElder(
              tx,
              context,
              requestedElderId,
              session,
            );
      const replay = await tx.emergencySignal.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          sourceIdentityKey,
          externalEventId: input.externalEventId,
        },
      });
      if (replay !== null) {
        if (
          replay.requestFingerprint !== fingerprint ||
          replay.sourceUserId !== session.userId ||
          replay.elderId !== elderId
        ) {
          throw m04Conflict('EMERGENCY_EVENT_ID_REUSED');
        }
        return replay.emergencyEventId;
      }

      const now = new Date();
      const policy = await tx.escalationPolicy.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'ACTIVE',
          effectiveAt: { lte: now },
        },
        include: {
          steps: {
            orderBy: [{ stage: 'asc' }, { sequence: 'asc' }],
          },
        },
        orderBy: [{ version: 'desc' }, { effectiveAt: 'desc' }],
      });
      if (policy === null || policy.steps.length === 0) {
        throw m04Conflict('EMERGENCY_ESCALATION_POLICY_REQUIRED');
      }

      const stay = await tx.elderStay.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          status: 'ACTIVE',
          admittedAt: { lte: now },
          OR: [{ dischargedAt: null }, { dischargedAt: { gt: now } }],
        },
        include: { bed: { include: { room: true } } },
        orderBy: { admittedAt: 'desc' },
      });
      const acknowledgementDueAt = earliestStageDueAt(
        policy.steps,
        'ACKNOWLEDGEMENT',
        now,
      );
      const event = await tx.emergencyEvent.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          sourceKind,
          reasonCode: input.reasonCode,
          escalationPolicyId: policy.id,
          escalationPolicyVersion: policy.version,
          openedAt: now,
          currentDeadlineAt: acknowledgementDueAt,
          correlationId: context.correlationId,
        },
      });
      await tx.emergencySignal.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          emergencyEventId: event.id,
          sourceUserId: session.userId,
          sourceKind,
          sourceIdentityKey,
          externalEventId: input.externalEventId,
          requestFingerprint: fingerprint,
          schemaVersion: '1.0',
          observedAt,
          reasonCode: input.reasonCode,
          correlationId: context.correlationId,
        },
      });
      await tx.emergencyLocationSnapshot.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          emergencyEventId: event.id,
          state: stay === null ? 'UNKNOWN' : 'ROOM_FALLBACK',
          source: stay === null ? 'NONE' : 'ACTIVE_STAY',
          floorId: stay?.bed.room.floorId ?? null,
          roomId: stay?.bed.roomId ?? null,
          observedAt: null,
          expiresAt: null,
          decidedAt: now,
          retentionUntil: new Date(
            now.getTime() +
              this.config.emergencyLocationRetentionHours * 60 * 60 * 1000,
          ),
          fallbackReasonCode:
            stay === null ? 'LOCATION_UNAVAILABLE' : 'REALTIME_LOCATION_UNAVAILABLE',
        },
      });
      await tx.emergencyTransition.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: event.id,
          fromStatus: null,
          toStatus: 'OPEN',
          fromVersion: 0,
          toVersion: 1,
          actorType: actor.type,
          actorUserId: session.userId,
          reasonCode: input.reasonCode,
          correlationId: context.correlationId,
          occurredAt: now,
        },
      });

      await tx.emergencyEscalation.createMany({
        data: policy.steps.map((step) => ({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: event.id,
          escalationStepId: step.id,
          stage: step.stage,
          dueAt: new Date(now.getTime() + step.thresholdSeconds * 1000),
          basisTransitionVersion: 1,
          idempotencyKey: escalationIdempotencyKey(
            event.id,
            step.id,
            step.stage,
            1,
          ),
          correlationId: context.correlationId,
        })),
      });

      const related = await tx.emergencyEvent.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          id: { not: event.id },
          openedAt: {
            gte: new Date(
              now.getTime() -
                this.config.emergencyDuplicateWindowSeconds * 1000,
            ),
            lte: now,
          },
        },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      });
      if (related !== null) {
        await tx.emergencyRelatedEvent.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            primaryEventId: related.id,
            relatedEventId: event.id,
            reasonCode: 'NEARBY_SIGNAL_RETAINED',
            correlationId: context.correlationId,
          },
        });
      }

      const eventForSummary = {
        ...event,
        elder: { id: elderId },
      };
      await this.publishFamilyStage(
        tx,
        context,
        eventForSummary,
        'OPENED',
        true,
        now,
      );
      await this.mutations.record(
        tx,
        context,
        actor,
        {
          action: 'EMERGENCY.OPEN',
          eventType: 'EMERGENCY.OPENED',
          aggregateType: 'EMERGENCY_EVENT',
          aggregateId: event.id,
          aggregateVersion: 1,
          resourceType: 'EMERGENCY_EVENT',
          reasonCode: input.reasonCode,
          idempotencyKey: `emergency-open:${fingerprint}`,
          privacyClass: 'HIGHLY_SENSITIVE',
          payload: {
            ...buildM04EmergencyEventData({
              emergencyId: event.id,
              elderId,
              status: 'OPEN',
              version: 1,
              reasonCode: input.reasonCode,
              requestFingerprint: fingerprint,
            }),
          },
          elderTimeline: {
            elderId,
            visibility: 'FAMILY_ELIGIBLE',
            safeSummaryCode: 'EMERGENCY_OPENED',
            safeMetadata: { emergencyEventId: event.id },
          },
        },
        now,
      );
      if (related !== null) {
        await this.mutations.record(
          tx,
          context,
          actor,
          {
            action: 'EMERGENCY.RELATED_DUPLICATE',
            eventType: 'EMERGENCY.RELATED_DUPLICATE',
            aggregateType: 'EMERGENCY_EVENT',
            aggregateId: event.id,
            aggregateVersion: 1,
            resourceType: 'EMERGENCY_EVENT',
            reasonCode: 'NEARBY_SIGNAL_RETAINED',
            idempotencyKey: `emergency-related:${related.id}:${event.id}`,
            payload: {
              ...buildM04EmergencyEventData({
                emergencyId: event.id,
                elderId,
                status: 'OPEN',
                version: 1,
                reasonCode: 'NEARBY_SIGNAL_RETAINED',
                relatedEmergencyId: related.id,
              }),
            },
          },
          now,
        );
      }
      return event.id;
    });

    return this.findScoped(context, createdId);
  }

  private async recordMilestone(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyMilestoneInput,
    session: AuthenticatedSession,
    kind: 'EN_ROUTE' | 'ON_SITE',
  ) {
    if (input.kind !== kind) {
      throw m04BadRequest(
        'EMERGENCY_MILESTONE_KIND_MISMATCH',
        '请求的响应里程碑与接口不一致',
      );
    }
    assertEmergencyCommandActor(
      kind === 'EN_ROUTE' ? 'MARK_EN_ROUTE' : 'MARK_ON_SITE',
      'USER',
    );
    const requestFingerprint = emergencyCommandFingerprint(
      kind,
      emergencyEventId,
      session.userId,
      input,
    );
    await this.serializable(async (tx) => {
      const current = await this.findScopedInTransaction(
        tx,
        context,
        emergencyEventId,
      );
      const access = await this.assertCaregiverResponderAccess(
        tx,
        context,
        current.id,
        session,
        M04_PERMISSIONS.EMERGENCY_RESPOND,
      );
      if (
        await this.isCommandReplay(
          tx,
          context,
          current.id,
          session,
          'EMERGENCY.RESPONDING',
          input.idempotencyKey,
          requestFingerprint,
        )
      ) {
        return;
      }
      const existingKinds = new Set(
        current.milestones.map((milestone) => milestone.kind),
      );
      const responderState =
        kind === 'EN_ROUTE'
          ? existingKinds.has('EN_ROUTE')
            ? 'EN_ROUTE'
            : 'ACKNOWLEDGED'
          : existingKinds.has('ON_SITE')
            ? 'ON_SITE'
            : existingKinds.has('EN_ROUTE')
              ? 'EN_ROUTE'
              : 'ACKNOWLEDGED';
      assertResponseMilestone(current.status, kind, responderState);
      this.assertVersion(current.version, input.expectedVersion);
      if (
        current.acknowledgement?.staffProfileId !== access.staffProfileId
      ) {
        throw resourceNotFound();
      }

      const now = new Date();
      const clientObservedAt = validateClientObservedAt(
        input.clientObservedAt,
        now,
      );
      const toStatus = kind === 'EN_ROUTE' ? 'RESPONDING' : current.status;
      if (kind === 'EN_ROUTE') {
        assertEmergencyTransition(current.status, 'RESPONDING');
      }
      const changed = await tx.emergencyEvent.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          version: input.expectedVersion,
          status: current.status,
          ...(kind === 'ON_SITE' ? { onSiteAt: null } : {}),
        },
        data: {
          status: toStatus,
          ...(kind === 'EN_ROUTE' ? { respondingAt: now } : { onSiteAt: now }),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
      }
      const nextVersion = input.expectedVersion + 1;
      await tx.emergencyResponseMilestone.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          kind,
          staffProfileId: access.staffProfileId,
          actorUserId: session.userId,
          fromVersion: input.expectedVersion,
          toVersion: nextVersion,
          clientObservedAt,
          occurredAt: now,
          reasonCode: input.reasonCode,
          correlationId: context.correlationId,
        },
      });
      if (kind === 'EN_ROUTE') {
        await this.createTransition(
          tx,
          context,
          current,
          'RESPONDING',
          input.expectedVersion,
          nextVersion,
          userActor(session),
          input.reasonCode,
          now,
        );
        await this.publishFamilyStage(
          tx,
          context,
          current,
          'RESPONDING',
          false,
          now,
        );
      } else {
        await this.cancelEscalations(tx, current.id, 'ARRIVAL', now);
        await this.refreshDeadline(tx, current.id);
      }
      await this.mutations.record(
        tx,
        context,
        userActor(session),
        {
          ...emergencyMutation(
            current,
            kind === 'EN_ROUTE'
              ? 'EMERGENCY.MARK_EN_ROUTE'
              : 'EMERGENCY.MARK_ON_SITE',
            'EMERGENCY.RESPONDING',
            nextVersion,
            toStatus,
            input.reasonCode,
            {
              idempotencyKey: input.idempotencyKey,
              requestFingerprint,
            },
          ),
        },
        now,
      );
    });
    return this.getCaregiver(context, emergencyEventId, session);
  }

  private async resolve(
    context: M04FacilityContext,
    emergencyEventId: string,
    input: EmergencyResolveInput,
    session: AuthenticatedSession,
    mode: 'CAREGIVER' | 'ADMIN',
  ) {
    assertEmergencyCommandActor('RESOLVE', 'USER');
    const completionChecklist = normalizeEmergencyResolutionChecklist(
      input.completionChecklist.map((item) => item.code),
    );
    const requestFingerprint = emergencyCommandFingerprint(
      'RESOLVE',
      emergencyEventId,
      session.userId,
      input,
    );
    await this.serializable(async (tx) => {
      const current = await this.findScopedInTransaction(
        tx,
        context,
        emergencyEventId,
      );
      let staffProfileId: string;
      if (mode === 'CAREGIVER') {
        const access = await this.assertCaregiverResponderAccess(
          tx,
          context,
          current.id,
          session,
          M04_PERMISSIONS.EMERGENCY_RESOLVE,
        );
        staffProfileId = access.staffProfileId;
        if (
          current.acknowledgement?.staffProfileId !== staffProfileId ||
          !current.milestones.some(
            (item) =>
              item.kind === 'ON_SITE' &&
              item.staffProfileId === staffProfileId,
          )
        ) {
          throw m04Conflict('EMERGENCY_ON_SITE_REQUIRED');
        }
      } else {
        await this.assertCurrentAdminAccess(tx, context, session, [
          M04_PERMISSIONS.EMERGENCY_RESOLVE,
        ]);
        const staff = await tx.staffProfile.findFirst({
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            userId: session.userId,
            status: 'ACTIVE',
            endedAt: null,
          },
          select: { id: true },
        });
        if (staff === null) throw resourceNotFound();
        staffProfileId = staff.id;
      }
      if (
        await this.isCommandReplay(
          tx,
          context,
          current.id,
          session,
          'EMERGENCY.RESOLVED',
          input.idempotencyKey,
          requestFingerprint,
        )
      ) {
        return;
      }
      assertEmergencyTransition(current.status, 'RESOLVED');
      this.assertVersion(current.version, input.expectedVersion);
      if (current.onSiteAt === null) {
        throw m04Conflict('EMERGENCY_ON_SITE_REQUIRED');
      }

      const now = new Date();
      const changed = await tx.emergencyEvent.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'RESPONDING',
          version: input.expectedVersion,
          resolution: null,
        },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          currentDeadlineAt: null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
      }
      const nextVersion = input.expectedVersion + 1;
      await tx.emergencyResolution.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: current.id,
          resolvedByUserId: session.userId,
          staffProfileId,
          summary: input.summary,
          outcomeCode: input.outcomeCode,
          familyNotify: input.familyNotify,
          completionChecklist: {
            schemaVersion: 1,
            expectedCodes: completionChecklist,
            confirmations: completionChecklist.map((code) => ({
              code,
              confirmed: true,
              confirmedAt: now.toISOString(),
            })),
          },
          resolvedAt: now,
          correlationId: context.correlationId,
        },
      });
      await this.createTransition(
        tx,
        context,
        current,
        'RESOLVED',
        input.expectedVersion,
        nextVersion,
        userActor(session),
        input.outcomeCode,
        now,
      );
      await this.cancelEscalations(tx, current.id, 'RESOLUTION', now);
      await this.publishFamilyStage(
        tx,
        context,
        current,
        'RESOLVED',
        input.familyNotify,
        now,
      );
      await this.mutations.record(
        tx,
        context,
        userActor(session),
        emergencyMutation(
          current,
          'EMERGENCY.RESOLVE',
          'EMERGENCY.RESOLVED',
          nextVersion,
          'RESOLVED',
          input.outcomeCode,
          {
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
          },
        ),
        now,
      );
    });
    return mode === 'CAREGIVER'
      ? this.getCaregiver(context, emergencyEventId, session)
      : this.getAdmin(context, emergencyEventId, session);
  }

  private async resolveOwnedElder(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    session: AuthenticatedSession,
  ): Promise<string> {
    const elder = await tx.elder.findFirst({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        portalUserId: session.userId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (elder === null) throw resourceNotFound();
    await this.assertElderOwnedAccess(
      tx,
      context,
      elder.id,
      session,
      M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE,
    );
    return elder.id;
  }

  private async resolveAdminElder(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    elderId: string | undefined,
    session: AuthenticatedSession,
  ): Promise<string> {
    if (elderId === undefined) throw resourceNotFound();
    await this.assertCurrentAdminAccess(tx, context, session, [
      M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE,
    ]);
    const elder = await tx.elder.findFirst({
      where: {
        id: elderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (elder === null) throw resourceNotFound();
    return elder.id;
  }

  private async resolveResponderAssignment(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    elderId: string,
    input: EmergencyResponderAssignInput,
  ): Promise<{ teamId: string; elevationExpiresAt: Date | null }> {
    const now = new Date();
    const elevationExpiresAt =
      input.emergencyElevationReasonCode === undefined
        ? null
        : new Date(now.getTime() + EMERGENCY_ELEVATION_TTL_MS);
    const assignment = await tx.shiftAssignment.findFirst({
      where: {
        id: input.shiftAssignmentId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        staffProfileId: input.staffProfileId,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        staffProfile: {
          status: 'ACTIVE',
          endedAt: null,
        },
        shift: {
          startsAt: { lte: now },
          endsAt: { gt: now },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          teamId: { not: null },
        },
      },
      include: {
        shift: { select: { teamId: true } },
        scopes: true,
        elderAssignments: { where: { elderId }, select: { elderId: true } },
      },
    });
    const teamId = assignment?.shift.teamId;
    if (assignment === null || teamId === null || teamId === undefined) {
      throw resourceNotFound();
    }
    if (input.emergencyElevationReasonCode === undefined) {
      const stay = await tx.elderStay.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          status: 'ACTIVE',
        },
        include: { bed: { include: { room: true } } },
        orderBy: { admittedAt: 'desc' },
      });
      if (
        stay === null ||
        !shiftAssignmentCovers(
          assignment,
          stay.bed.room.floorId,
          stay.bed.room.zoneId,
        )
      ) {
        throw resourceNotFound();
      }
    }
    return { teamId, elevationExpiresAt };
  }

  private async assertCaregiverResponderAccess(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    emergencyEventId: string,
    session: AuthenticatedSession,
    requiredPermission: string,
  ): Promise<CaregiverAuthorization> {
    const caregiver = await this.activeCaregiver(
      client,
      context,
      session,
      requiredPermission,
    );
    const shiftIds = caregiver.shiftAssignments.map((item) => item.id);
    const responder = await client.emergencyResponder.findFirst({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        emergencyEventId,
        staffProfileId: caregiver.staffProfileId,
        shiftAssignmentId: { in: shiftIds },
        status: { in: ['OFFERED', 'ASSIGNED', 'ACKNOWLEDGED'] },
      },
      include: {
        emergencyEvent: {
          select: {
            elderId: true,
            elder: {
              select: {
                stays: {
                  where: { status: 'ACTIVE' },
                  orderBy: { admittedAt: 'desc' },
                  take: 1,
                  select: {
                    bed: {
                      select: {
                        room: {
                          select: { floorId: true, zoneId: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        shiftAssignment: {
          include: {
            shift: { select: { teamId: true } },
            scopes: true,
            elderAssignments: true,
          },
        },
      },
    });
    const stay = responder?.emergencyEvent.elder.stays[0];
    const candidateTeamId = responder?.shiftAssignment.shift.teamId;
    const roleHasAccess =
      responder !== null &&
      stay !== undefined &&
      candidateTeamId !== null &&
      candidateTeamId !== undefined &&
      caregiverRoleHasCurrentScopeAccess(caregiver.roleScopes, {
        shiftAssignmentId: responder.shiftAssignmentId,
        elderId: responder.emergencyEvent.elderId,
        floorId: stay.bed.room.floorId,
        teamId: candidateTeamId,
      });
    const activeElevation =
      responder !== null &&
      responder.isEmergencyElevation &&
      responder.elevationReasonCode !== null &&
      responder.elevationExpiresAt !== null &&
      responder.elevationExpiresAt.getTime() > Date.now() &&
      caregiver.roleScopes.some(
        (scope) =>
          scope.kind === 'ACTIVE_SHIFT' &&
          (scope.resourceId === responder.shiftAssignmentId ||
            scope.scopeKey.endsWith(responder.shiftAssignmentId)),
      );
    if (
      responder === null ||
      stay === undefined ||
      candidateTeamId === null ||
      candidateTeamId === undefined ||
      (!roleHasAccess && !activeElevation) ||
      (!activeElevation &&
        !shiftAssignmentCovers(
          responder.shiftAssignment,
          stay.bed.room.floorId,
          stay.bed.room.zoneId,
        ))
    ) {
      throw resourceNotFound();
    }
    const teamId = candidateTeamId;
    return {
      staffProfileId: responder.staffProfileId,
      shiftAssignmentId: responder.shiftAssignmentId,
      teamId,
      responderId: responder.id,
    };
  }

  private async activeCaregiver(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    session: AuthenticatedSession,
    requiredPermission: string,
  ): Promise<CaregiverIdentity> {
    const now = new Date();
    const [staff, role] = await Promise.all([
      client.staffProfile.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          userId: session.userId,
          status: 'ACTIVE',
          endedAt: null,
        },
        select: { id: true },
      }),
      client.userRole.findFirst({
        where: activeCaregiverRoleWhere(
          context,
          session.userId,
          now,
          requiredPermission,
        ),
        select: {
          id: true,
          dataScopes: {
            where: activeCaregiverDataScopeWhere(context, now),
            select: {
              kind: true,
              scopeKey: true,
              resourceType: true,
              resourceId: true,
            },
          },
        },
      }),
    ]);
    if (staff === null || role === null) throw resourceNotFound();
    const shifts = await client.shiftAssignment.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        staffProfileId: staff.id,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: {
          startsAt: { lte: now },
          endsAt: { gt: now },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      },
      select: { id: true, shift: { select: { teamId: true } } },
    });
    if (shifts.length === 0) throw resourceNotFound();
    return {
      staffProfileId: staff.id,
      roleScopes: role.dataScopes,
      shiftAssignments: shifts.map((item) => ({
        id: item.id,
        teamId: item.shift.teamId,
      })),
    };
  }

  private async assertCurrentAdminAccess(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    session: AuthenticatedSession,
    permissions: readonly string[],
  ): Promise<void> {
    const now = new Date();
    const [facility, role] = await Promise.all([
      client.facility.findFirst({
        where: {
          id: context.facilityId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
      client.userRole.findFirst({
        where: {
          userId: session.userId,
          user: { status: 'ACTIVE' },
          organization: { status: 'ACTIVE' },
          activeFrom: { lte: now },
          revokedAt: null,
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            ...permissions.map((permission) => ({
              role: {
                rolePermissions: {
                  some: { permission: { code: permission } },
                },
              },
            })),
            {
              dataScopes: {
                some: {
                  validFrom: { lte: now },
                  AND: [
                    {
                      OR: [
                        { validUntil: null },
                        { validUntil: { gt: now } },
                      ],
                    },
                    {
                      OR: [
                        { kind: 'PLATFORM' },
                        {
                          kind: 'ORGANIZATION',
                          organizationId: context.organizationId,
                        },
                        {
                          kind: 'FACILITY',
                          organizationId: context.organizationId,
                          facilityId: context.facilityId,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (facility === null || role === null) throw resourceNotFound();
  }

  private async assertElderOwnedAccess(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
    permission: string,
  ): Promise<void> {
    const now = new Date();
    const [elder, role] = await Promise.all([
      client.elder.findFirst({
        where: {
          id: elderId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          portalUserId: session.userId,
          status: 'ACTIVE',
          stays: {
            some: {
              status: 'ACTIVE',
              admittedAt: { lte: now },
              OR: [{ dischargedAt: null }, { dischargedAt: { gt: now } }],
            },
          },
        },
        select: { id: true },
      }),
      client.userRole.findFirst({
        where: activeElderRoleWhere(
          context,
          session.userId,
          now,
          permission,
        ),
        select: { id: true },
      }),
    ]);
    if (elder === null || role === null) throw resourceNotFound();
  }

  private async currentFamilyElderIds(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    session: AuthenticatedSession,
    permission: string,
    now: Date = new Date(),
  ): Promise<string[]> {
    const role = await client.userRole.findFirst({
      where: {
        userId: session.userId,
        organizationId: context.organizationId,
        user: { status: 'ACTIVE' },
        organization: { status: 'ACTIVE' },
        activeFrom: { lte: now },
        revokedAt: null,
        role: {
          code: 'FAMILY',
          rolePermissions: {
            some: { permission: { code: permission } },
          },
        },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            dataScopes: {
              some: {
                kind: 'LINKED_ELDER',
                organizationId: context.organizationId,
                facilityId: context.facilityId,
                resourceType: 'ELDER',
                resourceId: { not: null },
                validFrom: { lte: now },
                AND: [
                  {
                    OR: [
                      { validUntil: null },
                      { validUntil: { gt: now } },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
      select: {
        dataScopes: {
          where: {
            kind: 'LINKED_ELDER',
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            resourceType: 'ELDER',
            resourceId: { not: null },
            validFrom: { lte: now },
            AND: [
              {
                OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              },
            ],
          },
          select: { resourceId: true },
        },
      },
    });
    if (role === null) throw resourceNotFound();
    const elderIds = role.dataScopes
      .map((scope) => scope.resourceId)
      .filter((elderId): elderId is string => elderId !== null);
    if (elderIds.length === 0) throw resourceNotFound();
    return [...new Set(elderIds)];
  }

  private async assertFamilyRelationship(
    client: Prisma.TransactionClient | typeof this.database.client,
    context: M04FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
    permission: string,
  ) {
    const now = new Date();
    const [relationship, role] = await Promise.all([
      client.familyRelationship.findFirst({
        where: {
          elderId,
          ...familyRelationshipWhere(context, session.userId, now),
        },
        select: { id: true },
      }),
      client.userRole.findFirst({
        where: {
          userId: session.userId,
          organizationId: context.organizationId,
          activeFrom: { lte: now },
          revokedAt: null,
          role: {
            code: 'FAMILY',
            rolePermissions: {
              some: { permission: { code: permission } },
            },
          },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            {
              dataScopes: {
                some: {
                  kind: 'LINKED_ELDER',
                  organizationId: context.organizationId,
                  facilityId: context.facilityId,
                  resourceType: 'ELDER',
                  resourceId: elderId,
                  validFrom: { lte: now },
                  AND: [
                    {
                      OR: [
                        { validUntil: null },
                        { validUntil: { gt: now } },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (relationship === null || role === null) throw resourceNotFound();
    return relationship;
  }

  private async createTransition(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    current: Pick<EmergencyEventRecord, 'id' | 'status'>,
    toStatus: 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED',
    fromVersion: number,
    toVersion: number,
    actor: M04MutationActor,
    reasonCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await tx.emergencyTransition.create({
      data: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        emergencyEventId: current.id,
        fromStatus: current.status,
        toStatus,
        fromVersion,
        toVersion,
        actorType: actor.type,
        actorUserId: actor.userId ?? null,
        actorExternalId: actor.userId === undefined ? actor.id : null,
        reasonCode,
        correlationId: context.correlationId,
        occurredAt,
      },
    });
  }

  private async cancelEscalations(
    tx: Prisma.TransactionClient,
    emergencyEventId: string,
    stage: 'ACKNOWLEDGEMENT' | 'ARRIVAL' | 'RESOLUTION',
    now: Date,
  ): Promise<void> {
    await tx.emergencyEscalation.updateMany({
      where: {
        emergencyEventId,
        stage,
        status: { in: ['SCHEDULED', 'FAILED'] },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        lastErrorCode: null,
      },
    });
  }

  private async refreshDeadline(
    tx: Prisma.TransactionClient,
    emergencyEventId: string,
  ): Promise<void> {
    const next = await tx.emergencyEscalation.findFirst({
      where: { emergencyEventId, status: 'SCHEDULED' },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { dueAt: true },
    });
    await tx.emergencyEvent.update({
      where: { id: emergencyEventId },
      data: { currentDeadlineAt: next?.dueAt ?? null },
    });
  }

  private async publishFamilyStage(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    event: Pick<EmergencyEventRecord, 'id' | 'elderId'> | {
      readonly id: string;
      readonly elderId: string;
    },
    stage:
      | 'OPENED'
      | 'ACKNOWLEDGED'
      | 'RESPONDING'
      | 'RESOLVED'
      | 'REVIEWED',
    requestDelivery: boolean,
    now: Date,
  ): Promise<void> {
    const copy = familyStageCopy(stage);
    await tx.emergencyFamilySummary.upsert({
      where: {
        emergencyEventId_stage: {
          emergencyEventId: event.id,
          stage,
        },
      },
      create: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: event.elderId,
        emergencyEventId: event.id,
        stage,
        title: copy.title,
        summary: copy.summary,
        publishedAt: now,
        correlationId: context.correlationId,
      },
      update: {},
    });
    if (!requestDelivery || !['OPENED', 'RESOLVED'].includes(stage)) return;

    const relationships = await tx.familyRelationship.findMany({
      where: familyRelationshipWhere(context, undefined, now, event.elderId),
      include: { emergencyNotificationPreference: true },
    });
    for (const relationship of relationships) {
      const preference = relationship.emergencyNotificationPreference;
      const enabled = preference?.enabled ?? true;
      const stageEnabled =
        stage === 'OPENED'
          ? preference?.notifyOnOpened ?? false
          : preference?.notifyOnResolved ?? true;
      if (!enabled || !stageEnabled) continue;
      const channel = preference?.channel ?? 'IN_APP';
      const providerKey = createM04FamilyProviderKey(
        context.organizationId,
        event.id,
        relationship.id,
        stage,
        channel,
      );
      await tx.emergencyNotificationDelivery.upsert({
        where: {
          emergencyEventId_familyRelationshipId_stage_channel: {
            emergencyEventId: event.id,
            familyRelationshipId: relationship.id,
            stage,
            channel,
          },
        },
        create: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          emergencyEventId: event.id,
          familyRelationshipId: relationship.id,
          stage,
          channel,
          status: 'PENDING',
          providerKey,
          nextAttemptAt: now,
          correlationId: context.correlationId,
        },
        update: {},
      });
    }
  }

  private async isCommandReplay(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    emergencyEventId: string,
    session: AuthenticatedSession,
    eventType: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<boolean> {
    const existing = await tx.outboxEvent.findFirst({
      where: {
        organizationId: context.organizationId,
        eventType,
        idempotencyKey: commandOutboxKey(idempotencyKey),
      },
      select: {
        aggregateId: true,
        actorId: true,
        facilityId: true,
        payload: true,
      },
    });
    if (existing === null) return false;
    const payload = jsonRecord(existing.payload);
    if (
      existing.aggregateId !== emergencyEventId ||
      existing.actorId !== session.userId ||
      existing.facilityId !== context.facilityId ||
      payload['requestFingerprint'] !== requestFingerprint
    ) {
      throw m04Conflict('EMERGENCY_IDEMPOTENCY_KEY_REUSED');
    }
    return true;
  }

  private async findScoped(
    context: M04FacilityContext,
    emergencyEventId: string,
  ): Promise<EmergencyEventRecord> {
    const record = await this.database.client.emergencyEvent.findFirst({
      where: {
        id: emergencyEventId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
      },
      include: EMERGENCY_DETAIL_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    return record;
  }

  private async findScopedInTransaction(
    tx: Prisma.TransactionClient,
    context: M04FacilityContext,
    emergencyEventId: string,
  ): Promise<EmergencyEventRecord> {
    const record = await tx.emergencyEvent.findFirst({
      where: {
        id: emergencyEventId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
      },
      include: EMERGENCY_DETAIL_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    return record;
  }

  private assertVersion(current: number, expected: number): void {
    if (current !== expected) {
      throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
    }
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    retryCount = 0,
  ): Promise<T> {
    try {
      return await this.database.client.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (
        retryCount < SERIALIZABLE_MAX_RETRIES &&
        (isPrismaCode(error, 'P2034') || isPrismaCode(error, 'P2002'))
      ) {
        await new Promise((resolve) => {
          setTimeout(
            resolve,
            SERIALIZABLE_RETRY_BASE_DELAY_MS * 2 ** retryCount,
          );
        });
        return this.serializable(operation, retryCount + 1);
      }
      if (isPrismaCode(error, 'P2034')) {
        throw m04Conflict('EMERGENCY_VERSION_CONFLICT');
      }
      if (isPrismaCode(error, 'P2002')) {
        throw m04Conflict('EMERGENCY_CONCURRENT_COMMAND');
      }
      throw error;
    }
  }
}

function emergencyMutation(
  current: Pick<EmergencyEventRecord, 'id' | 'elderId'>,
  action: string,
  eventType: string,
  aggregateVersion: number,
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED',
  reasonCode: string,
  command?: {
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
  },
) {
  return {
    action,
    eventType,
    aggregateType: 'EMERGENCY_EVENT',
    aggregateId: current.id,
    aggregateVersion,
    resourceType: 'EMERGENCY_EVENT',
    reasonCode,
    ...(command === undefined
      ? {}
      : { idempotencyKey: commandOutboxKey(command.idempotencyKey) }),
    privacyClass: 'HIGHLY_SENSITIVE' as const,
    payload: {
      ...buildM04EmergencyEventData({
        emergencyId: current.id,
        elderId: current.elderId,
        status,
        version: aggregateVersion,
        reasonCode,
        ...(command === undefined
          ? {}
          : { requestFingerprint: command.requestFingerprint }),
      }),
    },
    elderTimeline: {
      elderId: current.elderId,
      visibility: 'FAMILY_ELIGIBLE' as const,
      safeSummaryCode: eventType.replace('.', '_'),
      safeMetadata: { emergencyEventId: current.id },
    },
  };
}

function caregiverEmergencyProjection(
  record: EmergencyEventRecord,
): CaregiverEmergency {
  const projection = mapEmergencyListItem(record);
  return {
    id: projection.id,
    elderId: projection.elderId,
    elder: projection.elder,
    sourceKind: projection.sourceKind,
    reasonCode: projection.reasonCode,
    status: projection.status,
    version: projection.version,
    openedAt: projection.openedAt,
    acknowledgedAt: projection.acknowledgedAt,
    respondingAt: projection.respondingAt,
    onSiteAt: projection.onSiteAt,
    resolvedAt: projection.resolvedAt,
    currentDeadlineAt: projection.currentDeadlineAt,
    location: projection.location,
    activeSla: projection.activeSla,
    escalationCount: projection.escalationCount,
    updatedAt: projection.updatedAt,
    assignedToMe: true,
    requiredResolutionChecklistCodes: [
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
    ],
  };
}

function elderEmergencyProjection(
  record: EmergencyEventRecord,
  fallbackPhoneNumber: string,
): ElderEmergencyStatus {
  return {
    id: record.id,
    status: record.status,
    openedAt: record.openedAt.toISOString(),
    humanResponseStartedAt:
      record.respondingAt?.toISOString() ??
      record.acknowledgedAt?.toISOString() ??
      null,
    assistanceMessage: elderStatusMessage(record.status),
    fallbackPhoneNumber,
  };
}

function elderStatusMessage(status: EmergencyEventRecord['status']): string {
  if (status === 'OPEN') return '求助已送达，工作人员正在确认';
  if (status === 'ACKNOWLEDGED') return '工作人员已收到求助';
  if (status === 'RESPONDING') return '工作人员正在赶来';
  if (status === 'RESOLVED') return '现场处置已完成，稍后将由主管复盘';
  return '本次求助已完成处置和复盘';
}

function validateClientObservedAt(
  value: string | undefined,
  serverTimestamp: Date,
): Date | null {
  if (value === undefined) return null;
  const observedAt = new Date(value);
  if (observedAt.getTime() > serverTimestamp.getTime()) {
    throw m04BadRequest(
      'EMERGENCY_CLIENT_OBSERVED_AT_IN_FUTURE',
      '客户端记录时间不得晚于服务器接收时间',
    );
  }
  return observedAt;
}

function validateReview(input: EmergencyReviewInput): void {
  if (
    input.kind === 'COMPLETED' &&
    (input.summary === undefined || input.summary.trim().length === 0)
  ) {
    throw m04BadRequest(
      'EMERGENCY_REVIEW_SUMMARY_REQUIRED',
      '完成复盘时必须填写复盘摘要',
    );
  }
  if (
    input.kind === 'WAIVED' &&
    (input.waiverReasonCode === undefined ||
      input.waiverReasonCode.trim().length === 0)
  ) {
    throw m04BadRequest(
      'EMERGENCY_REVIEW_WAIVER_REASON_REQUIRED',
      '豁免复盘时必须填写豁免原因',
    );
  }
}

function reviewReasonCode(input: EmergencyReviewInput): string {
  return input.kind === 'WAIVED'
    ? (input.waiverReasonCode ?? 'EMERGENCY_REVIEW_WAIVED')
    : 'EMERGENCY_REVIEW_COMPLETED';
}

function userActor(session: AuthenticatedSession): M04MutationActor {
  return {
    type: 'USER',
    id: session.userId,
    userId: session.userId,
  };
}

function signalFingerprint(
  context: M04FacilityContext,
  sourceKind: string,
  sourceIdentityKey: string,
  input: EmergencySignalInput,
  elderId: string | undefined,
): string {
  const value = JSON.stringify([
    'm04-signal-v1',
    context.organizationId,
    context.facilityId,
    sourceKind,
    sourceIdentityKey,
    input.externalEventId,
    input.reasonCode,
    input.clientObservedAt ?? null,
    elderId ?? null,
  ]);
  return createHash('sha256').update(value).digest('hex');
}

function emergencyCommandFingerprint(
  command: string,
  emergencyEventId: string,
  actorUserId: string,
  input: object,
): string {
  const value = JSON.stringify([
    'm04-command-v1',
    command,
    emergencyEventId,
    actorUserId,
    input,
  ]);
  return createHash('sha256').update(value).digest('hex');
}

function commandReceiptIdentity(
  commandKind: CommandReceiptIdentity['commandKind'],
  resourceType: CommandReceiptIdentity['resourceType'],
  resourceId: string,
  actorUserId: string,
  idempotencyKey: string,
  businessInput: Readonly<Record<string, Prisma.JsonValue>>,
): CommandReceiptIdentity {
  const requestFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        'm04-command-receipt-v1',
        commandKind,
        resourceType,
        resourceId,
        actorUserId,
        businessInput,
      ]),
    )
    .digest('hex');
  return {
    commandKind,
    resourceType,
    resourceId,
    actorUserId,
    idempotencyKey,
    requestFingerprint,
  };
}

async function findCommandReceipt(
  tx: Prisma.TransactionClient,
  context: M04FacilityContext,
  identity: CommandReceiptIdentity,
) {
  return tx.emergencyCommandReceipt.findUnique({
    where: {
      organizationId_actorUserId_commandKind_idempotencyKey: {
        organizationId: context.organizationId,
        actorUserId: identity.actorUserId,
        commandKind: identity.commandKind,
        idempotencyKey: identity.idempotencyKey,
      },
    },
  });
}

function assertCommandReceiptMatches(
  receipt: {
    readonly facilityId: string;
    readonly requestFingerprint: string;
    readonly resourceType: string;
    readonly resourceId: string;
  },
  context: M04FacilityContext,
  identity: CommandReceiptIdentity,
): void {
  if (
    receipt.facilityId !== context.facilityId ||
    receipt.resourceType !== identity.resourceType ||
    receipt.resourceId !== identity.resourceId ||
    receipt.requestFingerprint !== identity.requestFingerprint
  ) {
    throw m04Conflict('EMERGENCY_IDEMPOTENCY_KEY_REUSED');
  }
}

async function createCommandReceipt(
  tx: Prisma.TransactionClient,
  context: M04FacilityContext,
  identity: CommandReceiptIdentity,
  resultVersion: number,
): Promise<void> {
  await tx.emergencyCommandReceipt.create({
    data: {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      actorUserId: identity.actorUserId,
      commandKind: identity.commandKind,
      idempotencyKey: identity.idempotencyKey,
      requestFingerprint: identity.requestFingerprint,
      resourceType: identity.resourceType,
      resourceId: identity.resourceId,
      resultVersion,
      correlationId: context.correlationId,
    },
  });
}

function commandOutboxKey(idempotencyKey: string): string {
  return `m04-command:${idempotencyKey}`;
}

function jsonRecord(
  value: Prisma.JsonValue,
): Readonly<Record<string, Prisma.JsonValue | undefined>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }
  return value;
}

function escalationIdempotencyKey(
  emergencyEventId: string,
  stepId: string,
  stage: string,
  basisVersion: number,
): string {
  const value = JSON.stringify([
    'm04-escalation-v1',
    emergencyEventId,
    stepId,
    stage,
    basisVersion,
  ]);
  return `m04-escalation-v1:${createHash('sha256').update(value).digest('hex')}`;
}

function earliestStageDueAt(
  steps: readonly {
    readonly stage: string;
    readonly thresholdSeconds: number;
  }[],
  stage: string,
  openedAt: Date,
): Date | null {
  const threshold = steps
    .filter((step) => step.stage === stage)
    .map((step) => step.thresholdSeconds)
    .sort((left, right) => left - right)[0];
  return threshold === undefined
    ? null
    : new Date(openedAt.getTime() + threshold * 1000);
}

function familyRelationshipWhere(
  context: M04FacilityContext,
  familyUserId: string | undefined,
  now: Date,
  elderId?: string,
): Prisma.FamilyRelationshipWhereInput {
  return {
    organizationId: context.organizationId,
    facilityId: context.facilityId,
    ...(elderId === undefined ? {} : { elderId }),
    ...(familyUserId === undefined ? {} : { familyUserId }),
    familyUser: { status: 'ACTIVE' },
    status: 'VERIFIED',
    activeFrom: { lte: now },
    revokedAt: null,
    AND: [
      { OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
      {
        sharingPreferences: {
          some: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            field: 'TIMELINE_SUMMARY',
            allowed: true,
            validFrom: { lte: now },
            AND: [
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
              {
                consentRecord: {
                  is: {
                    organizationId: context.organizationId,
                    facilityId: context.facilityId,
                    purpose: 'FAMILY_SHARING',
                    decision: 'GRANTED',
                    supersededAt: null,
                    effectiveAt: { lte: now },
                    OR: [
                      { expiresAt: null },
                      { expiresAt: { gt: now } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

function familyStageCopy(
  stage:
    | 'OPENED'
    | 'ACKNOWLEDGED'
    | 'RESPONDING'
    | 'RESOLVED'
    | 'REVIEWED',
) {
  if (stage === 'OPENED') {
    return {
      title: '机构已收到紧急求助',
      summary: '工作人员正在确认并处理。如需更多信息，请联系机构。',
    };
  }
  if (stage === 'ACKNOWLEDGED') {
    return {
      title: '紧急求助已确认',
      summary: '工作人员已确认收到求助，正在按流程处理。',
    };
  }
  if (stage === 'RESPONDING') {
    return {
      title: '工作人员正在响应',
      summary: '工作人员正在现场响应，内部位置和人员轨迹不会对外展示。',
    };
  }
  if (stage === 'RESOLVED') {
    return {
      title: '紧急事件现场处置完成',
      summary: '现场处置已完成，后续仍需主管复盘。如需了解情况，请联系机构。',
    };
  }
  return {
    title: '紧急事件已完成复盘',
    summary: '本次事件已完成机构复盘，必要的后续事项将由工作人员跟进。',
  };
}

function mapFamilyPreference(
  elderId: string,
  preference: {
    readonly id: string;
    readonly enabled: boolean;
    readonly notifyOnOpened: boolean;
    readonly notifyOnResolved: boolean;
    readonly channel: 'IN_APP' | 'SMS' | 'PHONE' | 'EMAIL';
    readonly version: number;
    readonly updatedAt: Date;
  } | null,
): FamilyEmergencyNotificationPreference {
  return {
    id: preference?.id ?? null,
    elderId,
    enabled: preference?.enabled ?? true,
    notifyOnOpened: preference?.notifyOnOpened ?? false,
    notifyOnResolved: preference?.notifyOnResolved ?? true,
    channel: preference?.channel ?? 'IN_APP',
    version: preference?.version ?? 0,
    updatedAt: preference?.updatedAt.toISOString() ?? null,
  };
}

function shiftAssignmentCovers(
  assignment: {
    readonly scopes: readonly {
      readonly kind: 'FACILITY' | 'FLOOR' | 'ZONE';
      readonly floorId: string | null;
      readonly zoneId: string | null;
    }[];
    readonly elderAssignments: readonly { readonly elderId?: string }[];
  },
  floorId: string,
  zoneId: string | null,
): boolean {
  return (
    assignment.elderAssignments.length > 0 ||
    assignment.scopes.some(
      (scope) =>
        scope.kind === 'FACILITY' ||
        (scope.kind === 'FLOOR' && scope.floorId === floorId) ||
        (scope.kind === 'ZONE' &&
          zoneId !== null &&
          scope.zoneId === zoneId),
    )
  );
}

function emergencyOrderBy(
  query: EmergencyListQueryInput,
): Prisma.EmergencyEventOrderByWithRelationInput[] {
  const direction = query.sortDirection ?? 'desc';
  const sortBy = query.sortBy ?? 'openedAt';
  if (sortBy === 'status') {
    return [
      { status: direction },
      { currentDeadlineAt: { sort: 'asc', nulls: 'last' } },
      { openedAt: 'desc' },
      { id: 'desc' },
    ];
  }
  if (sortBy === 'updatedAt') {
    return [{ updatedAt: direction }, { id: direction }];
  }
  return [{ openedAt: direction }, { id: direction }];
}

function emergencyLocationStateWhere(
  state: NonNullable<EmergencyListQueryInput['locationState']>,
  now: Date,
): Prisma.EmergencyEventWhereInput {
  if (state === 'CURRENT') {
    return {
      locationSnapshot: {
        is: {
          state: 'CURRENT',
          expiresAt: { gt: now },
        },
      },
    };
  }
  if (state === 'STALE') {
    return {
      locationSnapshot: {
        is: {
          OR: [
            { state: 'STALE' },
            {
              state: 'CURRENT',
              expiresAt: { lte: now },
            },
          ],
        },
      },
    };
  }
  if (state === 'UNKNOWN') {
    return {
      OR: [
        { locationSnapshot: { is: null } },
        { locationSnapshot: { is: { state: 'UNKNOWN' } } },
      ],
    };
  }
  return {
    locationSnapshot: {
      is: { state },
    },
  };
}

function pageInfo(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
