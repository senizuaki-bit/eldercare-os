import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ManualNeedCreateRequest,
  type NeedReviewRequest,
  type NeedsQuery,
} from '@eldercare/contracts';
import { M03_PERMISSIONS } from '@eldercare/authz';
import type { Prisma } from '@eldercare/db';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import { hasActiveElderOwnedAccess } from './elder-current-access.js';
import { mapNeed, mapNeedWithElder, NEED_INCLUDE } from './m03-mappers.js';
import { m03Conflict } from './m03-errors.js';
import { M03MutationService } from './m03-mutation.service.js';

interface WorkOrderSeed {
  readonly id: string;
  readonly elderId: string;
  readonly summary: string;
  readonly priority: 'ROUTINE' | 'PRIORITY' | 'IMMEDIATE_REVIEW';
}

@Injectable()
export class NeedsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(M03MutationService) private readonly mutations: M03MutationService,
  ) {}

  async list(context: M03FacilityContext, query: NeedsQuery) {
    const where: Prisma.NeedWhereInput = {
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      ...(query.elderId === undefined ? {} : { elderId: query.elderId }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.priority === undefined ? {} : { priority: query.priority }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.requiresHumanReview === undefined ? {} : { requiresHumanReview: query.requiresHumanReview }),
      ...(query.search === undefined
        ? {}
        : { OR: [
            { summary: { contains: query.search, mode: 'insensitive' } },
            { elder: { displayName: { contains: query.search, mode: 'insensitive' } } },
            { elder: { recordNumber: { contains: query.search, mode: 'insensitive' } } },
          ] }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.need.count({ where }),
      this.database.client.need.findMany({
        where,
        include: NEED_INCLUDE,
        orderBy: [{ [query.sort]: query.direction }, { id: query.direction }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: records.map(mapNeedWithElder),
      pageInfo: pageInfo(query.page, query.pageSize, total),
    };
  }

  async get(context: M03FacilityContext, needId: string) {
    const record = await this.database.client.need.findFirst({
      where: { id: needId, organizationId: context.organizationId, facilityId: context.facilityId },
      include: NEED_INCLUDE,
    });
    if (record === null) throw resourceNotFound();
    return mapNeedWithElder(record);
  }

  async createManual(
    context: M03FacilityContext,
    input: ManualNeedCreateRequest,
    session: AuthenticatedSession,
  ) {
    try {
      const created = await this.database.client.$transaction(async (tx) => {
        const now = new Date();
        await this.assertCurrentMutationAccess(
          tx,
          context,
          session.userId,
          M03_PERMISSIONS.NEED_CREATE,
          now,
        );
        await this.assertActiveElderStay(tx, context, input.elderId, now);
        const existing = await tx.need.findFirst({
          where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
        });
        if (existing !== null) {
          return this.replayManualNeed(tx, context, existing, input, session);
        }
        return this.createManualRecordInTransaction(tx, context, input, session);
      }, { isolationLevel: 'Serializable' });
      return mapNeed(created);
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const repeated = await this.database.client.$transaction(async (tx) => {
          const now = new Date();
          await this.assertCurrentMutationAccess(
            tx,
            context,
            session.userId,
            M03_PERMISSIONS.NEED_CREATE,
            now,
          );
          await this.assertActiveElderStay(tx, context, input.elderId, now);
          const repeated = await tx.need.findFirst({
            where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
          });
          if (repeated === null) throw m03Conflict('NEED_WRITE_CONFLICT');
          return this.replayManualNeed(tx, context, repeated, input, session);
        }, { isolationLevel: 'Serializable' });
        return mapNeed(repeated);
      }
      if (isPrismaCode(error, 'P2034')) throw m03Conflict('NEED_WRITE_CONFLICT');
      throw error;
    }
  }

  async createElderOwnedManual(
    context: M03FacilityContext,
    input: ManualNeedCreateRequest,
    session: AuthenticatedSession,
    requiredPermission:
      | typeof M03_PERMISSIONS.NEED_CREATE
      | typeof M03_PERMISSIONS.VOICE_SUBMISSION_CREATE = M03_PERMISSIONS.NEED_CREATE,
  ) {
    try {
      const created = await this.database.client.$transaction(
        (tx) => this.createElderOwnedManualInTransaction(
          tx,
          context,
          input,
          session,
          requiredPermission,
        ),
        { isolationLevel: 'Serializable' },
      );
      return mapNeed(created);
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const repeated = await this.database.client.$transaction(async (tx) => {
          const now = new Date();
          const accessActive = await hasActiveElderOwnedAccess(
            tx,
            context,
            input.elderId,
            session.userId,
            now,
            requiredPermission,
          );
          if (!accessActive) throw resourceNotFound();
          const existing = await tx.need.findFirst({
            where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
          });
          if (existing === null) throw m03Conflict('NEED_WRITE_CONFLICT');
          return this.replayManualNeed(tx, context, existing, input, session);
        }, { isolationLevel: 'Serializable' });
        return mapNeed(repeated);
      }
      if (isPrismaCode(error, 'P2034')) throw m03Conflict('NEED_WRITE_CONFLICT');
      throw error;
    }
  }

  async createElderOwnedManualInTransaction(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    input: ManualNeedCreateRequest,
    session: AuthenticatedSession,
    requiredPermission:
      | typeof M03_PERMISSIONS.NEED_CREATE
      | typeof M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
  ): Promise<Prisma.NeedGetPayload<Record<string, never>>> {
    const now = new Date();
    const accessActive = await hasActiveElderOwnedAccess(
      tx,
      context,
      input.elderId,
      session.userId,
      now,
      requiredPermission,
    );
    if (!accessActive) throw resourceNotFound();
    const existing = await tx.need.findFirst({
      where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
    });
    if (existing !== null) return this.replayManualNeed(tx, context, existing, input, session);
    return this.createManualRecordInTransaction(tx, context, input, session);
  }

  private async createManualRecordInTransaction(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    input: ManualNeedCreateRequest,
    session: AuthenticatedSession,
  ): Promise<Prisma.NeedGetPayload<Record<string, never>>> {
    const need = await tx.need.create({
      data: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: input.elderId,
        source: 'MANUAL',
        summary: input.summary,
        category: input.category,
        urgencySuggestion: input.priority,
        priority: input.priority,
        requiresHumanReview: input.requiresHumanReview,
        safetyRuleCodes: [],
        status: input.requiresHumanReview ? 'REVIEW_REQUIRED' : 'CONFIRMED',
        reviewedByUserId: input.requiresHumanReview ? null : session.userId,
        reviewedAt: input.requiresHumanReview ? null : new Date(),
        reviewReasonCode: input.requiresHumanReview ? null : input.reasonCode,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      },
    });
    await this.recordNeedCreated(
      tx,
      context,
      session,
      need,
      input.idempotencyKey,
      manualNeedRequestFingerprint(input),
    );
    if (!input.requiresHumanReview) {
      await this.createInitialWorkOrder(tx, context, session, {
        id: need.id,
        elderId: need.elderId,
        summary: need.summary,
        priority: need.priority,
      }, `manual-need:${need.id}`);
    }
    return need;
  }

  private async replayManualNeed(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    existing: Prisma.NeedGetPayload<Record<string, never>>,
    input: ManualNeedCreateRequest,
    session: AuthenticatedSession,
  ) {
    const [creation, workOrder] = await Promise.all([
      tx.outboxEvent.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          eventType: 'NEED.CREATED',
          aggregateType: 'NEED',
          aggregateId: existing.id,
          idempotencyKey: `need:${input.idempotencyKey}`,
        },
        select: { actorId: true, payload: true },
      }),
      input.requiresHumanReview
        ? Promise.resolve(null)
        : tx.workOrder.findFirst({
            where: {
              organizationId: context.organizationId,
              facilityId: context.facilityId,
              primaryNeedId: existing.id,
            },
            select: { id: true },
          }),
    ]);
    if (
      existing.facilityId !== context.facilityId ||
      existing.elderId !== input.elderId ||
      existing.source !== 'MANUAL' ||
      creation === null ||
      creation.actorId !== session.userId
    ) {
      throw resourceNotFound();
    }
    const payload = jsonRecord(creation.payload);
    if (payload?.['requestFingerprint'] !== manualNeedRequestFingerprint(input)) {
      throw m03Conflict('NEED_IDEMPOTENCY_FINGERPRINT_MISMATCH');
    }
    if (!input.requiresHumanReview && workOrder === null) {
      throw m03Conflict('MANUAL_NEED_WORK_ORDER_MISSING');
    }
    return existing;
  }

  async review(
    context: M03FacilityContext,
    needId: string,
    input: NeedReviewRequest,
    session: AuthenticatedSession,
  ) {
    try {
      await this.database.client.$transaction(async (tx) => {
        const now = new Date();
        await this.assertCurrentMutationAccess(
          tx,
          context,
          session.userId,
          M03_PERMISSIONS.NEED_REVIEW,
          now,
        );
        const current = await tx.need.findFirst({
          where: { id: needId, organizationId: context.organizationId, facilityId: context.facilityId },
          include: { primaryWorkOrder: true },
        });
        if (current === null) throw resourceNotFound();
        if (!['DRAFT', 'REVIEW_REQUIRED'].includes(current.status)) throw m03Conflict('NEED_ALREADY_REVIEWED');
        if (current.version !== input.expectedVersion) throw m03Conflict('NEED_VERSION_CONFLICT');
        if (current.primaryWorkOrder !== null && current.primaryWorkOrder.status !== 'NEW') {
          throw m03Conflict('WORK_ORDER_ALREADY_ACTIVE');
        }
        // A stale draft may still be rejected after discharge so staff can safely
        // close it. Confirmation creates or revises a service and therefore
        // requires the elder to be actively staying in this facility right now.
        if (input.decision === 'CONFIRM') {
          await this.assertActiveElderStay(tx, context, current.elderId, now);
        }
        const nextStatus = input.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED';
        const changed = await tx.need.updateMany({
          where: { id: current.id, version: input.expectedVersion, status: { in: ['DRAFT', 'REVIEW_REQUIRED'] } },
          data: {
            status: nextStatus,
            summary: input.summary ?? current.summary,
            category: input.category ?? current.category,
            priority: input.priority ?? current.priority,
            reviewedByUserId: session.userId,
            reviewedAt: new Date(),
            reviewReasonCode: input.reasonCode,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw m03Conflict('NEED_VERSION_CONFLICT');

      await this.mutations.record(tx, context, session, {
        action: 'NEED.REVIEW',
        eventType: 'NEED.REVIEWED',
        aggregateType: 'NEED',
        aggregateId: current.id,
        aggregateVersion: input.expectedVersion + 1,
        resourceType: 'NEED',
        reasonCode: input.reasonCode,
        payload: { needId: current.id, status: nextStatus, version: input.expectedVersion + 1 },
        elderTimeline: {
          elderId: current.elderId,
          visibility: 'INTERNAL',
          safeSummaryCode: `NEED_${nextStatus}`,
          safeMetadata: { needId: current.id },
        },
      });

      if (input.decision === 'CONFIRM' && current.primaryWorkOrder === null) {
        await this.createInitialWorkOrder(tx, context, session, {
          id: current.id,
          elderId: current.elderId,
          summary: input.summary ?? current.summary,
          priority: input.priority ?? current.priority,
        }, `need-review:${current.id}`);
      }
      if (input.decision === 'CONFIRM' && current.primaryWorkOrder?.status === 'NEW') {
        const workOrder = current.primaryWorkOrder;
        const revised = await tx.workOrder.updateMany({
          where: { id: workOrder.id, status: 'NEW', version: workOrder.version },
          data: {
            title: workOrderTitle(input.priority),
            summary: input.summary,
            priority: input.priority,
            dueAt: new Date(Date.now() + dueMinutes(input.priority) * 60_000),
            version: { increment: 1 },
          },
        });
        if (revised.count !== 1) throw m03Conflict('WORK_ORDER_ALREADY_ACTIVE');
        await this.mutations.record(tx, context, session, {
          action: 'WORK_ORDER.REVISE',
          eventType: 'WORK_ORDER.REVISED',
          aggregateType: 'WORK_ORDER',
          aggregateId: workOrder.id,
          aggregateVersion: workOrder.version + 1,
          resourceType: 'WORK_ORDER',
          reasonCode: input.reasonCode,
          payload: {
            workOrderId: workOrder.id,
            needId: current.id,
            status: 'NEW',
            version: workOrder.version + 1,
          },
          elderTimeline: {
            elderId: current.elderId,
            visibility: 'INTERNAL',
            safeSummaryCode: 'WORK_ORDER_REVISED_AFTER_REVIEW',
            safeMetadata: { workOrderId: workOrder.id },
          },
        });
      }
      if (input.decision === 'REJECT' && current.primaryWorkOrder?.status === 'NEW') {
        const workOrder = current.primaryWorkOrder;
        const now = new Date();
        const cancelled = await tx.workOrder.updateMany({
          where: { id: workOrder.id, status: 'NEW', version: workOrder.version },
          data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } },
        });
        if (cancelled.count !== 1) throw m03Conflict('WORK_ORDER_ALREADY_ACTIVE');
        await tx.workOrderTransition.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            workOrderId: workOrder.id,
            fromStatus: 'NEW',
            toStatus: 'CANCELLED',
            fromVersion: workOrder.version,
            toVersion: workOrder.version + 1,
            actorUserId: session.userId,
            reasonCode: input.reasonCode,
            correlationId: context.correlationId,
            occurredAt: now,
          },
        });
        await this.mutations.record(tx, context, session, {
          action: 'WORK_ORDER.CANCEL',
          eventType: 'WORK_ORDER.CANCELLED',
          aggregateType: 'WORK_ORDER',
          aggregateId: workOrder.id,
          aggregateVersion: workOrder.version + 1,
          resourceType: 'WORK_ORDER',
          reasonCode: input.reasonCode,
          payload: { workOrderId: workOrder.id, status: 'CANCELLED', version: workOrder.version + 1 },
        });
      }
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isPrismaCode(error, 'P2034')) throw m03Conflict('NEED_VERSION_CONFLICT');
      throw error;
    }
    return this.get(context, needId);
  }

  private async assertCurrentMutationAccess(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    userId: string,
    permission: typeof M03_PERMISSIONS.NEED_CREATE | typeof M03_PERMISSIONS.NEED_REVIEW,
    now: Date,
  ): Promise<void> {
    const [assignment, facility] = await Promise.all([
      tx.userRole.findFirst({
        where: currentNeedMutationRoleWhere(context, userId, permission, now),
        select: { id: true },
      }),
      tx.facility.findFirst({
        where: {
          id: context.facilityId,
          organizationId: context.organizationId,
          status: 'ACTIVE',
          organization: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
    ]);
    if (assignment === null || facility === null) throw resourceNotFound();
  }

  private async assertActiveElderStay(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    elderId: string,
    now: Date,
  ): Promise<{ readonly id: string }> {
    const elder = await tx.elder.findFirst({
      where: {
        id: elderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
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
    });
    if (elder === null) throw resourceNotFound();
    return elder;
  }

  async createInitialWorkOrder(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    session: AuthenticatedSession,
    need: WorkOrderSeed,
    idempotencyKey: string,
  ): Promise<Prisma.WorkOrderGetPayload<Record<string, never>>> {
    const existing = await tx.workOrder.findFirst({
      where: { organizationId: context.organizationId, idempotencyKey },
    });
    if (existing !== null) return existing;
    const dueAt = new Date(Date.now() + dueMinutes(need.priority) * 60_000);
    const created = await tx.workOrder.create({
      data: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: need.elderId,
        primaryNeedId: need.id,
        code: workOrderCode(need.id),
        title: workOrderTitle(need.priority),
        summary: need.summary,
        priority: need.priority,
        status: 'NEW',
        dueAt,
        createdByUserId: session.userId,
        idempotencyKey,
        correlationId: context.correlationId,
      },
    });
    await tx.workOrderTransition.create({
      data: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        workOrderId: created.id,
        fromStatus: null,
        toStatus: 'NEW',
        fromVersion: 0,
        toVersion: 1,
        actorUserId: session.userId,
        reasonCode: 'NEED_CONFIRMED_FOR_SERVICE',
        correlationId: context.correlationId,
        occurredAt: created.createdAt,
      },
    });
    await this.mutations.record(tx, context, session, {
      action: 'WORK_ORDER.CREATE',
      eventType: 'WORK_ORDER.CREATED',
      aggregateType: 'WORK_ORDER',
      aggregateId: created.id,
      aggregateVersion: 1,
      resourceType: 'WORK_ORDER',
      idempotencyKey: `work-order:${idempotencyKey}`,
      payload: { workOrderId: created.id, status: 'NEW', version: 1 },
      elderTimeline: {
        elderId: need.elderId,
        visibility: 'ELDER_VISIBLE',
        safeSummaryCode: 'WORK_ORDER_CREATED',
        safeMetadata: { workOrderId: created.id },
      },
    });
    return created;
  }

  async recordNeedCreated(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    session: AuthenticatedSession,
    need: { id: string; elderId: string; version: number; requiresHumanReview: boolean },
    idempotencyKey?: string,
    requestFingerprint?: string,
  ): Promise<void> {
    await this.mutations.record(tx, context, session, {
      action: 'NEED.CREATE',
      eventType: 'NEED.CREATED',
      aggregateType: 'NEED',
      aggregateId: need.id,
      aggregateVersion: need.version,
      resourceType: 'NEED',
      idempotencyKey: idempotencyKey === undefined ? undefined : `need:${idempotencyKey}`,
      payload: {
        needId: need.id,
        version: need.version,
        ...(requestFingerprint === undefined ? {} : { requestFingerprint }),
      },
      elderTimeline: {
        elderId: need.elderId,
        visibility: 'INTERNAL',
        safeSummaryCode: 'NEED_CREATED',
        safeMetadata: { needId: need.id },
      },
    });
    if (need.requiresHumanReview) {
      await this.mutations.record(tx, context, session, {
        action: 'NEED.REVIEW_REQUIRED',
        eventType: 'NEED.REVIEW_REQUIRED',
        aggregateType: 'NEED',
        aggregateId: need.id,
        aggregateVersion: need.version,
        resourceType: 'NEED',
        idempotencyKey: idempotencyKey === undefined ? undefined : `need-review:${idempotencyKey}`,
        payload: { needId: need.id, version: need.version },
      });
    }
  }
}

function currentNeedMutationRoleWhere(
  context: M03FacilityContext,
  userId: string,
  permission: typeof M03_PERMISSIONS.NEED_CREATE | typeof M03_PERMISSIONS.NEED_REVIEW,
  now: Date,
): Prisma.UserRoleWhereInput {
  return {
    userId,
    user: { status: 'ACTIVE' },
    organization: { status: 'ACTIVE' },
    activeFrom: { lte: now },
    revokedAt: null,
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        role: {
          rolePermissions: {
            some: { permission: { code: permission } },
          },
        },
      },
      {
        dataScopes: {
          some: {
            validFrom: { lte: now },
            AND: [
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
              {
                OR: [
                  { kind: 'PLATFORM' },
                  { kind: 'ORGANIZATION', organizationId: context.organizationId },
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
  };
}

function dueMinutes(priority: WorkOrderSeed['priority']): number {
  if (priority === 'IMMEDIATE_REVIEW') return 10;
  if (priority === 'PRIORITY') return 30;
  return 120;
}

function workOrderTitle(priority: WorkOrderSeed['priority']): string {
  return priority === 'ROUTINE' ? '生活服务请求' : '优先照护与状态查看';
}

function workOrderCode(needId: string): string {
  return `WO-${needId.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

function pageInfo(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

export function manualNeedRequestFingerprint(input: ManualNeedCreateRequest): string {
  const canonical = JSON.stringify([
    'm03-manual-need-v1',
    input.elderId,
    input.summary,
    input.category,
    input.priority,
    input.requiresHumanReview,
    input.reasonCode,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function jsonRecord(value: Prisma.JsonValue): Readonly<Record<string, Prisma.JsonValue>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, Prisma.JsonValue>>)
    : null;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
