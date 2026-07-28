import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { M02_PERMISSIONS, M03_PERMISSIONS } from '@eldercare/authz';
import {
  type FamilySummariesQuery,
  type RatingCreateRequest,
  type WorkOrderArrivalRequest,
  type WorkOrderAssignRequest,
  type WorkOrderCompletionRequest,
  type WorkOrdersQuery,
  type WorkOrderStatus,
  type WorkOrderTransitionRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { ElderAccessService } from '../m02/elder-access.service.js';
import { createEventId } from '../m02/m02-mutation.service.js';
import {
  type AdminWorkOrderMutationPermission,
  currentAdminWorkOrderMutationRoleWhere,
} from './admin-mutation-current-access.js';
import type { M03FacilityContext } from './m03-context.service.js';
import {
  activeCaregiverDataScopeWhere,
  activeCaregiverRoleWhere,
  caregiverRoleHasCurrentScopeAccess,
  type CurrentCaregiverDataScope,
} from './caregiver-current-access.js';
import {
  assertCompletionChecklistInput,
  completionChecklistRequirement,
  createCompletionChecklistSnapshot,
  normalizedCompletionChecklistCodes,
  persistedCompletionChecklistMatches,
} from './completion-checklist.js';
import {
  mapFamilySummary,
  mapRating,
  mapWorkOrder,
  mapWorkOrderDetail,
  mapWorkOrderWithProjections,
  WORK_ORDER_INCLUDE,
  type WorkOrderRecord,
} from './m03-mappers.js';
import { activeElderRoleWhere } from './elder-current-access.js';
import { m03Conflict } from './m03-errors.js';
import { M03MutationService } from './m03-mutation.service.js';
import { TaskUpdatesService, type CaregiverTaskUpdateScope } from './task-updates.service.js';
import { assertArrivalAllowed, assertWorkOrderTransition } from './work-order-state-machine.js';

interface ActiveCaregiver {
  readonly staffProfileId: string;
  readonly roleScopes: readonly CurrentCaregiverDataScope[];
  readonly shiftAssignments: readonly {
    readonly id: string;
    readonly teamId: string | null;
  }[];
}

interface CompletionReplayRecord {
  readonly facilityId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actorId: string;
  readonly payload: Prisma.JsonValue;
}

interface ResolvedWorkOrderAssignment {
  readonly targetTeamId: string;
  readonly assigneeStaffProfileId: string | null;
  readonly shiftAssignmentId: string | null;
}

interface ElderAssignmentLocation {
  readonly floorId: string;
  readonly zoneId: string | null;
}

interface CaregiverMutationAuthorization {
  readonly assignmentId: string;
  readonly staffProfileId: string;
  readonly shiftAssignmentId: string;
  readonly assignmentState: 'OFFERED' | 'CLAIMED';
}

@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(M03MutationService) private readonly mutations: M03MutationService,
    @Inject(ElderAccessService) private readonly elderAccess: ElderAccessService,
    @Inject(TaskUpdatesService) private readonly taskUpdates: TaskUpdatesService,
  ) {}

  async listAdmin(context: M03FacilityContext, query: WorkOrdersQuery) {
    const where = workOrderWhere(context, query);
    const [total, records] = await this.database.client.$transaction([
      this.database.client.workOrder.count({ where }),
      this.database.client.workOrder.findMany({
        where,
        include: WORK_ORDER_INCLUDE,
        orderBy: workOrderOrder(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: records.map(mapWorkOrderWithProjections),
      pageInfo: pageInfo(query.page, query.pageSize, total),
    };
  }

  async getAdmin(context: M03FacilityContext, workOrderId: string) {
    const record = await this.findScoped(context, workOrderId);
    return this.detailProjection(context, record);
  }

  async assign(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderAssignRequest,
    session: AuthenticatedSession,
  ) {
    const updated = await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({
        where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId },
        include: {
          primaryNeed: { select: { status: true, requiresHumanReview: true } },
          elder: {
            select: {
              stays: {
                where: { status: 'ACTIVE' },
                orderBy: { admittedAt: 'desc' },
                take: 1,
                select: { bed: { select: { room: { select: { floorId: true, zoneId: true } } } } },
              },
            },
          },
        },
      });
      if (current === null) throw resourceNotFound();
      await this.assertCurrentAdminMutationAccess(tx, context, session, [
        M03_PERMISSIONS.WORK_ORDER_ASSIGN,
        M03_PERMISSIONS.AI_ANALYSIS_READ,
      ]);
      assertWorkOrderTransition(current.status, 'ASSIGNED');
      if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');

      const needMayBeAssigned = current.primaryNeed.status === 'CONFIRMED' ||
        (current.primaryNeed.status === 'DRAFT' && !current.primaryNeed.requiresHumanReview);
      if (!needMayBeAssigned) throw m03Conflict('NEED_REVIEW_REQUIRED');

      const stay = current.elder.stays[0];
      if (stay === undefined) throw m03Conflict('ELDER_LOCATION_REQUIRED');
      const assignment = await this.resolveAssignmentReferences(tx, context, input, current.elderId, {
        floorId: stay.bed.room.floorId,
        zoneId: stay.bed.room.zoneId,
      });

      const changed = await tx.workOrder.updateMany({
        where: {
          id: current.id,
          version: input.expectedVersion,
          status: 'NEW',
          primaryNeed: {
            OR: [
              { status: 'CONFIRMED' },
              { status: 'DRAFT', requiresHumanReview: false },
            ],
          },
        },
        data: { status: 'ASSIGNED', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const nextVersion = input.expectedVersion + 1;
      await tx.workOrderAssignment.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          workOrderId: current.id,
          targetTeamId: assignment.targetTeamId,
          assigneeStaffProfileId: assignment.assigneeStaffProfileId,
          shiftAssignmentId: assignment.shiftAssignmentId,
          status: 'OFFERED',
          assignedByUserId: session.userId,
          reasonCode: input.reasonCode,
        },
      });
      await this.createTransition(tx, context, current.id, current.status, 'ASSIGNED', input.expectedVersion, session, input.reasonCode);
      await this.mutations.record(tx, context, session, {
        action: 'WORK_ORDER.ASSIGN',
        eventType: 'WORK_ORDER.ASSIGNED',
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: 'ASSIGNED', version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'ELDER_VISIBLE',
          safeSummaryCode: 'WORK_ORDER_ASSIGNED',
          safeMetadata: { workOrderId: current.id },
        },
      });
      return { id: current.id, assigneeStaffProfileId: assignment.assigneeStaffProfileId };
    });
    const result = await this.findScoped(context, updated.id);
    this.publish(context, result, 'WORK_ORDER.ASSIGNED', updated.assigneeStaffProfileId);
    return this.detailProjection(context, result);
  }

  async verifyAdmin(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
  ) {
    if (input.targetStatus !== 'VERIFIED') throw m03Conflict('TARGET_STATUS_NOT_ALLOWED');
    return this.verify(context, workOrderId, input, session, false);
  }

  async closeAdmin(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
  ) {
    if (input.targetStatus !== 'CLOSED') throw m03Conflict('TARGET_STATUS_NOT_ALLOWED');
    await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({
        where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId },
      });
      if (current === null) throw resourceNotFound();
      await this.assertCurrentAdminMutationAccess(tx, context, session, [
        M03_PERMISSIONS.WORK_ORDER_CLOSE,
        M03_PERMISSIONS.AI_ANALYSIS_READ,
      ]);
      assertWorkOrderTransition(current.status, 'CLOSED');
      if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const now = new Date();
      const changed = await tx.workOrder.updateMany({
        where: { id: current.id, version: input.expectedVersion, status: 'VERIFIED' },
        data: { status: 'CLOSED', closedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const nextVersion = input.expectedVersion + 1;
      await tx.need.updateMany({
        where: { id: current.primaryNeedId, organizationId: context.organizationId, facilityId: context.facilityId },
        data: { status: 'FULFILLED', version: { increment: 1 } },
      });
      await this.createTransition(tx, context, current.id, 'VERIFIED', 'CLOSED', input.expectedVersion, session, input.reasonCode, now);
      await this.mutations.record(tx, context, session, {
        action: 'WORK_ORDER.CLOSE',
        eventType: 'WORK_ORDER.CLOSED',
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: 'CLOSED', version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'FAMILY_ELIGIBLE',
          safeSummaryCode: 'WORK_ORDER_CLOSED',
          safeMetadata: { workOrderId: current.id },
        },
      });
    });
    const result = await this.findScoped(context, workOrderId);
    this.publish(context, result, 'WORK_ORDER.CLOSED');
    return this.detailProjection(context, result);
  }

  async listCaregiver(context: M03FacilityContext, session: AuthenticatedSession) {
    const caregiver = await this.activeCaregiver(context, session);
    const records = await this.database.client.workOrder.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: { in: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'] },
        assignments: { some: caregiverAssignmentWhere(caregiver) },
      },
      include: WORK_ORDER_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    const visible = (await Promise.all(records.map(async (record) => {
      try {
        await this.elderAccess.assert(context, record.elderId, session, 'CAREGIVER_SUMMARY');
        const coveringShifts = await this.coveringCaregiverShifts(context, caregiver, record.elderId);
        return record.assignments.some((assignment) =>
          caregiverAssignmentMatches(assignment, caregiver, coveringShifts, false))
          ? record
          : null;
      } catch (error) {
        if (error instanceof SafeHttpException && error.safeCode === 'RESOURCE_NOT_FOUND') return null;
        throw error;
      }
    }))).filter((record): record is WorkOrderRecord => record !== null);
    return { items: visible.map((record) => this.caregiverProjection(record)), pageInfo: pageInfo(1, 100, visible.length) };
  }

  async getCaregiver(context: M03FacilityContext, workOrderId: string, session: AuthenticatedSession) {
    const { record } = await this.assertCaregiverWorkOrder(context, workOrderId, session);
    return this.caregiverProjection(record);
  }

  async accept(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
  ) {
    if (input.targetStatus !== 'ACCEPTED') throw m03Conflict('TARGET_STATUS_NOT_ALLOWED');
    const access = await this.assertCaregiverWorkOrder(
      context,
      workOrderId,
      session,
      false,
      M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    );
    const shift = selectShiftForAssignment(
      access.coveringShifts,
      access.assignment.shiftAssignmentId,
      access.assignment.targetTeamId,
    );
    await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({ where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId } });
      if (current === null) throw resourceNotFound();
      await this.assertCaregiverMutationAccess(tx, context, current.elderId, workOrderId, session, {
        assignmentId: access.assignment.id,
        staffProfileId: access.caregiver.staffProfileId,
        shiftAssignmentId: shift.id,
        assignmentState: 'OFFERED',
      });
      assertWorkOrderTransition(current.status, 'ACCEPTED');
      if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const now = new Date();
      const changed = await tx.workOrder.updateMany({
        where: { id: current.id, version: input.expectedVersion, status: 'ASSIGNED' },
        data: { status: 'ACCEPTED', acceptedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const claimed = await tx.workOrderAssignment.updateMany({
        where: {
          id: access.assignment.id,
          status: 'OFFERED',
          version: access.assignment.version,
          OR: [{ assigneeStaffProfileId: null }, { assigneeStaffProfileId: access.caregiver.staffProfileId }],
        },
        data: {
          status: 'CLAIMED',
          assigneeStaffProfileId: access.caregiver.staffProfileId,
          shiftAssignmentId: shift.id,
          claimedAt: now,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw m03Conflict('WORK_ORDER_ALREADY_CLAIMED');
      const nextVersion = input.expectedVersion + 1;
      await this.createTransition(tx, context, current.id, 'ASSIGNED', 'ACCEPTED', input.expectedVersion, session, input.reasonCode, now);
      await this.mutations.record(tx, context, session, {
        action: 'WORK_ORDER.ACCEPT',
        eventType: 'WORK_ORDER.ACCEPTED',
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: 'ACCEPTED', version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'ELDER_VISIBLE',
          safeSummaryCode: 'WORK_ORDER_ACCEPTED',
          safeMetadata: { workOrderId: current.id },
        },
      });
    });
    const record = await this.findScoped(context, workOrderId);
    this.publish(context, record, 'WORK_ORDER.ACCEPTED', access.caregiver.staffProfileId);
    return this.caregiverProjection(record);
  }

  async arrive(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderArrivalRequest,
    session: AuthenticatedSession,
  ) {
    const access = await this.assertCaregiverWorkOrder(
      context,
      workOrderId,
      session,
      true,
      M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    );
    const shiftAssignmentId = access.assignment.shiftAssignmentId;
    if (shiftAssignmentId === null) throw resourceNotFound();
    const arrival = await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({ where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId } });
      if (current === null) throw resourceNotFound();
      await this.assertCaregiverMutationAccess(tx, context, current.elderId, workOrderId, session, {
        assignmentId: access.assignment.id,
        staffProfileId: access.caregiver.staffProfileId,
        shiftAssignmentId,
        assignmentState: 'CLAIMED',
      });
      assertArrivalAllowed(current.status, current.arrivedAt);
      if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const now = new Date();
      const changed = await tx.workOrder.updateMany({
        where: { id: current.id, version: input.expectedVersion, status: 'ACCEPTED', arrivedAt: null },
        data: { arrivedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const nextVersion = input.expectedVersion + 1;
      const createdArrival = await tx.workOrderArrival.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          workOrderId: current.id,
          actorUserId: session.userId,
          fromVersion: input.expectedVersion,
          toVersion: nextVersion,
          reasonCode: input.reasonCode,
          arrivedAt: now,
          correlationId: context.correlationId,
        },
      });
      await this.mutations.record(tx, context, session, {
        action: 'WORK_ORDER.ARRIVE',
        eventType: 'WORK_ORDER.ARRIVED',
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: 'ACCEPTED', version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'ELDER_VISIBLE',
          safeSummaryCode: 'WORK_ORDER_ARRIVED',
          safeMetadata: { workOrderId: current.id },
        },
      });
      return createdArrival;
    });
    const record = await this.findScoped(context, workOrderId);
    this.publish(context, record, 'WORK_ORDER.ARRIVED', access.caregiver.staffProfileId);
    return {
      id: arrival.id,
      organizationId: arrival.organizationId,
      facilityId: arrival.facilityId,
      workOrderId: arrival.workOrderId,
      actorUserId: arrival.actorUserId,
      fromVersion: arrival.fromVersion,
      toVersion: arrival.toVersion,
      reasonCode: arrival.reasonCode,
      arrivedAt: arrival.arrivedAt.toISOString(),
      correlationId: arrival.correlationId,
    };
  }

  async start(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
  ) {
    if (input.targetStatus !== 'IN_PROGRESS') throw m03Conflict('TARGET_STATUS_NOT_ALLOWED');
    const access = await this.assertCaregiverWorkOrder(
      context,
      workOrderId,
      session,
      true,
      M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    );
    const shiftAssignmentId = access.assignment.shiftAssignmentId;
    if (shiftAssignmentId === null) throw resourceNotFound();
    await this.caregiverTransition(context, workOrderId, input, session, 'ACCEPTED', 'IN_PROGRESS', {
      assignmentId: access.assignment.id,
      staffProfileId: access.caregiver.staffProfileId,
      shiftAssignmentId,
      assignmentState: 'CLAIMED',
    });
    const record = await this.findScoped(context, workOrderId);
    return this.caregiverProjection(record);
  }

  async complete(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderCompletionRequest,
    session: AuthenticatedSession,
  ) {
    const access = await this.assertCaregiverWorkOrder(
      context,
      workOrderId,
      session,
      true,
      M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    );
    const shiftAssignmentId = access.assignment.shiftAssignmentId;
    if (shiftAssignmentId === null) throw resourceNotFound();
    const mutationAuthorization: CaregiverMutationAuthorization = {
      assignmentId: access.assignment.id,
      staffProfileId: access.caregiver.staffProfileId,
      shiftAssignmentId,
      assignmentState: 'CLAIMED',
    };
    const replayKey = completionReplayKey(input.idempotencyKey);
    const requestFingerprint = completionRequestFingerprint(
      context,
      workOrderId,
      session.userId,
      access.caregiver.staffProfileId,
      input,
    );
    let created = false;
    try {
      created = await this.database.client.$transaction(async (tx) => {
        const current = await tx.workOrder.findFirst({
          where: {
            id: workOrderId,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
          },
          include: {
            primaryNeed: {
              select: {
                category: true,
                requiresHumanReview: true,
                safetyRuleCodes: true,
              },
            },
          },
        });
        if (current === null) throw resourceNotFound();
        await this.assertCaregiverMutationAccess(
          tx,
          context,
          current.elderId,
          workOrderId,
          session,
          mutationAuthorization,
        );
        const checklistRequirement = completionChecklistRequirement(current);
        assertCompletionChecklistInput(checklistRequirement, input.completionChecklist);
        const replay = await tx.outboxEvent.findFirst({
          where: {
            organizationId: context.organizationId,
            eventType: 'WORK_ORDER.COMPLETED',
            idempotencyKey: replayKey,
          },
          select: {
            facilityId: true,
            aggregateType: true,
            aggregateId: true,
            actorId: true,
            payload: true,
          },
        });
        if (replay !== null) {
          this.assertCompletionReplay(replay, context, workOrderId, session.userId, requestFingerprint);
          const completion = await tx.serviceCompletion.findUnique({ where: { workOrderId } });
          if (!completionMatches(completion, context, workOrderId, access.caregiver.staffProfileId, input)) {
            throw m03Conflict('IDEMPOTENCY_KEY_REUSED');
          }
          return false;
        }
        assertWorkOrderTransition(current.status, 'COMPLETED');
        if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
        if (input.noteSource === 'VOICE') {
          const voice = await tx.voiceSubmission.findFirst({
            where: {
              id: input.voiceSubmissionId,
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              elderId: current.elderId,
              workOrderId: current.id,
              purpose: 'WORK_ORDER_COMPLETION',
              status: 'COMPLETED',
            },
            select: { id: true },
          });
          if (voice === null) throw resourceNotFound();
        }
        const now = new Date();
        const completionChecklist = createCompletionChecklistSnapshot(
          checklistRequirement,
          input.completionChecklist,
          now,
        );
        const changed = await tx.workOrder.updateMany({
          where: { id: current.id, version: input.expectedVersion, status: 'IN_PROGRESS' },
          data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
        const nextVersion = input.expectedVersion + 1;
        await tx.serviceCompletion.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId: current.elderId,
            workOrderId: current.id,
            submittedByStaffProfileId: access.caregiver.staffProfileId,
            noteSource: input.noteSource,
            noteText: input.noteText ?? null,
            voiceSubmissionId: completionVoiceSubmissionId(input),
            confirmedAt: now,
            completionChecklist,
            checklistConfirmedAt: completionChecklist.required ? now : null,
            correlationId: context.correlationId,
          },
        });
        await tx.familySummary.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId: current.elderId,
            workOrderId: current.id,
            status: 'DRAFT',
            title: `服务进展：${current.title}`,
            summary: `工作人员已完成“${current.title}”，等待老人或主管确认。`,
            serviceCompletedAt: now,
            correlationId: context.correlationId,
          },
        });
        await this.createTransition(
          tx,
          context,
          current.id,
          'IN_PROGRESS',
          'COMPLETED',
          input.expectedVersion,
          session,
          input.reasonCode,
          now,
        );
        await this.mutations.record(tx, context, session, {
          action: 'WORK_ORDER.COMPLETE',
          eventType: 'WORK_ORDER.COMPLETED',
          aggregateType: 'WORK_ORDER',
          aggregateId: current.id,
          aggregateVersion: nextVersion,
          resourceType: 'WORK_ORDER',
          reasonCode: input.reasonCode,
          idempotencyKey: replayKey,
          payload: {
            workOrderId: current.id,
            status: 'COMPLETED',
            version: nextVersion,
            requestFingerprint,
          },
          elderTimeline: {
            elderId: current.elderId,
            visibility: 'ELDER_VISIBLE',
            safeSummaryCode: 'WORK_ORDER_COMPLETED_AWAITING_VERIFICATION',
            safeMetadata: { workOrderId: current.id },
          },
        });
        return true;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isPrismaCode(error, 'P2002') && !isPrismaCode(error, 'P2034')) throw error;
      const concurrentReplay = await this.findCompletionReplay(context, replayKey);
      if (concurrentReplay === null) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      this.assertCompletionReplay(concurrentReplay, context, workOrderId, session.userId, requestFingerprint);
      await this.assertPersistedCompletion(context, workOrderId, access.caregiver.staffProfileId, input);
    }
    const record = await this.findScoped(context, workOrderId);
    if (created) this.publish(context, record, 'WORK_ORDER.COMPLETED', access.caregiver.staffProfileId);
    return this.caregiverProjection(record);
  }

  async listElderServices(context: M03FacilityContext, session: AuthenticatedSession) {
    const elder = await this.elderForSession(context, session);
    const records = await this.database.client.workOrder.findMany({
      where: { organizationId: context.organizationId, facilityId: context.facilityId, elderId: elder.id },
      include: WORK_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: records.map((record) => ({
        ...mapWorkOrder(record),
        canVerify: record.status === 'COMPLETED',
        canRate: ['VERIFIED', 'CLOSED'].includes(record.status) && !record.ratings.some((rating) => rating.raterUserId === session.userId),
        rating: record.ratings.find((rating) => rating.raterUserId === session.userId) === undefined
          ? null
          : mapRating(record.ratings.find((rating) => rating.raterUserId === session.userId)!),
      })),
      pageInfo: pageInfo(1, 50, records.length),
    };
  }

  async verifyElder(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
  ) {
    if (input.targetStatus !== 'VERIFIED') throw m03Conflict('TARGET_STATUS_NOT_ALLOWED');
    return this.verify(context, workOrderId, input, session, true);
  }

  async rateElder(
    context: M03FacilityContext,
    workOrderId: string,
    input: RatingCreateRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    const requestFingerprint = ratingRequestFingerprint(
      context,
      elder.id,
      workOrderId,
      session.userId,
      input,
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const rating = await this.database.client.$transaction(async (tx) => {
          await this.assertElderOwnedMutationAccess(
            tx,
            context,
            elder.id,
            session,
            M03_PERMISSIONS.RATING_CREATE,
          );
          const replay = await tx.rating.findFirst({
            where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
          });
          if (replay !== null) {
            if (!ratingMatches(replay, context, elder.id, workOrderId, session.userId, input)) {
              throw m03Conflict('IDEMPOTENCY_KEY_REUSED');
            }
            const replayEvent = await tx.outboxEvent.findFirst({
              where: {
                organizationId: context.organizationId,
                eventType: 'RATING.SUBMITTED',
                idempotencyKey: `rating:${input.idempotencyKey}`,
              },
              select: {
                facilityId: true,
                aggregateType: true,
                aggregateId: true,
                actorId: true,
                payload: true,
              },
            });
            if (!ratingReplayEventMatches(
              replayEvent,
              context,
              replay.id,
              session.userId,
              requestFingerprint,
            )) {
              throw m03Conflict('IDEMPOTENCY_KEY_REUSED');
            }
            return replay;
          }

          const workOrder = await tx.workOrder.findFirst({
            where: {
              id: workOrderId,
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              elderId: elder.id,
            },
          });
          if (workOrder === null) throw resourceNotFound();
          if (!['VERIFIED', 'CLOSED'].includes(workOrder.status)) throw m03Conflict('RATING_NOT_AVAILABLE');
          if (workOrder.version !== input.expectedWorkOrderVersion) {
            throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
          }

          const priorRating = await tx.rating.findUnique({
            where: { workOrderId_raterUserId: { workOrderId, raterUserId: session.userId } },
          });
          if (priorRating !== null) throw m03Conflict('RATING_ALREADY_SUBMITTED');

          const created = await tx.rating.create({
            data: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              elderId: elder.id,
              workOrderId,
              raterUserId: session.userId,
              actorType: 'ELDER',
              score: input.score,
              comment: input.comment ?? null,
              requiresFollowUp: input.requiresFollowUp,
              idempotencyKey: input.idempotencyKey,
              correlationId: context.correlationId,
            },
          });
          await this.mutations.record(tx, context, session, {
            action: 'RATING.SUBMIT',
            eventType: 'RATING.SUBMITTED',
            aggregateType: 'RATING',
            aggregateId: created.id,
            aggregateVersion: 1,
            resourceType: 'RATING',
            idempotencyKey: `rating:${input.idempotencyKey}`,
            payload: { ratingId: created.id, workOrderId, requestFingerprint },
            elderTimeline: {
              elderId: elder.id,
              visibility: 'INTERNAL',
              safeSummaryCode: 'SERVICE_RATING_SUBMITTED',
              safeMetadata: { workOrderId },
            },
          });
          return created;
        }, { isolationLevel: 'Serializable' });
        return mapRating(rating);
      } catch (error) {
        const retryable = isPrismaCode(error, 'P2002') || isPrismaCode(error, 'P2034');
        if (retryable && attempt < 2) continue;
        if (isPrismaCode(error, 'P2034')) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
        if (isPrismaCode(error, 'P2002')) throw m03Conflict('RATING_ALREADY_SUBMITTED');
        throw error;
      }
    }
    throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
  }

  async listFamilySummaries(
    context: M03FacilityContext,
    query: FamilySummariesQuery,
    session: AuthenticatedSession,
  ) {
    const now = new Date();
    const where: Prisma.FamilySummaryWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.elderId === undefined ? {} : { elderId: query.elderId }),
      status: 'PUBLISHED' as const,
      elder: {
        familyRelationships: {
          some: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            familyUserId: session.userId,
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
                            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.familySummary.count({ where }),
      this.database.client.familySummary.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: records.map(mapFamilySummary), pageInfo: pageInfo(query.page, query.pageSize, total) };
  }

  async canReceiveCaregiverTaskUpdate(
    context: M03FacilityContext,
    session: AuthenticatedSession,
    scope: CaregiverTaskUpdateScope,
  ): Promise<boolean> {
    try {
      const caregiver = await this.activeCaregiver(context, session);
      const activeShiftIds = caregiver.shiftAssignments.map((shift) => shift.id);
      const activeTeamIds = caregiver.shiftAssignments.flatMap((shift) =>
        shift.teamId === null ? [] : [shift.teamId]);
      const direct = scope.assigneeStaffProfileId === caregiver.staffProfileId;
      const teamOffer = scope.assigneeStaffProfileId === null &&
        scope.targetTeamId !== null &&
        activeTeamIds.includes(scope.targetTeamId);
      if (!direct && !teamOffer) return false;

      const currentAssignment = await this.database.client.workOrderAssignment.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          workOrderId: scope.workOrderId,
          workOrder: { elderId: scope.elderId },
          status: { in: ['OFFERED', 'CLAIMED'] },
          ...(direct
            ? {
                assigneeStaffProfileId: caregiver.staffProfileId,
                shiftAssignmentId: { in: activeShiftIds },
              }
            : {
                assigneeStaffProfileId: null,
                targetTeamId: scope.targetTeamId,
              }),
        },
        select: { shiftAssignmentId: true, targetTeamId: true },
      });
      if (currentAssignment === null) return false;

      await this.elderAccess.assert(context, scope.elderId, session, 'CAREGIVER_SUMMARY');
      const coveringShifts = await this.coveringCaregiverShifts(context, caregiver, scope.elderId);
      if (direct) {
        return currentAssignment.shiftAssignmentId !== null &&
          coveringShifts.some((shift) => shift.id === currentAssignment.shiftAssignmentId);
      }
      return coveringShifts.some((shift) => shift.teamId === currentAssignment.targetTeamId);
    } catch (error) {
      if (error instanceof SafeHttpException) return false;
      throw error;
    }
  }

  private async verify(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
    elderOwned: boolean,
  ) {
    const initial = await this.database.client.workOrder.findFirst({
      where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId },
    });
    if (initial === null) throw resourceNotFound();
    if (elderOwned) await this.elderAccess.assert(context, initial.elderId, session, 'BASIC');
    await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({
        where: {
          id: workOrderId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          ...(elderOwned ? { elderId: initial.elderId } : {}),
        },
      });
      if (current === null) throw resourceNotFound();
      if (elderOwned) {
        await this.assertElderOwnedMutationAccess(
          tx,
          context,
          current.elderId,
          session,
          M03_PERMISSIONS.WORK_ORDER_VERIFY,
        );
      } else {
        await this.assertCurrentAdminMutationAccess(tx, context, session, [
          M03_PERMISSIONS.WORK_ORDER_VERIFY,
          M03_PERMISSIONS.AI_ANALYSIS_READ,
          M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH,
        ]);
      }
      assertWorkOrderTransition(current.status, 'VERIFIED');
      if (current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const completion = await tx.serviceCompletion.findUnique({ where: { workOrderId: current.id } });
      if (completion === null) throw m03Conflict('COMPLETION_REQUIRED');
      const now = new Date();
      const changed = await tx.workOrder.updateMany({
        where: { id: current.id, version: input.expectedVersion, status: 'COMPLETED' },
        data: { status: 'VERIFIED', verifiedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const nextVersion = input.expectedVersion + 1;
      const summary = await tx.familySummary.upsert({
        where: { workOrderId: current.id },
        create: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: current.elderId,
          workOrderId: current.id,
          status: 'PUBLISHED',
          title: `服务进展：${current.title}`,
          summary: `“${current.title}”已完成并确认。如需进一步帮助，可联系机构工作人员。`,
          serviceCompletedAt: completion.confirmedAt,
          publishedAt: now,
          publishedByUserId: session.userId,
          correlationId: context.correlationId,
        },
        update: {
          status: 'PUBLISHED',
          summary: `“${current.title}”已完成并确认。如需进一步帮助，可联系机构工作人员。`,
          publishedAt: now,
          publishedByUserId: session.userId,
          version: { increment: 1 },
        },
      });
      await this.createTransition(tx, context, current.id, 'COMPLETED', 'VERIFIED', input.expectedVersion, session, input.reasonCode, now);
      await this.mutations.record(tx, context, session, {
        action: 'WORK_ORDER.VERIFY',
        eventType: 'WORK_ORDER.VERIFIED',
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: 'VERIFIED', version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'FAMILY_ELIGIBLE',
          safeSummaryCode: 'WORK_ORDER_VERIFIED',
          safeMetadata: { workOrderId: current.id },
        },
      });
      await this.mutations.record(tx, context, session, {
        action: 'FAMILY_SUMMARY.PUBLISH',
        eventType: 'FAMILY_SUMMARY.PUBLISHED',
        aggregateType: 'FAMILY_SUMMARY',
        aggregateId: summary.id,
        aggregateVersion: summary.version,
        resourceType: 'FAMILY_SUMMARY',
        reasonCode: input.reasonCode,
        payload: { familySummaryId: summary.id, workOrderId: current.id },
      });
    });
    const record = await this.findScoped(context, workOrderId);
    this.publish(context, record, 'WORK_ORDER.VERIFIED');
    return elderOwned ? mapWorkOrder(record) : this.detailProjection(context, record);
  }

  private async caregiverTransition(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderTransitionRequest,
    session: AuthenticatedSession,
    fromStatus: WorkOrderStatus,
    toStatus: WorkOrderStatus,
    authorization: CaregiverMutationAuthorization,
  ): Promise<void> {
    await this.serializable(async (tx) => {
      const current = await tx.workOrder.findFirst({ where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId } });
      if (current === null) throw resourceNotFound();
      await this.assertCaregiverMutationAccess(
        tx,
        context,
        current.elderId,
        workOrderId,
        session,
        authorization,
      );
      assertWorkOrderTransition(current.status, toStatus);
      if (current.status !== fromStatus || current.version !== input.expectedVersion) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      if (toStatus === 'IN_PROGRESS' && current.arrivedAt === null) throw m03Conflict('ARRIVAL_REQUIRED');
      const now = new Date();
      const timestamps = toStatus === 'IN_PROGRESS' ? { startedAt: now } : {};
      const changed = await tx.workOrder.updateMany({
        where: { id: current.id, version: input.expectedVersion, status: fromStatus },
        data: { status: toStatus, ...timestamps, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      const nextVersion = input.expectedVersion + 1;
      await this.createTransition(tx, context, current.id, fromStatus, toStatus, input.expectedVersion, session, input.reasonCode, now);
      await this.mutations.record(tx, context, session, {
        action: `WORK_ORDER.${toStatus}`,
        eventType: `WORK_ORDER.${toStatus}`,
        aggregateType: 'WORK_ORDER',
        aggregateId: current.id,
        aggregateVersion: nextVersion,
        resourceType: 'WORK_ORDER',
        reasonCode: input.reasonCode,
        payload: { workOrderId: current.id, status: toStatus, version: nextVersion },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'ELDER_VISIBLE',
          safeSummaryCode: `WORK_ORDER_${toStatus}`,
          safeMetadata: { workOrderId: current.id },
        },
      });
    });
    const result = await this.findScoped(context, workOrderId);
    this.publish(
      context,
      result,
      `WORK_ORDER.${toStatus}` as 'WORK_ORDER.IN_PROGRESS',
      authorization.staffProfileId,
    );
  }

  private async assertCaregiverMutationAccess(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    elderId: string,
    workOrderId: string,
    session: AuthenticatedSession,
    authorization: CaregiverMutationAuthorization,
  ): Promise<void> {
    const hasCaregiverRole = session.principal.roles.some((role) => role.key === 'CAREGIVER');
    if (
      !hasCaregiverRole ||
      !session.principal.permissions.includes(M02_PERMISSIONS.ELDER_READ_BASIC) ||
      !session.principal.permissions.includes(M03_PERMISSIONS.WORK_ORDER_TRANSITION)
    ) {
      throw resourceNotFound();
    }

    const assignment = await tx.workOrderAssignment.findFirst({
      where: {
        id: authorization.assignmentId,
        workOrderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
      },
      select: {
        status: true,
        targetTeamId: true,
        assigneeStaffProfileId: true,
        shiftAssignmentId: true,
      },
    });
    if (assignment === null) throw resourceNotFound();
    if (authorization.assignmentState === 'OFFERED') {
      if (assignment.status === 'CLAIMED') throw m03Conflict('WORK_ORDER_ALREADY_CLAIMED');
      if (
        assignment.status !== 'OFFERED' ||
        (assignment.assigneeStaffProfileId !== null &&
          assignment.assigneeStaffProfileId !== authorization.staffProfileId) ||
        (assignment.shiftAssignmentId !== null &&
          assignment.shiftAssignmentId !== authorization.shiftAssignmentId)
      ) {
        throw resourceNotFound();
      }
    } else if (
      assignment.status !== 'CLAIMED' ||
      assignment.assigneeStaffProfileId !== authorization.staffProfileId ||
      assignment.shiftAssignmentId !== authorization.shiftAssignmentId
    ) {
      throw resourceNotFound();
    }

    const teamId = assignment.targetTeamId;
    if (teamId === null) throw resourceNotFound();
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const [staff, shiftAssignment, team, membership, elder, caregiverRole] = await Promise.all([
      tx.staffProfile.findFirst({
        where: {
          id: authorization.staffProfileId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          userId: session.userId,
          status: 'ACTIVE',
          endedAt: null,
          OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
        },
        select: { id: true },
      }),
      tx.shiftAssignment.findFirst({
        where: {
          id: authorization.shiftAssignmentId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          staffProfileId: authorization.staffProfileId,
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          shift: {
            teamId,
            startsAt: { lte: now },
            endsAt: { gt: now },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
        },
        include: {
          scopes: true,
          elderAssignments: { where: { elderId }, select: { id: true } },
        },
      }),
      tx.team.findFirst({
        where: {
          id: teamId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      tx.teamMembership.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          teamId,
          staffProfileId: authorization.staffProfileId,
          activeFrom: { lte: now },
          OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
        },
        select: { id: true },
      }),
      tx.elder.findFirst({
        where: {
          id: elderId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'ACTIVE',
        },
        select: {
          stays: {
            where: { status: 'ACTIVE' },
            orderBy: { admittedAt: 'desc' },
            take: 1,
            select: { bed: { select: { room: { select: { floorId: true, zoneId: true } } } } },
          },
        },
      }),
      tx.userRole.findFirst({
        where: activeCaregiverRoleWhere(
          context,
          session.userId,
          now,
          M03_PERMISSIONS.WORK_ORDER_TRANSITION,
        ),
        select: {
          id: true,
          dataScopes: {
            where: activeCaregiverDataScopeWhere(context, now),
            select: { kind: true, scopeKey: true, resourceType: true, resourceId: true },
          },
        },
      }),
    ]);
    const stay = elder?.stays[0];
    if (
      staff === null ||
      shiftAssignment === null ||
      team === null ||
      membership === null ||
      caregiverRole === null ||
      stay === undefined ||
      !caregiverRoleHasCurrentScopeAccess(caregiverRole.dataScopes, {
        shiftAssignmentId: authorization.shiftAssignmentId,
        elderId,
        floorId: stay.bed.room.floorId,
        teamId,
      }) ||
      !assignmentCoversElder(shiftAssignment, {
        floorId: stay.bed.room.floorId,
        zoneId: stay.bed.room.zoneId,
      })
    ) {
      throw resourceNotFound();
    }
  }

  private async assertElderOwnedMutationAccess(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    elderId: string,
    session: AuthenticatedSession,
    requiredPermission: string,
  ): Promise<void> {
    if (
      !session.principal.roles.some((role) => role.key === 'ELDER') ||
      !session.principal.permissions.includes(requiredPermission)
    ) {
      throw resourceNotFound();
    }
    const now = new Date();
    const [facility, elder, elderRole] = await Promise.all([
      tx.facility.findFirst({
        where: {
          id: context.facilityId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
      tx.elder.findFirst({
        where: {
          id: elderId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          portalUserId: session.userId,
          status: 'ACTIVE',
          stays: {
            some: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              status: 'ACTIVE',
              admittedAt: { lte: now },
              OR: [{ dischargedAt: null }, { dischargedAt: { gt: now } }],
            },
          },
        },
        select: { id: true },
      }),
      tx.userRole.findFirst({
        where: activeElderRoleWhere(
          context,
          session.userId,
          now,
          requiredPermission,
        ),
        select: { id: true },
      }),
    ]);
    if (facility === null || elder === null || elderRole === null) throw resourceNotFound();
  }

  private async assertCurrentAdminMutationAccess(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    session: AuthenticatedSession,
    requiredPermissions: readonly AdminWorkOrderMutationPermission[],
  ): Promise<void> {
    const now = new Date();
    const [targetFacility, currentRole] = await Promise.all([
      tx.facility.findFirst({
        where: {
          id: context.facilityId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
      tx.userRole.findFirst({
        where: currentAdminWorkOrderMutationRoleWhere(
          context,
          session.userId,
          requiredPermissions,
          now,
        ),
        select: { id: true },
      }),
    ]);
    if (targetFacility === null || currentRole === null) throw resourceNotFound();
  }

  private async assertCaregiverWorkOrder(
    context: M03FacilityContext,
    workOrderId: string,
    session: AuthenticatedSession,
    claimedOnly = false,
    requiredPermission: string = M03_PERMISSIONS.WORK_ORDER_READ,
  ) {
    const caregiver = await this.activeCaregiver(context, session, requiredPermission);
    const record = await this.database.client.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        assignments: { some: caregiverAssignmentWhere(caregiver, claimedOnly) },
      },
      include: WORK_ORDER_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    await this.elderAccess.assert(context, record.elderId, session, 'CAREGIVER_SUMMARY');
    const coveringShifts = await this.coveringCaregiverShifts(context, caregiver, record.elderId);
    const assignment = record.assignments.find((item) =>
      caregiverAssignmentMatches(item, caregiver, coveringShifts, claimedOnly));
    if (assignment === undefined) throw resourceNotFound();
    return {
      record,
      caregiver,
      assignment,
      coveringShifts,
    };
  }

  private async activeCaregiver(
    context: M03FacilityContext,
    session: AuthenticatedSession,
    requiredPermission: string = M03_PERMISSIONS.WORK_ORDER_READ,
  ): Promise<ActiveCaregiver> {
    const now = new Date();
    const [staff, caregiverRole] = await Promise.all([
      this.database.client.staffProfile.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          userId: session.userId,
          status: 'ACTIVE',
          endedAt: null,
        },
        select: { id: true },
      }),
      this.database.client.userRole.findFirst({
        where: activeCaregiverRoleWhere(context, session.userId, now, requiredPermission),
        select: {
          id: true,
          dataScopes: {
            where: activeCaregiverDataScopeWhere(context, now),
            select: { kind: true, scopeKey: true, resourceType: true, resourceId: true },
          },
        },
      }),
    ]);
    if (staff === null || caregiverRole === null) throw resourceNotFound();
    const shifts = await this.database.client.shiftAssignment.findMany({
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
    const candidateTeamIds = shifts.flatMap((shift) =>
      shift.shift.teamId === null ? [] : [shift.shift.teamId]);
    const [memberships, teams] = candidateTeamIds.length === 0
      ? [[], []] as const
      : await Promise.all([
          this.database.client.teamMembership.findMany({
            where: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              staffProfileId: staff.id,
              teamId: { in: candidateTeamIds },
              activeFrom: { lte: now },
              OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
            },
            select: { teamId: true },
          }),
          this.database.client.team.findMany({
            where: {
              id: { in: candidateTeamIds },
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              status: 'ACTIVE',
            },
            select: { id: true },
          }),
        ]);
    const memberTeamIds = new Set(memberships.map((membership) => membership.teamId));
    const activeTeamIds = new Set(teams.map((team) => team.id));
    const shiftAssignments = shifts.flatMap((shift) =>
      shift.shift.teamId !== null &&
      memberTeamIds.has(shift.shift.teamId) &&
      activeTeamIds.has(shift.shift.teamId)
        ? [{ id: shift.id, teamId: shift.shift.teamId }]
        : []);
    if (shiftAssignments.length === 0) throw resourceNotFound();
    return {
      staffProfileId: staff.id,
      roleScopes: caregiverRole.dataScopes,
      shiftAssignments,
    };
  }

  private async coveringCaregiverShifts(
    context: M03FacilityContext,
    caregiver: ActiveCaregiver,
    elderId: string,
  ): Promise<ActiveCaregiver['shiftAssignments']> {
    const elder = await this.database.client.elder.findFirst({
      where: {
        id: elderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
      },
      select: {
        stays: {
          where: { status: 'ACTIVE' },
          orderBy: { admittedAt: 'desc' },
          take: 1,
          select: { bed: { select: { room: { select: { floorId: true, zoneId: true } } } } },
        },
      },
    });
    const stay = elder?.stays[0];
    if (stay === undefined) return [];
    const activeShiftIds = caregiver.shiftAssignments.map((shift) => shift.id);
    const assignments = await this.database.client.shiftAssignment.findMany({
      where: {
        id: { in: activeShiftIds },
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        staffProfileId: caregiver.staffProfileId,
        shift: { team: { is: { status: 'ACTIVE' } } },
      },
      include: {
        scopes: true,
        elderAssignments: { where: { elderId }, select: { id: true } },
      },
    });
    const caregiverShifts = new Map(caregiver.shiftAssignments.map((shift) => [shift.id, shift]));
    const coveringIds = new Set(assignments
      .filter((assignment) => {
        const caregiverShift = caregiverShifts.get(assignment.id);
        return caregiverShift?.teamId !== null && caregiverShift?.teamId !== undefined &&
          caregiverRoleHasCurrentScopeAccess(caregiver.roleScopes, {
            shiftAssignmentId: assignment.id,
            elderId,
            floorId: stay.bed.room.floorId,
            teamId: caregiverShift.teamId,
          }) &&
          assignmentCoversElder(assignment, {
            floorId: stay.bed.room.floorId,
            zoneId: stay.bed.room.zoneId,
          });
      })
      .map((assignment) => assignment.id));
    return caregiver.shiftAssignments.filter((shift) => coveringIds.has(shift.id));
  }

  private async elderForSession(context: M03FacilityContext, session: AuthenticatedSession) {
    const elder = await this.database.client.elder.findFirst({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        portalUserId: session.userId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (elder === null) throw resourceNotFound();
    await this.elderAccess.assert(context, elder.id, session, 'BASIC');
    return elder;
  }

  private async resolveAssignmentReferences(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    input: WorkOrderAssignRequest,
    elderId: string,
    location: ElderAssignmentLocation,
  ): Promise<ResolvedWorkOrderAssignment> {
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

    if (input.shiftAssignmentId !== undefined) {
      if (input.assigneeStaffProfileId === undefined || input.targetTeamId === undefined) {
        throw resourceNotFound();
      }
      const [team, staff, shift, membership] = await Promise.all([
        tx.team.findFirst({
          where: {
            id: input.targetTeamId,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
        tx.staffProfile.findFirst({
          where: {
            id: input.assigneeStaffProfileId,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            status: 'ACTIVE',
            endedAt: null,
            OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
          },
          select: { id: true },
        }),
        tx.shiftAssignment.findFirst({
          where: {
            id: input.shiftAssignmentId,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            status: { in: ['ASSIGNED', 'ACCEPTED'] },
            staffProfileId: input.assigneeStaffProfileId,
            shift: {
              startsAt: { lte: now },
              endsAt: { gt: now },
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              teamId: input.targetTeamId,
            },
          },
          include: {
            scopes: true,
            elderAssignments: { where: { elderId }, select: { id: true } },
          },
        }),
        tx.teamMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            teamId: input.targetTeamId,
            staffProfileId: input.assigneeStaffProfileId,
            activeFrom: { lte: now },
            OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
          },
          select: { id: true },
        }),
      ]);
      if (
        team === null ||
        staff === null ||
        shift === null ||
        membership === null ||
        !assignmentCoversElder(shift, location)
      ) {
        throw resourceNotFound();
      }
      return {
        targetTeamId: input.targetTeamId,
        assigneeStaffProfileId: input.assigneeStaffProfileId,
        shiftAssignmentId: input.shiftAssignmentId,
      };
    }

    if (input.assigneeStaffProfileId !== undefined) {
      const candidates = await tx.shiftAssignment.findMany({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          staffProfileId: input.assigneeStaffProfileId,
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          staffProfile: {
            status: 'ACTIVE',
            endedAt: null,
            OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
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
          elderAssignments: { where: { elderId }, select: { id: true } },
        },
      });
      const teamIds = candidates.flatMap((candidate) =>
        candidate.shift.teamId === null ? [] : [candidate.shift.teamId]);
      const [teams, memberships] = await Promise.all([
        tx.team.findMany({
          where: {
            id: { in: teamIds },
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            status: 'ACTIVE',
          },
          select: { id: true },
        }),
        tx.teamMembership.findMany({
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            teamId: { in: teamIds },
            staffProfileId: input.assigneeStaffProfileId,
            activeFrom: { lte: now },
            OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
          },
          select: { teamId: true },
        }),
      ]);
      const activeTeamIds = new Set(teams.map((team) => team.id));
      const membershipTeamIds = new Set(memberships.map((membership) => membership.teamId));
      const eligible = candidates.filter((candidate) => {
        const teamId = candidate.shift.teamId;
        return teamId !== null &&
          activeTeamIds.has(teamId) &&
          membershipTeamIds.has(teamId) &&
          assignmentCoversElder(candidate, location);
      });
      if (eligible.length !== 1) throw m03Conflict('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');
      const selected = eligible[0];
      if (selected === undefined || selected.shift.teamId === null) {
        throw m03Conflict('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');
      }
      return {
        targetTeamId: selected.shift.teamId,
        assigneeStaffProfileId: input.assigneeStaffProfileId,
        shiftAssignmentId: selected.id,
      };
    }

    if (input.targetTeamId === undefined) throw resourceNotFound();
    const team = await tx.team.findFirst({
      where: {
        id: input.targetTeamId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (team === null) throw resourceNotFound();
    const candidates = await tx.shiftAssignment.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: { in: ['ASSIGNED', 'ACCEPTED'] },
        staffProfile: {
          status: 'ACTIVE',
          endedAt: null,
          OR: [{ hiredAt: null }, { hiredAt: { lte: today } }],
        },
        shift: {
          teamId: input.targetTeamId,
          startsAt: { lte: now },
          endsAt: { gt: now },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      },
      include: {
        scopes: true,
        elderAssignments: { where: { elderId }, select: { id: true } },
      },
    });
    const candidateStaffIds = candidates.map((candidate) => candidate.staffProfileId);
    const memberships = await tx.teamMembership.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        teamId: input.targetTeamId,
        staffProfileId: { in: candidateStaffIds },
        activeFrom: { lte: now },
        OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
      },
      select: { staffProfileId: true },
    });
    const memberIds = new Set(memberships.map((membership) => membership.staffProfileId));
    if (!candidates.some((candidate) =>
      memberIds.has(candidate.staffProfileId) && assignmentCoversElder(candidate, location))) {
      throw m03Conflict('TEAM_HAS_NO_ACTIVE_COVERING_CAREGIVER');
    }
    return {
      targetTeamId: input.targetTeamId,
      assigneeStaffProfileId: null,
      shiftAssignmentId: null,
    };
  }

  private async createTransition(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    workOrderId: string,
    fromStatus: WorkOrderStatus | null,
    toStatus: WorkOrderStatus,
    fromVersion: number,
    session: AuthenticatedSession,
    reasonCode: string,
    occurredAt = new Date(),
  ): Promise<void> {
    await tx.workOrderTransition.create({
      data: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        workOrderId,
        fromStatus,
        toStatus,
        fromVersion,
        toVersion: fromVersion + 1,
        actorUserId: session.userId,
        reasonCode,
        correlationId: context.correlationId,
        occurredAt,
      },
    });
  }

  private async findScoped(context: M03FacilityContext, workOrderId: string): Promise<WorkOrderRecord> {
    const record = await this.database.client.workOrder.findFirst({
      where: { id: workOrderId, organizationId: context.organizationId, facilityId: context.facilityId },
      include: WORK_ORDER_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    return record;
  }

  private async detailProjection(context: M03FacilityContext, record: WorkOrderRecord) {
    const links = await this.database.client.needLink.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        OR: [{ sourceNeedId: record.primaryNeedId }, { targetNeedId: record.primaryNeedId }],
      },
      select: { sourceNeedId: true, targetNeedId: true },
    });
    const linkedIds = [...new Set(links.flatMap((link) => [link.sourceNeedId, link.targetNeedId]))]
      .filter((id) => id !== record.primaryNeedId);
    const linkedNeeds = linkedIds.length === 0
      ? []
      : await this.database.client.need.findMany({
          where: { id: { in: linkedIds }, organizationId: context.organizationId, facilityId: context.facilityId },
          orderBy: { createdAt: 'asc' },
        });
    return mapWorkOrderDetail(record, linkedNeeds);
  }

  private caregiverProjection(record: WorkOrderRecord) {
    const stay = record.elder.stays[0];
    const checklistRequirement = completionChecklistRequirement(record);
    return {
      ...mapWorkOrder(record),
      elderDisplayName: record.elder.preferredName ?? record.elder.displayName,
      locationLabel: stay === undefined
        ? null
        : `${stay.bed.room.floor.building.name} · ${stay.bed.room.floor.name} · ${stay.bed.room.name} · ${stay.bed.label}`,
      operationalAttention: record.primaryNeed.safetyRuleCodes instanceof Array
        ? record.primaryNeed.safetyRuleCodes.filter((item): item is string => typeof item === 'string').slice(0, 4)
        : [],
      completionChecklistRequired: checklistRequirement.required,
      requiredCompletionChecklistCodes: [...checklistRequirement.expectedCodes],
    };
  }

  private publish(
    context: M03FacilityContext,
    record: WorkOrderRecord,
    eventType: Parameters<TaskUpdatesService['publish']>[0]['event']['eventType'],
    assigneeStaffProfileId: string | null = record.assignments.find((assignment) => assignment.status === 'CLAIMED')?.assigneeStaffProfileId ?? null,
  ): void {
    this.taskUpdates.publish({
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      elderId: record.elderId,
      workOrderId: record.id,
      assigneeStaffProfileId,
      targetTeamId: record.assignments.find((assignment) => assignment.status === 'OFFERED')?.targetTeamId ?? null,
      event: {
        eventId: createEventId(),
        eventType,
        workOrderId: record.id,
        status: record.status,
        version: record.version,
        occurredAt: new Date().toISOString(),
      },
    });
  }

  private async findCompletionReplay(
    context: M03FacilityContext,
    replayKey: string,
  ): Promise<CompletionReplayRecord | null> {
    return this.database.client.outboxEvent.findFirst({
      where: {
        organizationId: context.organizationId,
        eventType: 'WORK_ORDER.COMPLETED',
        idempotencyKey: replayKey,
      },
      select: {
        facilityId: true,
        aggregateType: true,
        aggregateId: true,
        actorId: true,
        payload: true,
      },
    });
  }

  private assertCompletionReplay(
    replay: CompletionReplayRecord,
    context: M03FacilityContext,
    workOrderId: string,
    actorUserId: string,
    requestFingerprint: string,
  ): void {
    if (
      replay.facilityId !== context.facilityId ||
      replay.aggregateType !== 'WORK_ORDER' ||
      replay.aggregateId !== workOrderId ||
      replay.actorId !== actorUserId ||
      !isJsonRecord(replay.payload) ||
      replay.payload['requestFingerprint'] !== requestFingerprint
    ) {
      throw m03Conflict('IDEMPOTENCY_KEY_REUSED');
    }
  }

  private async assertPersistedCompletion(
    context: M03FacilityContext,
    workOrderId: string,
    staffProfileId: string,
    input: WorkOrderCompletionRequest,
  ): Promise<void> {
    const completion = await this.database.client.serviceCompletion.findUnique({ where: { workOrderId } });
    if (!completionMatches(completion, context, workOrderId, staffProfileId, input)) {
      throw m03Conflict('IDEMPOTENCY_KEY_REUSED');
    }
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.client.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isPrismaCode(error, 'P2034')) throw m03Conflict('WORK_ORDER_VERSION_CONFLICT');
      throw error;
    }
  }
}

