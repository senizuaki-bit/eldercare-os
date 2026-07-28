import { randomUUID } from 'node:crypto';
import { parseServiceConfig } from '@eldercare/config';
import { createPrismaClient } from '@eldercare/db';
import { createLogger } from '@eldercare/observability';
import { connect, type MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EmergencyMqttIngestionService,
  EmergencyMqttRetryableIngestionError,
  EmergencyMqttSubscriber,
  type EmergencyMqttRepository,
} from '../../src/emergency-mqtt.js';
import { PrismaEmergencyMqttRepository } from '../../src/prisma-emergency-mqtt-repository.js';
import {
  createM04IntegrationFixture,
  deleteM04IntegrationFixture,
  type M04IntegrationFixture,
} from './m04-fixture.js';

const config = parseServiceConfig();
const database = createPrismaClient(config.databaseUrl);
let fixture: M04IntegrationFixture;
let subscriber: EmergencyMqttSubscriber | undefined;
let publisher: MqttClient | undefined;
const persistentClientIds = new Set<string>();

beforeEach(async () => {
  fixture = await createM04IntegrationFixture(database);
});

afterEach(async () => {
  await Promise.allSettled([
    subscriber?.close() ?? Promise.resolve(),
    closePublisher(publisher),
  ]);
  subscriber = undefined;
  publisher = undefined;
  for (const clientId of persistentClientIds) {
    await clearPersistentSession(clientId);
  }
  persistentClientIds.clear();
  if (fixture !== undefined) {
    await deleteM04IntegrationFixture(database, fixture);
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe('emergency MQTT ingestion', () => {
  it('creates, replays, conflicts, and links new event IDs over an isolated topic', async () => {
    const topicPrefix = `worker-it-${randomUUID().replaceAll('-', '')}`;
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const repository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    let poisonAcknowledgements = 0;
    const logger = createLogger({
      service: 'worker-mqtt-integration',
      sink: (line) => {
        const entry = JSON.parse(line) as {
          readonly context?: { readonly disposition?: string };
        };
        if (entry.context?.disposition === 'ACK_INVALID') {
          poisonAcknowledgements += 1;
        }
      },
    });
    const clientId = persistentClientId('contract');
    const ingestion = new EmergencyMqttIngestionService(topicPrefix, repository);
    subscriber = new EmergencyMqttSubscriber(
      ingestion,
      logger,
      {
        mqttUrl: config.mqttUrl,
        topicPrefix,
        clientId,
        timeoutMs: config.readinessTimeoutMs,
      },
    );
    await withTimeout(subscriber.ready(), 5_000);
    publisher = connect(config.mqttUrl, {
      clean: true,
      clientId: `worker-it-publisher-${randomUUID()}`,
      reconnectPeriod: 0,
    });
    await withTimeout(waitForMqttConnect(publisher), 5_000);
    await publish(publisher, topic, {
      schemaVersion: '1.0',
      invalid: true,
    });
    await waitFor(() => Promise.resolve(poisonAcknowledgements === 1));
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(0);
    await subscriber.close();
    subscriber = new EmergencyMqttSubscriber(ingestion, logger, {
      mqttUrl: config.mqttUrl,
      topicPrefix,
      clientId,
      timeoutMs: config.readinessTimeoutMs,
    });
    await withTimeout(subscriber.ready(), 5_000);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(poisonAcknowledgements).toBe(1);

    const now = new Date();
    const firstPayload = {
      schemaVersion: '1.0',
      eventId: `event-${randomUUID()}`,
      organizationSlug: fixture.organizationSlug,
      facilityCode: fixture.facilityCode,
      sourceId: fixture.sourceId,
      timestamp: now.toISOString(),
      reasonCode: 'IOT_EMERGENCY_BUTTON',
      location: {
        source: 'DEVICE',
        observedAt: new Date(now.getTime() - 1_000).toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        normalizedX: 0.3,
        normalizedY: 0.4,
        accuracyMeters: 5,
      },
    };
    await publish(publisher, topic, firstPayload);
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 1,
    );
    const firstSignal = await database.emergencySignal.findFirstOrThrow({
      where: { sourceBindingId: fixture.sourceBindingId },
      include: {
        emergencyEvent: { include: { locationSnapshot: true, escalations: true } },
      },
    });
    expect(firstSignal.emergencyEvent.locationSnapshot?.state).toBe('CURRENT');
    expect(firstSignal.emergencyEvent.escalations).toHaveLength(3);

    await publish(publisher, topic, firstPayload);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(1);

    await publish(publisher, topic, {
      ...firstPayload,
      reasonCode: 'IOT_EMERGENCY_BUTTON_CHANGED',
    });
    await waitFor(async () =>
      (await database.auditEvent.count({
        where: {
          organizationId: fixture.organizationId,
          resourceId: firstSignal.id,
          reasonCode: 'MQTT_EVENT_ID_FINGERPRINT_CONFLICT',
        },
      })) === 1,
    );
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(1);

    const secondExternalEventId = `event-${randomUUID()}`;
    await publish(publisher, topic, {
      ...firstPayload,
      eventId: secondExternalEventId,
      timestamp: new Date().toISOString(),
      location: undefined,
    });
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 2,
    );
    const secondSignal = await database.emergencySignal.findFirstOrThrow({
      where: {
        sourceBindingId: fixture.sourceBindingId,
        externalEventId: secondExternalEventId,
      },
    });
    const eventIds = [
      firstSignal.emergencyEventId,
      secondSignal.emergencyEventId,
    ];
    expect(
      await database.emergencyRelatedEvent.count({
        where: {
          primaryEventId: firstSignal.emergencyEventId,
          relatedEventId: secondSignal.emergencyEventId,
        },
      }),
    ).toBe(1);
    const fallback = await database.emergencyLocationSnapshot.findFirstOrThrow({
      where: {
        emergencyEventId: secondSignal.emergencyEventId,
        state: 'ROOM_FALLBACK',
      },
    });
    expect(fallback.roomId).not.toBeNull();
    expect(
      await database.outboxEvent.count({
        where: {
          organizationId: fixture.organizationId,
          aggregateId: { in: eventIds },
          eventType: 'EMERGENCY.OPENED',
        },
      }),
    ).toBe(2);
    expect(
      await database.outboxEvent.count({
        where: {
          organizationId: fixture.organizationId,
          aggregateId: secondSignal.emergencyEventId,
          eventType: 'EMERGENCY.RELATED_DUPLICATE',
        },
      }),
    ).toBe(1);
    const openedOutbox = await database.outboxEvent.findMany({
      where: {
        organizationId: fixture.organizationId,
        aggregateId: { in: eventIds },
        eventType: 'EMERGENCY.OPENED',
      },
      orderBy: { aggregateId: 'asc' },
    });
    expect(openedOutbox).toHaveLength(2);
    for (const outbox of openedOutbox) {
      expect(outbox.payload).toEqual({
        emergencyId: outbox.aggregateId,
        elderId: fixture.elderId,
        status: 'OPEN',
        version: 1,
        reasonCode: 'IOT_EMERGENCY_BUTTON',
      });
    }
    const relatedOutbox = await database.outboxEvent.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        aggregateId: secondSignal.emergencyEventId,
        eventType: 'EMERGENCY.RELATED_DUPLICATE',
      },
    });
    expect(relatedOutbox.payload).toEqual({
      emergencyId: secondSignal.emergencyEventId,
      elderId: fixture.elderId,
      status: 'OPEN',
      version: 1,
      reasonCode: 'RELATED_SIGNAL_WITHIN_WINDOW',
      relatedEmergencyId: firstSignal.emergencyEventId,
    });
    expect(
      openedOutbox.every(
        (outbox) => outbox.aggregateType === 'EMERGENCY_EVENT',
      ),
    ).toBe(true);
    expect(relatedOutbox.aggregateType).toBe('EMERGENCY_EVENT');

    const ancientExternalEventId = `event-${randomUUID()}`;
    await publish(publisher, topic, {
      ...firstPayload,
      eventId: ancientExternalEventId,
      timestamp: new Date().toISOString(),
      location: {
        source: 'DEVICE',
        observedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        normalizedX: 0.3,
        normalizedY: 0.4,
        accuracyMeters: 5,
      },
    });
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 3,
    );
    const ancientSignal = await database.emergencySignal.findFirstOrThrow({
      where: {
        sourceBindingId: fixture.sourceBindingId,
        externalEventId: ancientExternalEventId,
      },
      include: {
        emergencyEvent: {
          include: { locationSnapshot: true },
        },
      },
    });
    expect(ancientSignal.emergencyEvent.locationSnapshot).toMatchObject({
      state: 'STALE',
      fallbackReasonCode: 'LOCATION_SAMPLE_TOO_OLD',
    });
    expect(ancientSignal.emergencyEvent.locationSnapshot?.state).not.toBe(
      'CURRENT',
    );

    const invalidRoomExternalEventId = `event-${randomUUID()}`;
    await publish(publisher, topic, {
      ...firstPayload,
      eventId: invalidRoomExternalEventId,
      timestamp: new Date().toISOString(),
      location: {
        ...firstPayload.location,
        roomId: randomUUID(),
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 4,
    );
    const invalidRoomSignal =
      await database.emergencySignal.findFirstOrThrow({
        where: {
          sourceBindingId: fixture.sourceBindingId,
          externalEventId: invalidRoomExternalEventId,
        },
        include: {
          emergencyEvent: {
            include: { locationSnapshot: true },
          },
        },
      });
    expect(invalidRoomSignal.emergencyEvent.status).toBe('OPEN');
    expect(invalidRoomSignal.emergencyEvent.locationSnapshot).toMatchObject({
      source: 'ROOM_FALLBACK',
      fallbackReasonCode: 'LOCATION_SCOPE_INVALID',
    });
  }, 20_000);

  it('redelivers after policy availability is restored and commits exactly once', async () => {
    const topicPrefix = `worker-retry-it-${randomUUID().replaceAll('-', '')}`;
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const realRepository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    let attempts = 0;
    const flakyRepository: EmergencyMqttRepository = {
      ingest: async (signal, receivedAt) => {
        attempts += 1;
        if (attempts === 1) {
          throw new EmergencyMqttRetryableIngestionError(
            'MQTT_EMERGENCY_ESCALATION_POLICY_MISSING',
          );
        }
        return realRepository.ingest(signal, receivedAt);
      },
    };
    const logger = createLogger({
      service: 'worker-mqtt-retry-integration',
      sink: () => undefined,
    });
    const clientId = persistentClientId('retry');
    subscriber = new EmergencyMqttSubscriber(
      new EmergencyMqttIngestionService(topicPrefix, flakyRepository),
      logger,
      {
        mqttUrl: config.mqttUrl,
        topicPrefix,
        clientId,
        timeoutMs: config.readinessTimeoutMs,
      },
    );
    await withTimeout(subscriber.ready(), 5_000);
    publisher = await createPublisher('retry');

    await publish(
      publisher,
      topic,
      emergencyPayload(fixture, `event-${randomUUID()}`),
    );
    await waitFor(
      async () =>
        attempts >= 2 &&
        (await database.emergencySignal.count({
          where: { sourceBindingId: fixture.sourceBindingId },
        })) === 1,
      12_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(1);
    const committedSignal = await database.emergencySignal.findFirstOrThrow({
      where: { sourceBindingId: fixture.sourceBindingId },
      select: { emergencyEventId: true },
    });
    expect(
      await database.emergencyEvent.count({
        where: { id: committedSignal.emergencyEventId },
      }),
    ).toBe(1);
    expect(
      await database.outboxEvent.count({
        where: {
          aggregateId: committedSignal.emergencyEventId,
          eventType: 'EMERGENCY.OPENED',
        },
      }),
    ).toBe(1);
  }, 20_000);

  it('opens once when device time is future or optional location is malformed', async () => {
    const topicPrefix = `worker-ancillary-it-${randomUUID().replaceAll('-', '')}`;
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const repository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    const logger = createLogger({
      service: 'worker-mqtt-ancillary-integration',
      sink: () => undefined,
    });
    const clientId = persistentClientId('ancillary');
    subscriber = new EmergencyMqttSubscriber(
      new EmergencyMqttIngestionService(topicPrefix, repository),
      logger,
      {
        mqttUrl: config.mqttUrl,
        topicPrefix,
        clientId,
        timeoutMs: config.readinessTimeoutMs,
      },
    );
    await withTimeout(subscriber.ready(), 5_000);
    publisher = await createPublisher('ancillary');

    const futureEventId = `event-${randomUUID()}`;
    await publish(publisher, topic, {
      ...emergencyPayload(fixture, futureEventId),
      timestamp: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    });
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 1,
    );
    const futureSignal = await database.emergencySignal.findFirstOrThrow({
      where: {
        sourceBindingId: fixture.sourceBindingId,
        externalEventId: futureEventId,
      },
      include: {
        emergencyEvent: {
          include: { locationSnapshot: true },
        },
      },
    });
    expect(futureSignal.observedAt).toEqual(futureSignal.receivedAt);
    expect(futureSignal.emergencyEvent.status).toBe('OPEN');
    expect(futureSignal.emergencyEvent.locationSnapshot?.state).not.toBe(
      'CURRENT',
    );
    const futureAudit = await database.auditEvent.findFirstOrThrow({
      where: {
        resourceId: futureSignal.emergencyEventId,
        action: 'emergency.iot.ingest',
        outcome: 'SUCCESS',
      },
      select: { safeMetadata: true },
    });
    expect(futureAudit.safeMetadata).toMatchObject({
      signalTimestampAdjusted: true,
      locationFallbackReasonCode: 'LOCATION_MISSING',
    });

    const malformedLocationEventId = `event-${randomUUID()}`;
    const malformedLocationPayload = {
      ...emergencyPayload(fixture, malformedLocationEventId),
      location: {
        source: 'DEVICE',
        observedAt: 'not-a-timestamp',
      },
    };
    await publish(publisher, topic, malformedLocationPayload);
    await waitFor(async () =>
      (await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      })) === 2,
    );
    const malformedLocationSignal =
      await database.emergencySignal.findFirstOrThrow({
        where: {
          sourceBindingId: fixture.sourceBindingId,
          externalEventId: malformedLocationEventId,
        },
        include: {
          emergencyEvent: {
            include: { locationSnapshot: true },
          },
        },
      });
    expect(malformedLocationSignal.emergencyEvent.status).toBe('OPEN');
    expect(
      malformedLocationSignal.emergencyEvent.locationSnapshot,
    ).toMatchObject({
      source: 'ROOM_FALLBACK',
      fallbackReasonCode: 'LOCATION_SCHEMA_INVALID',
    });
    expect(
      malformedLocationSignal.emergencyEvent.locationSnapshot?.state,
    ).not.toBe('CURRENT');
    const malformedLocationAudit = await database.auditEvent.findFirstOrThrow({
      where: {
        resourceId: malformedLocationSignal.emergencyEventId,
        action: 'emergency.iot.ingest',
        outcome: 'SUCCESS',
      },
      select: { safeMetadata: true },
    });
    expect(malformedLocationAudit.safeMetadata).toMatchObject({
      signalTimestampAdjusted: false,
      locationFallbackReasonCode: 'LOCATION_SCHEMA_INVALID',
    });

    await publish(publisher, topic, malformedLocationPayload);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(2);
    expect(
      await database.emergencyEvent.count({
        where: { id: malformedLocationSignal.emergencyEventId },
      }),
    ).toBe(1);
  }, 20_000);

  it('queues QoS1 while the persistent subscriber is offline and processes once', async () => {
    const topicPrefix = `worker-offline-it-${randomUUID().replaceAll('-', '')}`;
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const repository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    const logger = createLogger({
      service: 'worker-mqtt-offline-integration',
      sink: () => undefined,
    });
    const clientId = persistentClientId('offline');
    subscriber = new EmergencyMqttSubscriber(
      new EmergencyMqttIngestionService(topicPrefix, repository),
      logger,
      {
        mqttUrl: config.mqttUrl,
        topicPrefix,
        clientId,
        timeoutMs: config.readinessTimeoutMs,
      },
    );
    await withTimeout(subscriber.ready(), 5_000);
    await subscriber.close();
    subscriber = undefined;
    // Longer than reconnectPeriod: a graceful close must not reconnect.
    await new Promise((resolve) => setTimeout(resolve, 2_250));

    publisher = await createPublisher('offline');
    await publish(
      publisher,
      topic,
      emergencyPayload(fixture, `event-${randomUUID()}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(0);

    subscriber = new EmergencyMqttSubscriber(
      new EmergencyMqttIngestionService(topicPrefix, repository),
      logger,
      {
        mqttUrl: config.mqttUrl,
        topicPrefix,
        clientId,
        timeoutMs: config.readinessTimeoutMs,
      },
    );
    await withTimeout(subscriber.ready(), 5_000);
    await waitFor(
      async () =>
        (await database.emergencySignal.count({
          where: { sourceBindingId: fixture.sourceBindingId },
        })) === 1,
      8_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      await database.emergencySignal.count({
        where: { sourceBindingId: fixture.sourceBindingId },
      }),
    ).toBe(1);
    const queuedSignal = await database.emergencySignal.findFirstOrThrow({
      where: { sourceBindingId: fixture.sourceBindingId },
      select: { emergencyEventId: true },
    });
    expect(
      await database.emergencyEvent.count({
        where: { id: queuedSignal.emergencyEventId },
      }),
    ).toBe(1);
  }, 20_000);
});

function persistentClientId(label: string): string {
  const clientId = `worker-m04-${label}-${randomUUID()}`;
  persistentClientIds.add(clientId);
  return clientId;
}

function emergencyPayload(
  currentFixture: M04IntegrationFixture,
  eventId: string,
) {
  return {
    schemaVersion: '1.0',
    eventId,
    organizationSlug: currentFixture.organizationSlug,
    facilityCode: currentFixture.facilityCode,
    sourceId: currentFixture.sourceId,
    timestamp: new Date().toISOString(),
    reasonCode: 'IOT_EMERGENCY_BUTTON',
  };
}

async function createPublisher(label: string): Promise<MqttClient> {
  const client = connect(config.mqttUrl, {
    clean: true,
    clientId: `worker-m04-publisher-${label}-${randomUUID()}`,
    reconnectPeriod: 0,
  });
  await withTimeout(waitForMqttConnect(client), 5_000);
  return client;
}

async function publish(
  client: MqttClient,
  topic: string,
  payload: unknown,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.publish(
      topic,
      JSON.stringify(payload),
      { qos: 1, retain: false },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

async function waitForMqttConnect(client: MqttClient): Promise<void> {
  if (client.connected) return;
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });
}

async function closePublisher(client: MqttClient | undefined): Promise<void> {
  if (client === undefined) return;
  await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
}

async function clearPersistentSession(clientId: string): Promise<void> {
  const cleaner = connect(config.mqttUrl, {
    clean: true,
    clientId,
    reconnectPeriod: 0,
  });
  await withTimeout(waitForMqttConnect(cleaner), 5_000);
  await new Promise<void>((resolve) => {
    cleaner.end(false, {}, () => resolve());
  });
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for integration condition');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for MQTT readiness')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
