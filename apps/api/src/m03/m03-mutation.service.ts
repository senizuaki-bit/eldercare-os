import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { createEventId, isCanonicalEventType } from '../m02/m02-mutation.service.js';
import type { M03FacilityContext } from './m03-context.service.js';

export interface M03MutationRecord {
  readonly action: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly resourceType: string;
  readonly reasonCode?: string;
  readonly idempotencyKey?: string;
  readonly privacyClass?: 'OPERATIONS' | 'SENSITIVE' | 'HIGHLY_SENSITIVE';
  readonly payload?: Readonly<Record<string, Prisma.JsonValue>>;
  readonly elderTimeline?: {
    readonly elderId: string;
    readonly visibility: 'ELDER_VISIBLE' | 'FAMILY_ELIGIBLE' | 'INTERNAL';
    readonly safeSummaryCode: string;
    readonly safeMetadata?: Readonly<Record<string, Prisma.JsonValue>>;
  };
}

@Injectable()
export class M03MutationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async record(
    transaction: Prisma.TransactionClient,
    context: M03FacilityContext,
    session: AuthenticatedSession,
    mutation: M03MutationRecord,
  ): Promise<void> {
    if (!isCanonicalEventType(mutation.eventType)) {
      throw new Error('M03 event types must use canonical uppercase dotted names');
    }
    const occurredAt = new Date();
    await this.audit.record(
      {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: mutation.action,
        outcome: 'SUCCESS',
        resourceType: mutation.resourceType,
        resourceId: mutation.aggregateId,
        reasonCode: mutation.reasonCode,
        correlationId: context.correlationId,
        occurredAt,
        metadata: { source: 'm03-api' },
      },
      transaction,
    );

    if (mutation.elderTimeline !== undefined) {
      await transaction.elderTimelineEntry.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: mutation.elderTimeline.elderId,
          eventType: mutation.eventType,
          sourceResourceType: mutation.resourceType,
          sourceResourceId: mutation.aggregateId,
          visibility: mutation.elderTimeline.visibility,
          safeSummaryCode: mutation.elderTimeline.safeSummaryCode,
          safeMetadata: mutation.elderTimeline.safeMetadata ?? {},
          actorUserId: session.userId,
          correlationId: context.correlationId,
          occurredAt,
        },
      });
    }

    await transaction.outboxEvent.create({
      data: {
        eventId: createEventId(),
        eventType: mutation.eventType,
        schemaVersion: '1.0',
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        aggregateType: mutation.aggregateType,
        aggregateId: mutation.aggregateId,
        aggregateVersion: mutation.aggregateVersion,
        actorType: 'USER',
        actorId: session.userId,
        correlationId: context.correlationId,
        idempotencyKey: mutation.idempotencyKey ?? createM03OutboxKey(
          context.correlationId,
          mutation.eventType,
          mutation.aggregateId,
          mutation.aggregateVersion,
        ),
        occurredAt,
        payload: mutation.payload ?? {
          resourceId: mutation.aggregateId,
          version: mutation.aggregateVersion,
        },
        privacyClass: mutation.privacyClass ?? (mutation.elderTimeline === undefined ? 'OPERATIONS' : 'SENSITIVE'),
      },
    });
  }
}

export function createM03OutboxKey(
  correlationId: string,
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
): string {
  const value = JSON.stringify(['m03-outbox-v1', correlationId, eventType, aggregateId, aggregateVersion]);
  return `m03-v1:${createHash('sha256').update(value).digest('hex')}`;
}