function assignmentCoversElder(
  assignment: {
    readonly scopes: readonly {
      readonly kind: 'FACILITY' | 'FLOOR' | 'ZONE';
      readonly floorId: string | null;
      readonly zoneId: string | null;
    }[];
    readonly elderAssignments: readonly { readonly id: string }[];
  },
  location: ElderAssignmentLocation,
): boolean {
  return assignment.elderAssignments.length > 0 || assignment.scopes.some((scope) =>
    scope.kind === 'FACILITY' ||
    (scope.kind === 'FLOOR' && scope.floorId === location.floorId) ||
    (scope.kind === 'ZONE' && scope.zoneId !== null && scope.zoneId === location.zoneId));
}

function caregiverAssignmentWhere(caregiver: ActiveCaregiver, claimedOnly = false): Prisma.WorkOrderAssignmentWhereInput {
  const teamIds = caregiver.shiftAssignments.flatMap((shift) => shift.teamId === null ? [] : [shift.teamId]);
  const shiftAssignmentIds = caregiver.shiftAssignments.map((shift) => shift.id);
  if (claimedOnly) {
    return {
      status: 'CLAIMED',
      assigneeStaffProfileId: caregiver.staffProfileId,
      shiftAssignmentId: { in: shiftAssignmentIds },
    };
  }
  return {
    OR: [
      {
        status: { in: ['OFFERED', 'CLAIMED'] },
        assigneeStaffProfileId: caregiver.staffProfileId,
        shiftAssignmentId: { in: shiftAssignmentIds },
      },
      ...(teamIds.length === 0
        ? []
        : [{ status: 'OFFERED' as const, assigneeStaffProfileId: null, targetTeamId: { in: teamIds } }]),
    ],
  };
}

