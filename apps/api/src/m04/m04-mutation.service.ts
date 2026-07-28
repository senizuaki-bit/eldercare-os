import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import { createEventId, isCanonicalEventType } from '../m02/m02-mutation.service.js';
import type { M04FacilityContext } from './m04-context.service.js';

export interface M04MutationActor {
  readonly type: 'USER' | 'SYSTEM' | 'DEVICE' | 'AGENT';
  readonly id: string;
  readonly userId?: string;
}

export interface M04MutationRecord {
  readonly action: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly resourceType: string;
  readonly reasonCode?: string;
  readonly idempotencyKey?: string;
  readonly causationId?: string;
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
export class M04MutationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async record(
    transaction: Prisma.TransactionClient,
    context: M04FacilityContext,
    actor: M04MutationActor,
    mutation: M04MutationRecord,
    occurredAt: Date = new Date(),
  ): Promise<void> {
    if (!isCanonicalEventType(mutation.eventType)) {
      throw new Error('M04 event types must use canonical uppercase dotted names');
    }

    await this.audit.record(
      {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: actor.userId ?? null,
        actorType: actor.type === 'USER' ? 'USER' : 'SYSTEM',
        action: mutation.action,
        outcome: 'SUCCESS',
        resourceType: mutation.resourceType,
        resourceId: mutation.aggregateId,
        reasonCode: mutation.reasonCode,
        correlationId: context.correlationId,
        occurredAt,
        metadata: { source: `m04-${actor.type.toLowerCase()}` },
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
          actorUserId: actor.userId ?? null,
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
        actorType: actor.type,
        actorId: actor.id,
        correlationId: context.correlationId,
        causationId: mutation.causationId,
        idempotencyKey:
          mutation.idempotencyKey ??
          createM04OutboxKey(
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
        privacyClass:
          mutation.privacyClass ??
          (mutation.elderTimeline === undefined ? 'OPERATIONS' : 'SENSITIVE'),
      },
    });
  }

  async auditOnly(
    transaction: Prisma.TransactionClient,
    context: M04FacilityContext,
    actor: M04MutationActor,
    mutation: Omit<M04MutationRecord, 'eventType'> & {
      readonly timelineEventType?: string;
    },
    occurredAt: Date = new Date(),
  ): Promise<void> {
    await this.audit.record(
      {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: actor.userId ?? null,
        actorType: actor.type === 'USER' ? 'USER' : 'SYSTEM',
        action: mutation.action,
        outcome: 'SUCCESS',
        resourceType: mutation.resourceType,
        resourceId: mutation.aggregateId,
        reasonCode: mutation.reasonCode,
        correlationId: context.correlationId,
        occurredAt,
        metadata: { source: `m04-${actor.type.toLowerCase()}` },
      },
      transaction,
    );

    if (
      mutation.elderTimeline !== undefined &&
      mutation.timelineEventType !== undefined
    ) {
      await transaction.elderTimelineEntry.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: mutation.elderTimeline.elderId,
          eventType: mutation.timelineEventType,
          sourceResourceType: mutation.resourceType,
          sourceResourceId: mutation.aggregateId,
          visibility: mutation.elderTimeline.visibility,
          safeSummaryCode: mutation.elderTimeline.safeSummaryCode,
          safeMetadata: mutation.elderTimeline.safeMetadata ?? {},
          actorUserId: actor.userId ?? null,
          correlationId: context.correlationId,
          occurredAt,
        },
      });
    }
  }
}

export function createM04OutboxKey(
  correlationId: string,
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
): string {
  const value = JSON.stringify([
    'm04-outbox-v1',
    correlationId,
    eventType,
    aggregateId,
    aggregateVersion,
  ]);
  return `m04-v1:${createHash('sha256').update(value).digest('hex')}`;
}

export function createM04FamilyProviderKey(
  organizationId: string,
  emergencyEventId: string,
  familyRelationshipId: string,
  stage: string,
  channel: string,
): string {
  const value = JSON.stringify([
    organizationId,
    emergencyEventId,
    familyRelationshipId,
    stage,
    channel,
  ]);
  return `m04-family-v1:${createHash('sha256').update(value).digest('hex')}`;
}
