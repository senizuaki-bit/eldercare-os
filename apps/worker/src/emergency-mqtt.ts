import { createHash } from 'node:crypto';
import {
  mqttEmergencySignalPayloadSchema,
  type MqttEmergencySignalPayload,
} from '@eldercare/contracts';
import type { Logger } from '@eldercare/observability';
import {
  connect,
  type ISubscriptionGrant,
  type MqttClient,
} from 'mqtt';

const MAX_MQTT_MESSAGE_BYTES = 32 * 1024;

export interface EmergencyMqttTopic {
  readonly organizationSlug: string;
  readonly facilityCode: string;
  readonly sourceId: string;
}

export interface NormalizedEmergencyMqttSignal {
  readonly topic: EmergencyMqttTopic;
  readonly payload: MqttEmergencySignalPayload;
  readonly locationFallbackReasonCode?: 'LOCATION_SCHEMA_INVALID';
  readonly requestFingerprint: string;
  readonly sourceIdentityKey: string;
}

export type EmergencyMqttIngestionOutcome =
  | { readonly kind: 'created'; readonly emergencyEventId: string; readonly relatedToEventId: string | null }
  | { readonly kind: 'replayed'; readonly emergencyEventId: string }
  | { readonly kind: 'conflict'; readonly emergencyEventId: string };

export interface EmergencyMqttRepository {
  ingest(
    signal: NormalizedEmergencyMqttSignal,
    receivedAt: Date,
  ): Promise<EmergencyMqttIngestionOutcome>;
}

export class EmergencyMqttValidationError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'EmergencyMqttValidationError';
  }
}

/**
 * The wire payload is valid, but durable ingestion cannot complete until
 * server-side state or infrastructure recovers. Subscribers must not PUBACK
 * these failures.
 */
export class EmergencyMqttRetryableIngestionError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'EmergencyMqttRetryableIngestionError';
  }
}

export class EmergencyMqttIngestionService {
  constructor(
    private readonly topicPrefix: string,
    private readonly repository: EmergencyMqttRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ingest(topic: string, bytes: Uint8Array): Promise<EmergencyMqttIngestionOutcome> {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MQTT_MESSAGE_BYTES) {
      throw new EmergencyMqttValidationError('MQTT_EMERGENCY_PAYLOAD_SIZE_INVALID');
    }
    const topicParts = parseEmergencyMqttTopic(topic, this.topicPrefix);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new EmergencyMqttValidationError('MQTT_EMERGENCY_JSON_INVALID');
    }
    const normalized = normalizeEmergencyMqttPayload(parsedJson);
    const payload = normalized.payload;
    if (
      payload.organizationSlug !== topicParts.organizationSlug ||
      payload.facilityCode !== topicParts.facilityCode ||
      payload.sourceId !== topicParts.sourceId
    ) {
      throw new EmergencyMqttValidationError('MQTT_EMERGENCY_SCOPE_MISMATCH');
    }

    const scope = [
      topicParts.organizationSlug,
      topicParts.facilityCode,
      topicParts.sourceId,
    ];
    const sourceIdentityKey = `mqtt-v1:${sha256(stableStringify(scope))}`;
    const receivedAt = this.now();
    return this.repository.ingest(
      {
        topic: topicParts,
        payload,
        ...(normalized.locationFallbackReasonCode === undefined
          ? {}
          : {
              locationFallbackReasonCode:
                normalized.locationFallbackReasonCode,
            }),
        requestFingerprint: sha256(
          stableStringify({
            topic: topicParts,
            payload: normalized.fingerprintPayload,
          }),
        ),
        sourceIdentityKey,
      },
      receivedAt,
    );
  }
}

export interface EmergencyMqttSubscriberOptions {
  readonly mqttUrl: string;
  readonly topicPrefix: string;
  readonly clientId: string;
  readonly timeoutMs: number;
}

