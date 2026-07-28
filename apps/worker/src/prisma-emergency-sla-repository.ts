import { randomBytes } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
} from '@eldercare/db';
import { buildM04EmergencyEventData } from '@eldercare/events';
import type { EmergencyNotificationReceipt } from './fake-emergency-notification.js';
import type {
  CancelledEmergencyEscalation,
  EmergencyCancellationCursor,
  EmergencyEscalationClaim,
  EmergencySlaRepository,
  PendingEmergencyEscalation,
} from './emergency-sla.js';

const RETRYABLE_STATUSES = ['SCHEDULED', 'FAILED'] as const;

export class PrismaEmergencySlaRepository implements EmergencySlaRepository {
  constructor(private readonly database: PrismaClient) {}

  async listPending(limit: number): Promise<readonly PendingEmergencyEscalation[]> {
    const rows = await this.database.emergencyEscalation.findMany({
      where: { status: { in: [...RETRYABLE_STATUSES] } },
      include: {
        emergencyEvent: {
          select: {
            id: true,
            organizationId: true,
            facilityId: true,
          },
        },
        escalationStep: { select: { reasonCode: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), 2_000),
    });

    return rows.map((row) => ({
      id: row.id,
      emergencyEventId: row.emergencyEvent.id,
      organizationId: row.emergencyEvent.organizationId,
      facilityId: row.emergencyEvent.facilityId,
      stage: row.stage,
      reasonCode: row.escalationStep.reasonCode,
      basisTransitionVersion: row.basisTransitionVersion,
      dueAt: row.dueAt,
    }));
  }

  async listCancelled(
    after: EmergencyCancellationCursor,
    limit: number,
  ): Promise<readonly CancelledEmergencyEscalation[]> {
    const rows = await this.database.emergencyEscalation.findMany({
      where: {
        status: 'CANCELLED',
        cancelledAt: { not: null },
        OR: [
          { cancelledAt: { gt: after.cancelledAt } },
          {
            cancelledAt: after.cancelledAt,
            id: { gt: after.id },
          },
        ],
      },
      select: {
        id: true,
        cancelledAt: true,
      },
      orderBy: [{ cancelledAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), 2_000),
    });
    return rows.flatMap((row) =>
      row.cancelledAt === null
        ? []
        : [{ id: row.id, cancelledAt: row.cancelledAt }],
    );
  }

  async prepareDelivery(
    escalationId: string,
    now: Date,
  ): Promise<EmergencyEscalationClaim | null> {
    return this.database.$transaction(
      async (transaction) => {
        const row = await transaction.emergencyEscalation.findUnique({
          where: { id: escalationId },
          include: {
            emergencyEvent: {
              select: {
                id: true,
                organizationId: true,
                facilityId: true,
                elderId: true,
                status: true,
                version: true,
                onSiteAt: true,
                resolvedAt: true,
                correlationId: true,
              },
            },
            escalationStep: { select: { reasonCode: true } },
          },
        });
        if (
          row === null ||
          !RETRYABLE_STATUSES.includes(
            row.status as (typeof RETRYABLE_STATUSES)[number],
          ) ||
          row.dueAt.getTime() > now.getTime()
        ) {
          return null;
        }

        if (!stageStillOutstanding(row.stage, row.emergencyEvent)) {
          await transaction.emergencyEscalation.updateMany({
            where: { id: row.id, status: { in: [...RETRYABLE_STATUSES] } },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              lastErrorCode: null,
            },
          });
          return null;
        }

        return {
          id: row.id,
          emergencyEventId: row.emergencyEvent.id,
          organizationId: row.emergencyEvent.organizationId,
          facilityId: row.emergencyEvent.facilityId,
          elderId: row.emergencyEvent.elderId,
          status: row.emergencyEvent.status,
          stage: row.stage,
          reasonCode: row.escalationStep.reasonCode,
          basisTransitionVersion: row.basisTransitionVersion,
          dueAt: row.dueAt,
          notificationIdempotencyKey: row.idempotencyKey,
          aggregateVersion: row.emergencyEvent.version,
          correlationId: row.emergencyEvent.correlationId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async completeDelivery(
    claim: EmergencyEscalationClaim,
    receipt: EmergencyNotificationReceipt,
  ): Promise<void> {
    await this.database.$transaction(
      async (transaction) => {
        const changed = await transaction.emergencyEscalation.updateMany({
          where: {
            id: claim.id,
            organizationId: claim.organizationId,
            facilityId: claim.facilityId,
            status: { in: [...RETRYABLE_STATUSES] },
          },
          data: {
            status: 'TRIGGERED',
            triggeredAt: receipt.deliveredAt,
            lastErrorCode: null,
          },
        });
        if (changed.count === 0) return;

        await transaction.outboxEvent.create({
          data: {
            eventId: createEventId(receipt.deliveredAt.getTime()),
            eventType: 'EMERGENCY.ESCALATED',
            schemaVersion: '1.0',
            organizationId: claim.organizationId,
            facilityId: claim.facilityId,
            aggregateType: 'EMERGENCY_EVENT',
            aggregateId: claim.emergencyEventId,
            aggregateVersion: claim.aggregateVersion,
            actorType: 'SYSTEM',
            actorId: 'emergency-sla-v1',
            correlationId: claim.correlationId,
            idempotencyKey: claim.notificationIdempotencyKey,
            occurredAt: receipt.deliveredAt,
            payload: {
              ...buildM04EmergencyEventData({
                emergencyId: claim.emergencyEventId,
                elderId: claim.elderId,
                status: claim.status,
                version: claim.aggregateVersion,
                reasonCode: claim.reasonCode,
                slaStage: claim.stage,
              }),
            },
            privacyClass: 'OPERATIONS',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async recordDeliveryFailure(
    claim: EmergencyEscalationClaim,
    reasonCode: string,
  ): Promise<void> {
    await this.database.emergencyEscalation.updateMany({
      where: {
        id: claim.id,
        organizationId: claim.organizationId,
        facilityId: claim.facilityId,
        status: { in: [...RETRYABLE_STATUSES] },
      },
      data: {
        status: 'FAILED',
        lastErrorCode: reasonCode,
      },
    });
  }
}

interface CurrentEmergencyState {
  readonly status: 'OPEN' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED';
  readonly onSiteAt: Date | null;
  readonly resolvedAt: Date | null;
}

export function stageStillOutstanding(
  stage: 'ACKNOWLEDGEMENT' | 'ARRIVAL' | 'RESOLUTION',
  event: CurrentEmergencyState,
): boolean {
  switch (stage) {
    case 'ACKNOWLEDGEMENT':
      return event.status === 'OPEN';
    case 'ARRIVAL':
      return (
        event.onSiteAt === null &&
        event.status !== 'RESOLVED' &&
        event.status !== 'REVIEWED'
      );
    case 'RESOLUTION':
      return (
        event.resolvedAt === null &&
        event.status !== 'RESOLVED' &&
        event.status !== 'REVIEWED'
      );
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function createEventId(now = Date.now(), entropy = randomBytes(16)): string {
  let timestamp = Math.max(0, Math.floor(now));
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = `${CROCKFORD[timestamp % 32] ?? '0'}${timePart}`;
    timestamp = Math.floor(timestamp / 32);
  }
  let randomPart = '';
  for (let index = 0; index < 16; index += 1) {
    randomPart += CROCKFORD[(entropy[index % entropy.length] ?? 0) & 31] ?? '0';
  }
  return `${timePart}${randomPart}`;
}
