import { describe, expect, it, vi } from 'vitest';
import {
  EmergencyMqttIngestionService,
  EmergencyMqttRetryableIngestionError,
  EmergencyMqttValidationError,
  assertStableMqttClientId,
  emergencyMqttAckDispositionForError,
  emergencyMqttSubscription,
  hasRequiredEmergencySubscriptionGrant,
  parseEmergencyMqttTopic,
  type EmergencyMqttRepository,
  type NormalizedEmergencyMqttSignal,
} from './emergency-mqtt.js';

const prefix = 'test-run-42';
const topic = `${prefix}/v1/orgs/qinglan-demo/facilities/QL-MAIN/emergency/call-device-qinglan-001`;
const payload = {
  schemaVersion: '1.0',
  eventId: 'iot-event-001',
  organizationSlug: 'qinglan-demo',
  facilityCode: 'QL-MAIN',
  sourceId: 'call-device-qinglan-001',
  timestamp: '2026-07-28T08:00:00.000Z',
  reasonCode: 'IOT_EMERGENCY_BUTTON',
};

describe('emergency MQTT contract', () => {
  it('parses only the isolated v1 emergency topic shape', () => {
    expect(parseEmergencyMqttTopic(topic, prefix)).toEqual({
      organizationSlug: 'qinglan-demo',
      facilityCode: 'QL-MAIN',
      sourceId: 'call-device-qinglan-001',
    });
    expect(emergencyMqttSubscription(prefix)).toBe(
      'test-run-42/v1/orgs/+/facilities/+/emergency/+',
    );
    expect(() =>
      parseEmergencyMqttTopic(
        `${prefix}/v1/orgs/qinglan-demo/emergency/source`,
        prefix,
      ),
    ).toThrow(EmergencyMqttValidationError);
  });

  it('requires a stable safe MQTT client identifier', () => {
    expect(() =>
      assertStableMqttClientId('eldercare-m04-worker-emergency-v1'),
    ).not.toThrow();
    expect(() => assertStableMqttClientId('')).toThrow(
      EmergencyMqttValidationError,
    );
    expect(() => assertStableMqttClientId(`bad client ${process.pid}`)).toThrow(
      EmergencyMqttValidationError,
    );
  });

  it('requires the exact subscription to be granted at QoS 1 or better', () => {
    const subscription = emergencyMqttSubscription(prefix);
    expect(
      hasRequiredEmergencySubscriptionGrant(subscription, [
        { topic: subscription, qos: 1 },
      ]),
    ).toBe(true);
    expect(
      hasRequiredEmergencySubscriptionGrant(subscription, [
        { topic: subscription, qos: 2 },
      ]),
    ).toBe(true);
    expect(
      hasRequiredEmergencySubscriptionGrant(subscription, [
        { topic: subscription, qos: 0 },
      ]),
    ).toBe(false);
    expect(
      hasRequiredEmergencySubscriptionGrant(subscription, [
        { topic: subscription, qos: 128 },
      ]),
    ).toBe(false);
    expect(hasRequiredEmergencySubscriptionGrant(subscription, undefined)).toBe(
      false,
    );
  });

  it('ACKs only deterministic payload failures and retries server-side state failures', () => {
    expect(
      emergencyMqttAckDispositionForError(
        new EmergencyMqttValidationError('MQTT_EMERGENCY_SCHEMA_INVALID'),
      ),
    ).toBe('ACK_INVALID');
    expect(
      emergencyMqttAckDispositionForError(
        new EmergencyMqttRetryableIngestionError(
          'MQTT_EMERGENCY_ESCALATION_POLICY_MISSING',
        ),
      ),
    ).toBe('RETRY');
    expect(
      emergencyMqttAckDispositionForError(new Error('database unavailable')),
    ).toBe('RETRY');
  });

  it('validates topic and payload scope before repository access', async () => {
    const received: NormalizedEmergencyMqttSignal[] = [];
    const ingest = vi.fn(
      (signal: NormalizedEmergencyMqttSignal) => {
        received.push(signal);
        return Promise.resolve({
          kind: 'created' as const,
          emergencyEventId: 'event-1',
          relatedToEventId: null,
        });
      },
    );
    const repository: EmergencyMqttRepository = {
      ingest,
    };
    const service = new EmergencyMqttIngestionService(
      prefix,
      repository,
      () => new Date('2026-07-28T08:00:01.000Z'),
    );

    await expect(
      service.ingest(topic, Buffer.from(JSON.stringify(payload))),
    ).resolves.toMatchObject({ kind: 'created' });
    expect(received[0]?.sourceIdentityKey).toMatch(/^mqtt-v1:[a-f0-9]{64}$/);
    expect(received[0]?.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ingest).toHaveBeenCalledWith(
      received[0],
      new Date('2026-07-28T08:00:01.000Z'),
    );

    await expect(
      service.ingest(
        topic,
        Buffer.from(
          JSON.stringify({ ...payload, facilityCode: 'OTHER-FACILITY' }),
        ),
      ),
    ).rejects.toMatchObject({ reasonCode: 'MQTT_EMERGENCY_SCOPE_MISMATCH' });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('fingerprints canonical payloads and rejects conflicting strict fields', async () => {
    const received: NormalizedEmergencyMqttSignal[] = [];
    const ingest = vi.fn(
      (signal: NormalizedEmergencyMqttSignal) => {
        received.push(signal);
        return Promise.resolve({
          kind: 'replayed' as const,
          emergencyEventId: 'event-1',
        });
      },
    );
    const repository: EmergencyMqttRepository = {
      ingest,
    };
    const service = new EmergencyMqttIngestionService(
      prefix,
      repository,
      () => new Date('2026-07-28T08:00:01.000Z'),
    );

    await service.ingest(topic, Buffer.from(JSON.stringify(payload)));
    const firstSignal = received[0];
    await service.ingest(
      topic,
      Buffer.from(
        JSON.stringify({
          reasonCode: payload.reasonCode,
          timestamp: payload.timestamp,
          sourceId: payload.sourceId,
          facilityCode: payload.facilityCode,
          organizationSlug: payload.organizationSlug,
          eventId: payload.eventId,
          schemaVersion: payload.schemaVersion,
        }),
      ),
    );
    const replaySignal = received[1];
    expect(replaySignal?.requestFingerprint).toBe(firstSignal?.requestFingerprint);

    await expect(
      service.ingest(
        topic,
        Buffer.from(JSON.stringify({ ...payload, unexpected: true })),
      ),
    ).rejects.toMatchObject({ reasonCode: 'MQTT_EMERGENCY_SCHEMA_INVALID' });
  });

  it('keeps future clocks and malformed optional location on the durable path', async () => {
    const received: NormalizedEmergencyMqttSignal[] = [];
    const repository: EmergencyMqttRepository = {
      ingest: vi.fn((signal: NormalizedEmergencyMqttSignal) => {
        received.push(signal);
        return Promise.resolve({
          kind: 'created' as const,
          emergencyEventId: 'event-1',
          relatedToEventId: null,
        });
      }),
    };
    const service = new EmergencyMqttIngestionService(
      prefix,
      repository,
      () => new Date('2026-07-28T08:00:01.000Z'),
    );
    const futurePayload = {
      ...payload,
      timestamp: '2026-07-29T08:00:00.000Z',
    };
    const malformedLocationPayload = {
      ...payload,
      eventId: 'iot-event-bad-location',
      location: {
        source: 'DEVICE',
        observedAt: 'not-a-timestamp',
      },
    };

    await expect(
      service.ingest(topic, Buffer.from(JSON.stringify(futurePayload))),
    ).resolves.toMatchObject({ kind: 'created' });
    await expect(
      service.ingest(
        topic,
        Buffer.from(JSON.stringify(malformedLocationPayload)),
      ),
    ).resolves.toMatchObject({ kind: 'created' });
    await service.ingest(
      topic,
      Buffer.from(JSON.stringify(malformedLocationPayload)),
    );

    expect(received[0]?.payload.timestamp).toBe(futurePayload.timestamp);
    expect(received[1]?.payload.location).toBeUndefined();
    expect(received[1]?.locationFallbackReasonCode).toBe(
      'LOCATION_SCHEMA_INVALID',
    );
    expect(received[2]?.requestFingerprint).toBe(
      received[1]?.requestFingerprint,
    );
  });
});
