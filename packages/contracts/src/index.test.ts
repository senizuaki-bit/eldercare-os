import { describe, expect, it } from 'vitest';

import {
  buildMqttTopic,
  errorEnvelopeSchema,
  healthResponseSchema,
  mqttBaseMessageSchema,
  parseMqttTopic,
} from './index.js';

describe('foundation contracts', () => {
  it('accepts a safe health response', () => {
    expect(
      healthResponseSchema.parse({
        status: 'ok',
        service: 'api',
        version: '0.0.1',
        timestamp: '2026-07-11T10:00:00.000Z',
        checks: { postgres: 'ok', redis: 'ok' },
      }),
    ).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('keeps error details free of raw values', () => {
    expect(() =>
      errorEnvelopeSchema.parse({
        error: {
          code: 'INVALID_INPUT',
          message: 'The request is invalid',
          correlationId: 'corr-1',
          details: [{ field: 'password', code: 'invalid' }],
        },
        timestamp: '2026-07-11T10:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('round-trips the versioned MQTT topic contract', () => {
    const topic = buildMqttTopic({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      deviceId: 'device-1',
      kind: 'heartbeat',
      prefix: 'eldercare-local',
    });

    expect(topic).toBe(
      'eldercare-local/org/org-1/facility/facility-1/device/device-1/v1/heartbeat',
    );
    expect(parseMqttTopic(topic, 'eldercare-local')).toMatchObject({
      organizationId: 'org-1',
      version: 'v1',
      kind: 'heartbeat',
    });
  });

  it('rejects a malformed timestamp and unexpected MQTT fields', () => {
    expect(() =>
      mqttBaseMessageSchema.parse({
        schemaVersion: '1.0',
        eventId: 'evt-1',
        deviceId: 'device-1',
        timestamp: 'not-a-time',
        payload: {},
        organizationId: 'untrusted-client-field',
      }),
    ).toThrow();
  });
});
