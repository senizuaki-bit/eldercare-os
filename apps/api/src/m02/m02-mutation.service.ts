import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import type { M02FacilityContext } from './m02-context.js';

export interface M02MutationRecord {
  readonly action: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly resourceType: string;
  readonly reasonCode?: string;
  readonly payload?: Readonly<Record<string, Prisma.JsonValue>>;
  readonly elderTimeline?: {
    readonly elderId: string;
    readonly visibility: 'ELDER_VISIBLE' | 'FAMILY_ELIGIBLE' | 'INTERNAL';
    readonly safeSummaryCode: string;
    readonly safeMetadata?: Readonly<Record<string, Prisma.JsonValue>>;
  };
}

@Injectable()
export class M02MutationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async record(
    transaction: Prisma.TransactionClient,
    context: M02FacilityContext,
    session: AuthenticatedSession,
    mutation: M02MutationRecord,
  ): Promise<void> {
    if (!isCanonicalEventType(mutation.eventType)) {
      throw new Error('M02 event types must use canonical uppercase dotted names');
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
        metadata: { source: 'm02-api' },
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
        idempotencyKey: createOutboxIdempotencyKey(
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
        privacyClass: mutation.elderTimeline === undefined ? 'OPERATIONS' : 'SENSITIVE',
      },
    });
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function createEventId(now = Date.now(), entropy = randomBytes(16)): string {
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

export function isCanonicalEventType(value: string): boolean {
  return /^[A-Z][A-Z0-9_.]+$/.test(value);
}

export function createOutboxIdempotencyKey(
  correlationId: string,
  eventType: string,
  aggregateId: string,
  aggregateVersion: number,
): string {
  const canonicalInput = JSON.stringify([
    'm02-outbox-v1',
    correlationId,
    eventType,
    aggregateId,
    aggregateVersion,
  ]);
  return `m02-v1:${createHash('sha256').update(canonicalInput).digest('hex')}`;
}
