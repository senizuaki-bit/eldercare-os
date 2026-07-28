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
