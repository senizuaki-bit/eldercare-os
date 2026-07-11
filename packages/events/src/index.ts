/** Cross-module event envelope from docs/14. No bus or outbox behavior is implemented in M00. */
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
