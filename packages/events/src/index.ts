/** Cross-module event envelope from docs/14. Publishing is implemented by an application outbox. */
export type EventActorType = 'USER' | 'SYSTEM' | 'DEVICE' | 'AGENT';
export type EventPrivacyClass = 'OPERATIONS' | 'SENSITIVE' | 'HIGHLY_SENSITIVE';

export interface EventActor {
  readonly type: EventActorType;
  readonly id: string;
}

export interface EventEnvelope<TData = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly organizationId: string;
  readonly facilityId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly actor: EventActor;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly data: TData;
  readonly privacyClass: EventPrivacyClass;
}

export interface EventPublisher {
  publish<TData>(event: EventEnvelope<TData>): Promise<void>;
}

export const M03_EVENT_TYPES = [
  'VOICE_SUBMISSION.CREATED',
  'TRANSCRIPT.COMPLETED',
  'TRANSCRIPT.FAILED',
  'AI_NEED_ANALYSIS.COMPLETED',
  'AI_NEED_ANALYSIS.FAILED',
  'NEED.CREATED',
  'NEED.REVIEW_REQUIRED',
  'NEED.REVIEWED',
  'NEED.SPLIT',
  'WORK_ORDER.CREATED',
  'WORK_ORDER.REVISED',
  'WORK_ORDER.ASSIGNED',
  'WORK_ORDER.ACCEPTED',
  'WORK_ORDER.ARRIVED',
  'WORK_ORDER.IN_PROGRESS',
  'WORK_ORDER.COMPLETED',
  'WORK_ORDER.VERIFIED',
  'WORK_ORDER.CLOSED',
  'WORK_ORDER.CANCELLED',
  'WORK_ORDER.OVERDUE',
  'FAMILY_SUMMARY.PUBLISHED',
  'RATING.SUBMITTED',
] as const;

export type M03EventType = (typeof M03_EVENT_TYPES)[number];

export function isM03EventType(value: string): value is M03EventType {
  return (M03_EVENT_TYPES as readonly string[]).includes(value);
}

export const M04_EVENT_TYPES = [
  'EMERGENCY.OPENED',
  'EMERGENCY.ACKNOWLEDGED',
  'EMERGENCY.RESPONDING',
  'EMERGENCY.ESCALATED',
  'EMERGENCY.RESOLVED',
  'EMERGENCY.REVIEWED',
  'EMERGENCY.RELATED_DUPLICATE',
] as const;

export type M04EventType = (typeof M04_EVENT_TYPES)[number];

export interface M04EmergencyEventData {
  readonly emergencyId: string;
  readonly elderId: string;
  readonly status:
    | 'OPEN'
    | 'ACKNOWLEDGED'
    | 'RESPONDING'
    | 'RESOLVED'
    | 'REVIEWED';
  readonly version: number;
  readonly reasonCode: string;
  readonly slaStage?: 'ACKNOWLEDGEMENT' | 'ARRIVAL' | 'RESOLUTION';
  readonly relatedEmergencyId?: string;
  /**
   * One-way command hash used only to reject an idempotency key replayed with
   * different input. It must never contain the original command body.
   */
  readonly requestFingerprint?: string;
}

export function isM04EventType(value: string): value is M04EventType {
  return (M04_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Creates the deliberately minimal M04 outbox payload. Do not add names,
 * summaries, coordinates, device identities, transcripts or caregiver details.
 */
export function buildM04EmergencyEventData(
  input: M04EmergencyEventData,
): M04EmergencyEventData {
  const data: M04EmergencyEventData = {
    emergencyId: input.emergencyId,
    elderId: input.elderId,
    status: input.status,
    version: input.version,
    reasonCode: input.reasonCode,
    ...(input.slaStage === undefined ? {} : { slaStage: input.slaStage }),
    ...(input.relatedEmergencyId === undefined
      ? {}
      : { relatedEmergencyId: input.relatedEmergencyId }),
    ...(input.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: input.requestFingerprint }),
  };
  return Object.freeze(data);
}