function caregiverAssignmentMatches(
  assignment: WorkOrderRecord['assignments'][number],
  caregiver: ActiveCaregiver,
  coveringShifts: ActiveCaregiver['shiftAssignments'],
  claimedOnly: boolean,
): boolean {
  const direct = assignment.assigneeStaffProfileId === caregiver.staffProfileId &&
    assignment.shiftAssignmentId !== null &&
    coveringShifts.some((shift) => shift.id === assignment.shiftAssignmentId);
  if (claimedOnly) return assignment.status === 'CLAIMED' && direct;
  if (assignment.status === 'CLAIMED') return direct;
  return assignment.status === 'OFFERED' && (direct || (
    assignment.assigneeStaffProfileId === null &&
    coveringShifts.some((shift) => shift.teamId === assignment.targetTeamId)
  ));
}

function selectShiftForAssignment(
  coveringShifts: ActiveCaregiver['shiftAssignments'],
  assignedShiftAssignmentId: string | null,
  targetTeamId: string | null,
) {
  if (assignedShiftAssignmentId !== null) {
    const explicit = coveringShifts.find((candidate) => candidate.id === assignedShiftAssignmentId);
    if (explicit === undefined) throw resourceNotFound();
    return explicit;
  }
  const candidates = coveringShifts.filter((candidate) =>
    targetTeamId !== null && candidate.teamId === targetTeamId);
  if (candidates.length !== 1) throw m03Conflict('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');
  const selected = candidates[0];
  if (selected === undefined) throw m03Conflict('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');
  return selected;
}