type EmergencyMqttAckDisposition = 'ACK_DURABLE' | 'ACK_INVALID' | 'RETRY';

export class EmergencyMqttSubscriber {
  private readonly client: MqttClient;
  private readonly readyPromise: Promise<void>;
  private closing = false;
  private retryDisconnectPending = false;

  constructor(
    ingestion: EmergencyMqttIngestionService,
    logger: Logger,
    options: EmergencyMqttSubscriberOptions,
  ) {
    let markReady: () => void = () => undefined;
    this.readyPromise = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    assertStableMqttClientId(options.clientId);
    const inFlight = new WeakMap<
      object,
      Promise<EmergencyMqttAckDisposition>
    >();
    this.client = connect(options.mqttUrl, {
      clean: false,
      clientId: options.clientId,
      connectTimeout: options.timeoutMs,
      reconnectPeriod: 2_000,
      manualConnect: true,
      resubscribe: false,
    });
    this.client.handleMessage = (packet, callback) => {
      const processing = inFlight.get(packet);
      if (processing === undefined) {
        logger.error('Emergency MQTT acknowledgement state missing', {
          reasonCode: 'MQTT_EMERGENCY_ACK_STATE_MISSING',
        });
        this.disconnectForRetry();
        return;
      }
      void processing.then((disposition) => {
        inFlight.delete(packet);
        if (disposition === 'RETRY') {
          this.disconnectForRetry();
          return;
        }
        callback();
      });
    };
    const subscription = emergencyMqttSubscription(options.topicPrefix);
    this.client.on('connect', () => {
      this.retryDisconnectPending = false;
      this.client.subscribe(subscription, { qos: 1 }, (error, granted) => {
        if (
          error === null &&
          hasRequiredEmergencySubscriptionGrant(subscription, granted)
        ) {
          markReady();
          logger.info('Emergency MQTT ingestion subscribed', { subscription });
        } else {
          logger.error('Emergency MQTT subscription failed', {
            reasonCode:
              error === null
                ? 'MQTT_EMERGENCY_SUBSCRIBE_GRANT_INSUFFICIENT'
                : 'MQTT_EMERGENCY_SUBSCRIBE_FAILED',
          });
          this.disconnectForRetry();
        }
      });
    });
    this.client.on('message', (topic, payload, packet) => {
      const processing = ingestion
        .ingest(topic, payload)
        .then((outcome) => {
          logger.info('Emergency MQTT signal processed', {
            outcome: outcome.kind,
            emergencyEventId: outcome.emergencyEventId,
          });
          return 'ACK_DURABLE' as const;
        })
        .catch((error: unknown) => {
          const disposition = emergencyMqttAckDispositionForError(error);
          if (disposition === 'ACK_INVALID') {
            logger.warn('Emergency MQTT poison signal acknowledged', {
              reasonCode:
                error instanceof EmergencyMqttValidationError
                  ? error.reasonCode
                  : 'MQTT_EMERGENCY_PAYLOAD_INVALID',
              disposition: 'ACK_INVALID',
            });
            return 'ACK_INVALID' as const;
          }
          logger.warn('Emergency MQTT ingestion deferred for broker retry', {
            reasonCode:
              error instanceof EmergencyMqttRetryableIngestionError
                ? error.reasonCode
                : 'MQTT_EMERGENCY_INGESTION_TRANSIENT_FAILURE',
            disposition: 'RETRY',
          });
          return 'RETRY' as const;
        });
      inFlight.set(packet, processing);
    });
    this.client.on('error', () => {
      logger.warn('Emergency MQTT broker unavailable', {
        reasonCode: 'MQTT_EMERGENCY_BROKER_UNAVAILABLE',
      });
    });
    this.client.connect();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async close(): Promise<void> {
    this.closing = true;
    await new Promise<void>((resolve) => {
      this.client.end(true, {}, () => resolve());
    });
  }

  private disconnectForRetry(): void {
    if (
      this.closing ||
      this.retryDisconnectPending ||
      !this.client.connected
    ) {
      return;
    }
    this.retryDisconnectPending = true;
    this.client.stream.destroy();
  }
}

export function emergencyMqttAckDispositionForError(
  error: unknown,
): Extract<EmergencyMqttAckDisposition, 'ACK_INVALID' | 'RETRY'> {
  return error instanceof EmergencyMqttValidationError
    ? 'ACK_INVALID'
    : 'RETRY';
}

export function hasRequiredEmergencySubscriptionGrant(
  subscription: string,
  granted: readonly Pick<ISubscriptionGrant, 'topic' | 'qos'>[] | undefined,
): boolean {
  return (
    granted?.some(
      (grant) =>
        grant.topic === subscription &&
        (grant.qos === 1 || grant.qos === 2),
    ) === true
  );
}

export function assertStableMqttClientId(clientId: string): void {
  if (
    clientId.length < 1 ||
    clientId.length > 64 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(clientId)
  ) {
    throw new EmergencyMqttValidationError(
      'MQTT_EMERGENCY_CLIENT_ID_INVALID',
    );
  }
}

export function emergencyMqttSubscription(topicPrefix: string): string {
  const prefix = normalizePrefix(topicPrefix);
  return `${prefix}/v1/orgs/+/facilities/+/emergency/+`;
}

export function parseEmergencyMqttTopic(
  topic: string,
  topicPrefix: string,
): EmergencyMqttTopic {
  const prefix = normalizePrefix(topicPrefix);
  const expectedPrefix = `${prefix}/`;
  if (!topic.startsWith(expectedPrefix)) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_TOPIC_INVALID');
  }
  const parts = topic.slice(expectedPrefix.length).split('/');
  if (
    parts.length !== 7 ||
    parts[0] !== 'v1' ||
    parts[1] !== 'orgs' ||
    parts[3] !== 'facilities' ||
    parts[5] !== 'emergency'
  ) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_TOPIC_INVALID');
  }
  const organizationSlug = assertSafeTopicSegment(parts[2]);
  const facilityCode = assertSafeTopicSegment(parts[4]);
  const sourceId = assertSafeTopicSegment(parts[6]);
  return { organizationSlug, facilityCode, sourceId };
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.replace(/^\/+|\/+$/g, '');
  if (
    normalized.length === 0 ||
    !normalized
      .split('/')
      .every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
  ) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_PREFIX_INVALID');
  }
  return normalized;
}

