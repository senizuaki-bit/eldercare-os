import { Inject, Injectable } from '@nestjs/common';
import {
  authorizeElderAccess,
  type DataScope,
  type ElderAccessView,
} from '@eldercare/authz';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { M02FacilityContext } from './m02-context.js';

const elderAccessInclude = {
  stays: {
    where: { status: 'ACTIVE' as const },
    orderBy: { admittedAt: 'desc' as const },
    take: 1,
    include: { bed: { include: { room: true } } },
  },
} satisfies Prisma.ElderInclude;

export type ElderAccessRecord = Prisma.ElderGetPayload<{ include: typeof elderAccessInclude }>;

export interface ElderAccessResult {
  readonly elder: ElderAccessRecord;
  readonly familyRelationshipId?: string;
  readonly familyConsentRecordId?: string;
  readonly shiftAssignmentId?: string;
}

@Injectable()
export class ElderAccessService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async assert(
    context: M02FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
    view: ElderAccessView,
  ): Promise<ElderAccessResult> {
    const elder = await this.database.client.elder.findFirst({
      where: {
        id: elderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
      },
      include: elderAccessInclude,
    });
    if (elder === null) throw resourceNotFound();

    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [roleAssignments, relationship, staffProfile] = await Promise.all([
      this.database.client.userRole.findMany({
        where: {
          userId: session.userId,
          organizationId: context.organizationId,
          activeFrom: { lte: now },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { dataScopes: true },
      }),
      this.database.client.familyRelationship.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId,
          familyUserId: session.userId,
          status: 'VERIFIED',
          activeFrom: { lte: now },
          revokedAt: null,
          OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
        },
        select: { id: true },
      }),
      this.database.client.staffProfile.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          userId: session.userId,
          status: 'ACTIVE',
          endedAt: null,
          OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
        },
        select: { id: true },
      }),
    ]);

    const scopes: DataScope[] = roleAssignments.flatMap((assignment) =>
      assignment.dataScopes.map((scope) => ({
        id: scope.id,
        kind: scope.kind,
        scopeKey: scope.scopeKey,
        organizationId: scope.organizationId,
        ...(scope.facilityId === null ? {} : { facilityId: scope.facilityId }),
        ...(scope.resourceType === null ? {} : { resourceType: scope.resourceType }),
        ...(scope.resourceId === null ? {} : { resourceId: scope.resourceId }),
        validFrom: scope.validFrom.toISOString(),
        ...(scope.validUntil === null ? {} : { validUntil: scope.validUntil.toISOString() }),
      })),
    );

    const [familyConsent, withdrawnFamilyConsent, caregiverAssignment] = await Promise.all([
      relationship === null
        ? Promise.resolve(null)
        : this.database.client.consentRecord.findFirst({
            where: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              elderId,
              purpose: 'FAMILY_SHARING',
              decision: 'GRANTED',
              supersededAt: null,
              effectiveAt: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: { id: true },
          }),
      relationship === null
        ? Promise.resolve(null)
        : this.database.client.consentRecord.findFirst({
            where: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              elderId,
              purpose: 'FAMILY_SHARING',
              decision: 'WITHDRAWN',
              supersededAt: null,
              effectiveAt: { lte: now },
            },
            select: { id: true },
          }),
      staffProfile === null
        ? Promise.resolve(null)
        : this.findCoveringAssignment(context, staffProfile.id, elder, now),
    ]);

    if (relationship !== null) {
      scopes.push({
        kind: 'LINKED_ELDER',
        scopeKey: `relationship:${relationship.id}:elder:${elderId}`,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        resourceType: 'ELDER',
        resourceId: elderId,
        validFrom: now.toISOString(),
      });
    }
    if (caregiverAssignment !== null) {
      scopes.push(
        {
          kind: 'ACTIVE_SHIFT',
          scopeKey: `shift-assignment:${caregiverAssignment.id}`,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          resourceType: 'SHIFT_ASSIGNMENT',
          resourceId: caregiverAssignment.id,
          validFrom: caregiverAssignment.shift.startsAt.toISOString(),
          validUntil: caregiverAssignment.shift.endsAt.toISOString(),
        },
        {
          kind: 'ASSIGNED_ELDER',
          scopeKey: `shift-assignment:${caregiverAssignment.id}:elder:${elderId}`,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          resourceType: 'ELDER',
          resourceId: elderId,
          validFrom: caregiverAssignment.shift.startsAt.toISOString(),
          validUntil: caregiverAssignment.shift.endsAt.toISOString(),
        },
      );
    }

    const residence = elder.stays[0];
    const decision = authorizeElderAccess({
      context: {
        actorId: session.userId,
        organizationId: context.organizationId,
        roles: session.principal.roles.map((role) => role.key),
        permissions: session.principal.permissions,
        scopes,
      },
      target: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        resourceType: 'ELDER',
        resourceId: elderId,
        elderId,
        ...(elder.portalUserId === null ? {} : { ownerUserId: elder.portalUserId }),
        ...(residence === undefined ? {} : { floorId: residence.bed.room.floorId }),
        ...(caregiverAssignment?.shift.teamId === null || caregiverAssignment?.shift.teamId === undefined
          ? {}
          : { careTeamId: caregiverAssignment.shift.teamId }),
      },
      view,
      facts: {
        ownsRecord: elder.portalUserId === session.userId,
        familyRelationshipActive: relationship !== null,
        familySharingConsentActive: familyConsent !== null,
        familySharingConsentWithdrawn: withdrawnFamilyConsent !== null,
        caregiverAssigned: caregiverAssignment !== null,
        caregiverShiftActive: caregiverAssignment !== null,
      },
      now,
    });
    if (!decision.allowed) {
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'SECURITY.ELDER_ACCESS_DENIED',
        outcome: 'DENIED',
        resourceType: 'ELDER',
        resourceId: elderId,
        reasonCode: decision.reasonCode,
        correlationId: context.correlationId,
        metadata: { source: 'm02-resource-policy' },
      });
      throw resourceNotFound();
    }
    return {
      elder,
      ...(relationship === null ? {} : { familyRelationshipId: relationship.id }),
      ...(familyConsent === null ? {} : { familyConsentRecordId: familyConsent.id }),
      ...(caregiverAssignment === null ? {} : { shiftAssignmentId: caregiverAssignment.id }),
    };
  }

  private async findCoveringAssignment(
    context: M02FacilityContext,
    staffProfileId: string,
    elder: ElderAccessRecord,
    now: Date,
  ) {
    const stay = elder.stays[0];
    if (stay === undefined) return null;
    const candidates = await this.database.client.shiftAssignment.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        staffProfileId,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        shift: {
          startsAt: { lte: now },
          endsAt: { gt: now },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      },
      include: {
        shift: { select: { startsAt: true, endsAt: true, teamId: true } },
        scopes: true,
        elderAssignments: { where: { elderId: elder.id }, select: { id: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
    return candidates.find((assignment) =>
      assignment.elderAssignments.length > 0 ||
      assignment.scopes.some((scope) =>
        scope.kind === 'FACILITY' ||
        (scope.kind === 'FLOOR' && scope.floorId === stay.bed.room.floorId) ||
        (scope.kind === 'ZONE' && scope.zoneId === stay.bed.room.zoneId),
      ),
    ) ?? null;
  }
}
