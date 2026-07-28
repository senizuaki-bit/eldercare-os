import { createHash, randomBytes } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
} from '@eldercare/db';
import { buildM04EmergencyEventData } from '@eldercare/events';
import { EmergencyMqttRetryableIngestionError } from './emergency-mqtt.js';
import type {
  EmergencyMqttIngestionOutcome,
  EmergencyMqttRepository,
  NormalizedEmergencyMqttSignal,
} from './emergency-mqtt.js';

export interface PrismaEmergencyMqttRepositoryOptions {
  readonly duplicateWindowSeconds: number;
  readonly locationRetentionHours: number;
}

export const EMERGENCY_LOCATION_MAX_SAMPLE_AGE_MS = 5 * 60_000;
export const EMERGENCY_LOCATION_MAX_EFFECTIVE_TTL_MS = 15 * 60_000;
export const EMERGENCY_LOCATION_MAX_FUTURE_SKEW_MS = 5 * 60_000;

export class PrismaEmergencyMqttRepository implements EmergencyMqttRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly options: PrismaEmergencyMqttRepositoryOptions,
  ) {}

  async ingest(
    signal: NormalizedEmergencyMqttSignal,
    receivedAt: Date,
  ): Promise<EmergencyMqttIngestionOutcome> {
    return this.database.$transaction(
      async (transaction) => {
        const binding = await transaction.emergencySourceBinding.findFirst({
          where: {
            externalSourceId: signal.topic.sourceId,
            sourceKind: 'IOT_BUTTON',
            active: true,
            organization: {
              slug: signal.topic.organizationSlug,
              status: 'ACTIVE',
            },
            facility: {
              code: signal.topic.facilityCode,
              status: 'ACTIVE',
            },
          },
          select: {
            id: true,
            organizationId: true,
            facilityId: true,
            elderId: true,
            externalSourceId: true,
          },
        });
        if (binding === null) {
          throw new EmergencyMqttRetryableIngestionError(
            'MQTT_EMERGENCY_BINDING_NOT_FOUND',
          );
        }

        await transaction.$queryRaw<Array<{ locked: number }>>(
          Prisma.sql`
            SELECT 1 AS "locked"
            FROM (
              SELECT pg_advisory_xact_lock(hashtextextended(${signal.sourceIdentityKey}, 0))
            ) AS acquired
          `,
        );

        const existing = await transaction.emergencySignal.findFirst({
          where: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            sourceIdentityKey: signal.sourceIdentityKey,
            externalEventId: signal.payload.eventId,
          },
          select: {
            id: true,
            emergencyEventId: true,
            requestFingerprint: true,
            correlationId: true,
          },
        });
        if (existing !== null) {
          if (existing.requestFingerprint === signal.requestFingerprint) {
            return {
              kind: 'replayed',
              emergencyEventId: existing.emergencyEventId,
            };
          }
          await transaction.auditEvent.create({
            data: {
              organizationId: binding.organizationId,
              facilityId: binding.facilityId,
              actorType: 'SYSTEM',
              action: 'emergency.iot.ingest',
              outcome: 'DENIED',
              resourceType: 'EmergencySignal',
              resourceId: existing.id,
              reasonCode: 'MQTT_EVENT_ID_FINGERPRINT_CONFLICT',
              correlationId: existing.correlationId,
              safeMetadata: { source: 'm04-mqtt', schemaVersion: '1.0' },
              occurredAt: receivedAt,
            },
          });
          return {
            kind: 'conflict',
            emergencyEventId: existing.emergencyEventId,
          };
        }

        const policy = await transaction.escalationPolicy.findFirst({
          where: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            status: 'ACTIVE',
            effectiveAt: { lte: receivedAt },
          },
          include: {
            steps: {
              orderBy: [{ stage: 'asc' }, { sequence: 'asc' }],
            },
          },
          orderBy: [{ version: 'desc' }, { effectiveAt: 'desc' }],
        });
        if (policy === null || policy.steps.length === 0) {
          throw new EmergencyMqttRetryableIngestionError(
            'MQTT_EMERGENCY_ESCALATION_POLICY_MISSING',
          );
        }

        const relatedSignal = await transaction.emergencySignal.findFirst({
          where: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            sourceIdentityKey: signal.sourceIdentityKey,
            reasonCode: signal.payload.reasonCode,
            receivedAt: {
              gte: new Date(
                receivedAt.getTime() - this.options.duplicateWindowSeconds * 1_000,
              ),
            },
          },
          select: { emergencyEventId: true },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        });
        const correlationId = mqttCorrelationId(
          signal.sourceIdentityKey,
          signal.payload.eventId,
        );
        const dueDates = policy.steps.map(
          (step) => new Date(receivedAt.getTime() + step.thresholdSeconds * 1_000),
        );
        const currentDeadlineAt = dueDates.reduce(
          (earliest, date) =>
            earliest === null || date.getTime() < earliest.getTime() ? date : earliest,
          null as Date | null,
        );
        const event = await transaction.emergencyEvent.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            elderId: binding.elderId,
            sourceKind: 'IOT_BUTTON',
            reasonCode: signal.payload.reasonCode,
            status: 'OPEN',
            version: 1,
            escalationPolicyId: policy.id,
            escalationPolicyVersion: policy.version,
            openedAt: receivedAt,
            currentDeadlineAt,
            correlationId,
          },
        });

        const signalObservedAt = normalizeEmergencySignalObservedAt(
          signal.payload.timestamp,
          receivedAt,
        );
        const signalTimestampAdjusted =
          signalObservedAt.getTime() !== Date.parse(signal.payload.timestamp);
        await transaction.emergencySignal.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            elderId: binding.elderId,
            emergencyEventId: event.id,
            sourceBindingId: binding.id,
            sourceKind: 'IOT_BUTTON',
            sourceIdentityKey: signal.sourceIdentityKey,
            externalEventId: signal.payload.eventId,
            requestFingerprint: signal.requestFingerprint,
            schemaVersion: signal.payload.schemaVersion,
            observedAt: signalObservedAt,
            receivedAt,
            reasonCode: signal.payload.reasonCode,
            correlationId,
          },
        });

        const location = await buildLocationSnapshot(
          transaction,
          binding,
          signal,
          receivedAt,
          this.options.locationRetentionHours,
        );
        await transaction.emergencyLocationSnapshot.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            elderId: binding.elderId,
            emergencyEventId: event.id,
            ...location,
            decidedAt: receivedAt,
          },
        });
        await transaction.emergencyTransition.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            emergencyEventId: event.id,
            fromStatus: null,
            toStatus: 'OPEN',
            fromVersion: 0,
            toVersion: 1,
            actorType: 'DEVICE',
            actorExternalId: binding.externalSourceId,
            reasonCode: signal.payload.reasonCode,
            correlationId,
            occurredAt: receivedAt,
          },
        });
        await transaction.emergencyEscalation.createMany({
          data: policy.steps.map((step, index) => ({
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            emergencyEventId: event.id,
            escalationStepId: step.id,
            stage: step.stage,
            status: 'SCHEDULED' as const,
            dueAt: dueDates[index] ?? receivedAt,
            basisTransitionVersion: 1,
            idempotencyKey: mqttEscalationKey(event.id, step.id, 1),
            correlationId,
          })),
        });
        await transaction.elderTimelineEntry.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            elderId: binding.elderId,
            eventType: 'EMERGENCY.OPENED',
            sourceResourceType: 'EmergencyEvent',
            sourceResourceId: event.id,
            visibility: 'INTERNAL',
            safeSummaryCode: 'EMERGENCY_OPENED',
            safeMetadata: {
              emergencyEventId: event.id,
              sourceKind: 'IOT_BUTTON',
              reasonCode: signal.payload.reasonCode,
            },
            correlationId,
            occurredAt: receivedAt,
          },
        });
        await createOutbox(
          transaction,
          {
            eventType: 'EMERGENCY.OPENED',
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            emergencyEventId: event.id,
            aggregateVersion: 1,
            actorId: binding.externalSourceId,
            correlationId,
            idempotencyKey: `m04-iot-open-v1:${signal.requestFingerprint}`,
            occurredAt: receivedAt,
            payload: {
              ...buildM04EmergencyEventData({
                emergencyId: event.id,
                elderId: binding.elderId,
                status: 'OPEN',
                version: 1,
                reasonCode: signal.payload.reasonCode,
              }),
            },
          },
        );

        if (relatedSignal !== null) {
          await transaction.emergencyRelatedEvent.create({
            data: {
              organizationId: binding.organizationId,
              facilityId: binding.facilityId,
              primaryEventId: relatedSignal.emergencyEventId,
              relatedEventId: event.id,
              reasonCode: 'RELATED_SIGNAL_WITHIN_WINDOW',
              correlationId,
            },
          });
          await createOutbox(
            transaction,
            {
              eventType: 'EMERGENCY.RELATED_DUPLICATE',
              organizationId: binding.organizationId,
              facilityId: binding.facilityId,
              emergencyEventId: event.id,
              aggregateVersion: 1,
              actorId: binding.externalSourceId,
              correlationId,
              idempotencyKey: `m04-iot-related-v1:${signal.requestFingerprint}`,
              occurredAt: receivedAt,
              payload: {
                ...buildM04EmergencyEventData({
                  emergencyId: event.id,
                  elderId: binding.elderId,
                  status: 'OPEN',
                  version: 1,
                  reasonCode: 'RELATED_SIGNAL_WITHIN_WINDOW',
                  relatedEmergencyId: relatedSignal.emergencyEventId,
                }),
              },
            },
          );
        }
        await transaction.auditEvent.create({
          data: {
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            actorType: 'SYSTEM',
            action: 'emergency.iot.ingest',
            outcome: 'SUCCESS',
            resourceType: 'EmergencyEvent',
            resourceId: event.id,
            reasonCode: signal.payload.reasonCode,
            correlationId,
            safeMetadata: {
              source: 'm04-mqtt',
              relatedDuplicate: relatedSignal !== null,
              signalTimestampAdjusted,
              ...(location.fallbackReasonCode === null
                ? {}
                : {
                    locationFallbackReasonCode:
                      location.fallbackReasonCode,
                  }),
            },
            occurredAt: receivedAt,
          },
        });

        return {
          kind: 'created',
          emergencyEventId: event.id,
          relatedToEventId: relatedSignal?.emergencyEventId ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

interface BindingContext {
  readonly id: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly elderId: string;
}

async function buildLocationSnapshot(
  transaction: Prisma.TransactionClient,
  binding: BindingContext,
  signal: NormalizedEmergencyMqttSignal,
  receivedAt: Date,
  locationRetentionHours: number,
) {
  const stay = await transaction.elderStay.findFirst({
    where: {
      organizationId: binding.organizationId,
      facilityId: binding.facilityId,
      elderId: binding.elderId,
      status: 'ACTIVE',
      admittedAt: { lte: receivedAt },
      OR: [{ dischargedAt: null }, { dischargedAt: { gt: receivedAt } }],
    },
    select: {
      bed: {
        select: {
          room: { select: { id: true, floorId: true } },
        },
      },
    },
    orderBy: [{ admittedAt: 'desc' }, { id: 'desc' }],
  });
  const fallbackRoomId = stay?.bed.room.id ?? null;
  const fallbackFloorId = stay?.bed.room.floorId ?? null;
  const input = signal.payload.location;
  if (input === undefined) {
    return roomFallbackLocation(
      receivedAt,
      locationRetentionHours,
      fallbackFloorId,
      fallbackRoomId,
      signal.locationFallbackReasonCode ?? 'LOCATION_MISSING',
    );
  }

  const observedAt = new Date(input.observedAt);
  const expiresAt = new Date(input.expiresAt);
  const requestedRoom =
    input.roomId === undefined
      ? null
      : await transaction.room.findFirst({
          where: {
            id: input.roomId,
            organizationId: binding.organizationId,
            facilityId: binding.facilityId,
            status: 'ACTIVE',
          },
          select: { id: true, floorId: true },
        });
  if (input.roomId !== undefined && requestedRoom === null) {
    return roomFallbackLocation(
      receivedAt,
      locationRetentionHours,
      fallbackFloorId,
      fallbackRoomId,
      'LOCATION_SCOPE_INVALID',
    );
  }
  const resolvedFloorId =
    input.floorId ?? requestedRoom?.floorId ?? fallbackFloorId;
  if (
    input.floorId !== undefined &&
    requestedRoom !== null &&
    requestedRoom.floorId !== input.floorId
  ) {
    return roomFallbackLocation(
      receivedAt,
      locationRetentionHours,
      fallbackFloorId,
      fallbackRoomId,
      'LOCATION_SCOPE_INVALID',
    );
  }
  if (resolvedFloorId !== null && resolvedFloorId !== undefined) {
    const validFloor = await transaction.floor.count({
      where: {
        id: resolvedFloorId,
        organizationId: binding.organizationId,
        facilityId: binding.facilityId,
        status: 'ACTIVE',
      },
    });
    if (validFloor !== 1) {
      return roomFallbackLocation(
        receivedAt,
        locationRetentionHours,
        fallbackFloorId,
        fallbackRoomId,
        'LOCATION_SCOPE_INVALID',
      );
    }
  }
  const freshnessReason = emergencyLocationFreshnessReason(
    observedAt,
    expiresAt,
    receivedAt,
  );
  const isCurrent = freshnessReason === null;
  return {
    state: isCurrent ? ('CURRENT' as const) : ('STALE' as const),
    source: input.source,
    floorId: resolvedFloorId ?? null,
    roomId: requestedRoom?.id ?? fallbackRoomId,
    normalizedX: input.normalizedX,
    normalizedY: input.normalizedY,
    accuracyMeters: input.accuracyMeters,
    observedAt,
    expiresAt,
    fallbackReasonCode: freshnessReason,
    retentionUntil: new Date(
      receivedAt.getTime() + locationRetentionHours * 60 * 60_000,
    ),
  };
}

export function normalizeEmergencySignalObservedAt(
  timestamp: string,
  receivedAt: Date,
): Date {
  const observedAt = new Date(timestamp);
  return observedAt.getTime() > receivedAt.getTime()
    ? new Date(receivedAt)
    : observedAt;
}

export function emergencyLocationFreshnessReason(
  observedAt: Date,
  expiresAt: Date,
  receivedAt: Date,
):
  | 'LOCATION_SAMPLE_TOO_OLD'
  | 'LOCATION_TTL_EXCEEDS_POLICY'
  | 'LOCATION_TIMESTAMP_IN_FUTURE'
  | 'LOCATION_EXPIRED'
  | null {
  if (
    observedAt.getTime() >
    receivedAt.getTime() + EMERGENCY_LOCATION_MAX_FUTURE_SKEW_MS
  ) {
    return 'LOCATION_TIMESTAMP_IN_FUTURE';
  }
  if (
    receivedAt.getTime() - observedAt.getTime() >
    EMERGENCY_LOCATION_MAX_SAMPLE_AGE_MS
  ) {
    return 'LOCATION_SAMPLE_TOO_OLD';
  }
  if (expiresAt.getTime() <= receivedAt.getTime()) {
    return 'LOCATION_EXPIRED';
  }
  if (
    expiresAt.getTime() - observedAt.getTime() >
    EMERGENCY_LOCATION_MAX_EFFECTIVE_TTL_MS
  ) {
    return 'LOCATION_TTL_EXCEEDS_POLICY';
  }
  return null;
}

function roomFallbackLocation(
  receivedAt: Date,
  locationRetentionHours: number,
  floorId: string | null,
  roomId: string | null,
  fallbackReasonCode: string,
) {
  const retentionUntil = new Date(
    receivedAt.getTime() + locationRetentionHours * 60 * 60_000,
  );
  return roomId === null
    ? {
        state: 'UNKNOWN' as const,
        source: 'ROOM_FALLBACK',
        floorId: null,
        roomId: null,
        fallbackReasonCode,
        retentionUntil,
      }
    : {
        state: 'ROOM_FALLBACK' as const,
        source: 'ROOM_FALLBACK',
        floorId,
        roomId,
        fallbackReasonCode,
        retentionUntil,
      };
}

interface OutboxInput {
  readonly eventType: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly emergencyEventId: string;
  readonly aggregateVersion: number;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
  readonly payload: Prisma.InputJsonObject;
}

async function createOutbox(
  transaction: Prisma.TransactionClient,
  input: OutboxInput,
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      eventId: createEventId(input.occurredAt.getTime()),
      eventType: input.eventType,
      schemaVersion: '1.0',
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      aggregateType: 'EMERGENCY_EVENT',
      aggregateId: input.emergencyEventId,
      aggregateVersion: input.aggregateVersion,
      actorType: 'DEVICE',
      actorId: input.actorId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
      payload: input.payload,
      privacyClass: 'SENSITIVE',
    },
  });
}

function mqttCorrelationId(sourceIdentityKey: string, externalEventId: string): string {
  return `m04-iot-v1:${sha256(JSON.stringify([sourceIdentityKey, externalEventId]))}`;
}

function mqttEscalationKey(
  emergencyEventId: string,
  escalationStepId: string,
  basisVersion: number,
): string {
  return `m04-sla-v1:${sha256(
    JSON.stringify([emergencyEventId, escalationStepId, basisVersion]),
  )}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