function assertSafeTopicSegment(value: string | undefined): string {
  if (
    value === undefined ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_TOPIC_INVALID');
  }
  return value;
}

function normalizeEmergencyMqttPayload(parsedJson: unknown): {
  readonly payload: MqttEmergencySignalPayload;
  readonly fingerprintPayload: unknown;
  readonly locationFallbackReasonCode?: 'LOCATION_SCHEMA_INVALID';
} {
  const parsed = mqttEmergencySignalPayloadSchema.safeParse(parsedJson);
  if (parsed.success) {
    return {
      payload: parsed.data,
      fingerprintPayload: parsed.data,
    };
  }
  if (
    parsedJson === null ||
    typeof parsedJson !== 'object' ||
    Array.isArray(parsedJson) ||
    !Object.prototype.hasOwnProperty.call(parsedJson, 'location')
  ) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_SCHEMA_INVALID');
  }

  const { location, ...requiredEnvelope } = parsedJson as Record<
    string,
    unknown
  >;
  const envelope = mqttEmergencySignalPayloadSchema.safeParse(requiredEnvelope);
  if (!envelope.success) {
    throw new EmergencyMqttValidationError('MQTT_EMERGENCY_SCHEMA_INVALID');
  }
  return {
    payload: envelope.data,
    fingerprintPayload: {
      ...envelope.data,
      location,
    },
    locationFallbackReasonCode: 'LOCATION_SCHEMA_INVALID',
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
