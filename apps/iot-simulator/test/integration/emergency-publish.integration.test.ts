import { randomUUID } from 'node:crypto';
import { parseServiceConfig } from '@eldercare/config';
import { mqttEmergencySignalPayloadSchema } from '@eldercare/contracts';
import { connect, type MqttClient } from 'mqtt';
import { describe, expect, it } from 'vitest';
import { publishMessage } from '../../src/broker.js';
import { buildEmergencyFixture } from '../../src/emergency-fixture.js';

const config = parseServiceConfig();

describe('IoT emergency publisher', () => {
  it('publishes the selected location fixture on an isolated QoS 1 topic', async () => {
    const topicPrefix = `iot-it-${randomUUID().replaceAll('-', '')}`;
    const fixture = buildEmergencyFixture({
      organizationSlug: 'integration-org',
      facilityCode: 'IT-FACILITY',
      sourceId: 'integration-call-device',
      eventId: `event-${randomUUID()}`,
      location: 'stale',
      topicPrefix,
      now: new Date('2026-07-28T08:00:00.000Z'),
    });
    const subscriber = connect(config.mqttUrl, {
      clean: true,
      clientId: `iot-it-subscriber-${randomUUID()}`,
      reconnectPeriod: 0,
    });

    try {
      await withTimeout(waitForConnect(subscriber), 5_000);
      await subscribe(subscriber, fixture.topic);
      const received = waitForMessage(subscriber, fixture.topic);
      await publishMessage(
        config.mqttUrl,
        config.readinessTimeoutMs,
        fixture.topic,
        JSON.stringify(fixture.message),
      );
      const payload = mqttEmergencySignalPayloadSchema.parse(
        JSON.parse(await withTimeout(received, 5_000)),
      );
      expect(payload.eventId).toBe(fixture.message.eventId);
      expect(payload.location).toMatchObject({
        source: 'DEVICE',
        normalizedX: 0.42,
        normalizedY: 0.36,
      });
      expect(Date.parse(payload.location?.expiresAt ?? '')).toBeLessThan(
        Date.parse(payload.timestamp),
      );
    } finally {
      await close(subscriber);
    }
  });
});

async function waitForConnect(client: MqttClient): Promise<void> {
  if (client.connected) return;
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });
}

async function subscribe(client: MqttClient, topic: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

async function waitForMessage(client: MqttClient, topic: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const onMessage = (receivedTopic: string, payload: Buffer): void => {
      if (receivedTopic !== topic) return;
      client.off('message', onMessage);
      resolve(payload.toString('utf8'));
    };
    client.on('message', onMessage);
  });
}

async function close(client: MqttClient): Promise<void> {
  await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for MQTT integration event')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