function workOrderWhere(context: M03FacilityContext, query: WorkOrdersQuery): Prisma.WorkOrderWhereInput {
  return {
    organizationId: context.organizationId,
    facilityId: context.facilityId,
    ...(query.elderId === undefined ? {} : { elderId: query.elderId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.priority === undefined ? {} : { priority: query.priority }),
    ...(query.assigneeStaffProfileId === undefined
      ? {}
      : { assignments: { some: { assigneeStaffProfileId: query.assigneeStaffProfileId, status: { in: ['OFFERED', 'CLAIMED'] } } } }),
    ...(query.overdue === undefined ? {} : query.overdue
      ? { dueAt: { lt: new Date() }, status: { notIn: ['COMPLETED', 'VERIFIED', 'CLOSED', 'CANCELLED'] } }
      : { OR: [{ dueAt: { gte: new Date() } }, { status: { in: ['COMPLETED', 'VERIFIED', 'CLOSED', 'CANCELLED'] } }] }),
    ...(query.search === undefined
      ? {}
      : { OR: [
          { code: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
          { summary: { contains: query.search, mode: 'insensitive' } },
        ] }),
  };
}

function workOrderOrder(query: WorkOrdersQuery): Prisma.WorkOrderOrderByWithRelationInput[] {
  return [{ [query.sort]: query.direction }, { id: query.direction }];
}

function completionReplayKey(idempotencyKey: string): string {
  return `work-order-completion:${idempotencyKey}`;
}

function completionRequestFingerprint(
  context: M03FacilityContext,
  workOrderId: string,
  actorUserId: string,
  staffProfileId: string,
  input: WorkOrderCompletionRequest,
): string {
  const canonicalRequest = JSON.stringify([
    'work-order-completion-v1',
    context.organizationId,
    context.facilityId,
    workOrderId,
    actorUserId,
    staffProfileId,
    input.expectedVersion,
    input.noteSource,
    input.noteText ?? null,
    completionVoiceSubmissionId(input),
    input.reasonCode,
    normalizedCompletionChecklistCodes(input.completionChecklist),
  ]);
  return createHash('sha256').update(canonicalRequest).digest('hex');
}

function completionMatches(
  completion: {
    readonly organizationId: string;
    readonly facilityId: string;
    readonly workOrderId: string;
    readonly submittedByStaffProfileId: string;
    readonly noteSource: string;
    readonly noteText: string | null;
    readonly voiceSubmissionId: string | null;
    readonly completionChecklist: Prisma.JsonValue;
  } | null,
  context: M03FacilityContext,
  workOrderId: string,
  staffProfileId: string,
  input: WorkOrderCompletionRequest,
): boolean {
  return completion !== null &&
    completion.organizationId === context.organizationId &&
    completion.facilityId === context.facilityId &&
    completion.workOrderId === workOrderId &&
    completion.submittedByStaffProfileId === staffProfileId &&
    completion.noteSource === input.noteSource &&
    completion.noteText === (input.noteText ?? null) &&
    completion.voiceSubmissionId === completionVoiceSubmissionId(input) &&
    persistedCompletionChecklistMatches(completion.completionChecklist, input.completionChecklist);
}

function completionVoiceSubmissionId(input: WorkOrderCompletionRequest): string | null {
  return input.noteSource === 'VOICE' ? input.voiceSubmissionId : null;
}

function isJsonRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ratingMatches(
  rating: {
    readonly organizationId: string;
    readonly facilityId: string;
    readonly elderId: string;
    readonly workOrderId: string;
    readonly raterUserId: string;
    readonly actorType: string;
    readonly score: number;
    readonly comment: string | null;
    readonly requiresFollowUp: boolean;
  },
  context: M03FacilityContext,
  elderId: string,
  workOrderId: string,
  raterUserId: string,
  input: RatingCreateRequest,
): boolean {
  return rating.organizationId === context.organizationId &&
    rating.facilityId === context.facilityId &&
    rating.elderId === elderId &&
    rating.workOrderId === workOrderId &&
    rating.raterUserId === raterUserId &&
    rating.actorType === 'ELDER' &&
    rating.score === input.score &&
    rating.comment === (input.comment ?? null) &&
    rating.requiresFollowUp === input.requiresFollowUp;
}

function ratingRequestFingerprint(
  context: M03FacilityContext,
  elderId: string,
  workOrderId: string,
  raterUserId: string,
  input: RatingCreateRequest,
): string {
  const canonicalRequest = JSON.stringify([
    'rating-submission-v1',
    context.organizationId,
    context.facilityId,
    elderId,
    workOrderId,
    raterUserId,
    'ELDER',
    input.expectedWorkOrderVersion,
    input.score,
    input.comment ?? null,
    input.requiresFollowUp,
  ]);
  return createHash('sha256').update(canonicalRequest).digest('hex');
}

function ratingReplayEventMatches(
  event: CompletionReplayRecord | null,
  context: M03FacilityContext,
  ratingId: string,
  actorUserId: string,
  requestFingerprint: string,
): boolean {
  return event !== null &&
    event.facilityId === context.facilityId &&
    event.aggregateType === 'RATING' &&
    event.aggregateId === ratingId &&
    event.actorId === actorUserId &&
    isJsonRecord(event.payload) &&
    event.payload['requestFingerprint'] === requestFingerprint;
}

function pageInfo(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
