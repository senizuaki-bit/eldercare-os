import { randomUUID } from 'node:crypto';
import { parseServiceConfig } from '@eldercare/config';
import { createPrismaClient } from '@eldercare/db';
import { createLogger } from '@eldercare/observability';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMERGENCY_SLA_QUEUE,
  EmergencySlaProcessor,
  EmergencySlaScheduler,
  EmergencySlaWorker,
  emergencySlaJobId,
} from '../../src/emergency-sla.js';
import { EmergencyMqttIngestionService } from '../../src/emergency-mqtt.js';
import { FakeEmergencyNotificationProvider } from '../../src/fake-emergency-notification.js';
import { PrismaEmergencyMqttRepository } from '../../src/prisma-emergency-mqtt-repository.js';
import { PrismaEmergencySlaRepository } from '../../src/prisma-emergency-sla-repository.js';
import {
  createM04IntegrationFixture,
  deleteM04IntegrationFixture,
  type M04IntegrationFixture,
} from './m04-fixture.js';

const config = parseServiceConfig();
const database = createPrismaClient(config.databaseUrl);
let fixture: M04IntegrationFixture;
let queuePrefix: string;
let scheduler: EmergencySlaScheduler | undefined;
let worker: EmergencySlaWorker | undefined;

beforeEach(async () => {
  fixture = await createM04IntegrationFixture(database);
  queuePrefix = `eldercare:test:m04:${randomUUID().replaceAll('-', '')}`;
});

afterEach(async () => {
  await Promise.allSettled([
    worker?.close() ?? Promise.resolve(),
    scheduler?.close() ?? Promise.resolve(),
  ]);
  worker = undefined;
  scheduler = undefined;
  await deleteQueueKeys(queuePrefix);
  if (fixture !== undefined) {
    await deleteM04IntegrationFixture(database, fixture);
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe('emergency SLA BullMQ workflow', () => {
  it('triggers once and treats a progressed event as a cancellation no-op', async () => {
    const mqttRepository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    const topicPrefix = `sla-it-${randomUUID().replaceAll('-', '')}`;
    const ingestion = new EmergencyMqttIngestionService(
      topicPrefix,
      mqttRepository,
    );
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const first = await ingestion.ingest(
      topic,
      Buffer.from(JSON.stringify(mqttPayload(fixture, `event-${randomUUID()}`))),
    );
    if (first.kind !== 'created') throw new Error('Expected created emergency');
    const firstEscalation = await database.emergencyEscalation.findFirstOrThrow({
      where: {
        emergencyEventId: first.emergencyEventId,
        stage: 'ACKNOWLEDGEMENT',
      },
      include: { emergencyEvent: true, escalationStep: true },
    });
    await database.emergencyEscalation.update({
      where: { id: firstEscalation.id },
      data: { dueAt: new Date(Date.now() - 1_000) },
    });

    const logger = createLogger({
      service: 'worker-sla-integration',
      sink: () => undefined,
    });
    const repository = new PrismaEmergencySlaRepository(database);
    const notifications = new FakeEmergencyNotificationProvider(logger);
    scheduler = new EmergencySlaScheduler({
      redisUrl: config.redisUrl,
      prefix: queuePrefix,
    });
    worker = new EmergencySlaWorker(
      new EmergencySlaProcessor(repository, notifications, logger),
      logger,
      { redisUrl: config.redisUrl, prefix: queuePrefix },
    );
    await scheduler.reconcile(repository);
    await waitFor(async () =>
      (await database.emergencyEscalation.findUnique({
        where: { id: firstEscalation.id },
        select: { status: true },
      }))?.status === 'TRIGGERED',
    );
    expect(
      await database.outboxEvent.count({
        where: {
          organizationId: fixture.organizationId,
          aggregateId: first.emergencyEventId,
          eventType: 'EMERGENCY.ESCALATED',
        },
      }),
    ).toBe(1);
    const escalationOutbox = await database.outboxEvent.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        aggregateId: first.emergencyEventId,
        eventType: 'EMERGENCY.ESCALATED',
      },
    });
    expect(escalationOutbox.payload).toEqual({
      emergencyId: first.emergencyEventId,
      elderId: fixture.elderId,
      status: 'OPEN',
      version: 1,
      reasonCode: firstEscalation.escalationStep.reasonCode,
      slaStage: 'ACKNOWLEDGEMENT',
    });
    expect(escalationOutbox.aggregateType).toBe('EMERGENCY_EVENT');

    await scheduler.reconcile(repository);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      await database.outboxEvent.count({
        where: {
          organizationId: fixture.organizationId,
          aggregateId: first.emergencyEventId,
          eventType: 'EMERGENCY.ESCALATED',
        },
      }),
    ).toBe(1);

    const second = await ingestion.ingest(
      topic,
      Buffer.from(JSON.stringify(mqttPayload(fixture, `event-${randomUUID()}`))),
    );
    if (second.kind !== 'created') throw new Error('Expected second emergency');
    const cancelledEscalation = await database.emergencyEscalation.findFirstOrThrow({
      where: {
        emergencyEventId: second.emergencyEventId,
        stage: 'ACKNOWLEDGEMENT',
      },
    });
    await database.$transaction([
      database.emergencyEvent.update({
        where: { id: second.emergencyEventId },
        data: {
          status: 'ACKNOWLEDGED',
          version: { increment: 1 },
          acknowledgedAt: new Date(),
        },
      }),
      database.emergencyEscalation.update({
        where: { id: cancelledEscalation.id },
        data: { dueAt: new Date(Date.now() - 1_000) },
      }),
    ]);
    await scheduler.reconcile(repository);
    await waitFor(async () =>
      (await database.emergencyEscalation.findUnique({
        where: { id: cancelledEscalation.id },
        select: { status: true },
      }))?.status === 'CANCELLED',
    );
    expect(
      await database.outboxEvent.count({
        where: {
          organizationId: fixture.organizationId,
          aggregateId: second.emergencyEventId,
          eventType: 'EMERGENCY.ESCALATED',
        },
      }),
    ).toBe(0);
  }, 20_000);

  it('removes acknowledgement, arrival, and resolution jobs on progress', async () => {
    const mqttRepository = new PrismaEmergencyMqttRepository(database, {
      duplicateWindowSeconds: 30,
      locationRetentionHours: 24,
    });
    const topicPrefix = `sla-cancel-it-${randomUUID().replaceAll('-', '')}`;
    const ingestion = new EmergencyMqttIngestionService(
      topicPrefix,
      mqttRepository,
    );
    const topic = `${topicPrefix}/v1/orgs/${fixture.organizationSlug}/facilities/${fixture.facilityCode}/emergency/${fixture.sourceId}`;
    const created = await ingestion.ingest(
      topic,
      Buffer.from(JSON.stringify(mqttPayload(fixture, `event-${randomUUID()}`))),
    );
    if (created.kind !== 'created') throw new Error('Expected created emergency');
    const escalations = await database.emergencyEscalation.findMany({
      where: { emergencyEventId: created.emergencyEventId },
    });
    const byStage = new Map(
      escalations.map((escalation) => [escalation.stage, escalation]),
    );
    const acknowledgement = byStage.get('ACKNOWLEDGEMENT');
    const arrival = byStage.get('ARRIVAL');
    const resolution = byStage.get('RESOLUTION');
    if (
      acknowledgement === undefined ||
      arrival === undefined ||
      resolution === undefined
    ) {
      throw new Error('Expected all emergency SLA stages');
    }

    const repository = new PrismaEmergencySlaRepository(database);
    scheduler = new EmergencySlaScheduler({
      redisUrl: config.redisUrl,
      prefix: queuePrefix,
    });
    await scheduler.reconcile(repository);
    const inspectionConnection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
    const inspectionQueue = new Queue(EMERGENCY_SLA_QUEUE, {
      connection: inspectionConnection,
      prefix: queuePrefix,
    });
    try {
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(acknowledgement.id)),
      ).resolves.toBeDefined();
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(arrival.id)),
      ).resolves.toBeDefined();
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(resolution.id)),
      ).resolves.toBeDefined();

      const acknowledgedAt = new Date();
      await database.$transaction([
        database.emergencyEvent.update({
          where: { id: created.emergencyEventId },
          data: {
            status: 'ACKNOWLEDGED',
            version: { increment: 1 },
            acknowledgedAt,
          },
        }),
        database.emergencyEscalation.update({
          where: { id: acknowledgement.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: acknowledgedAt,
          },
        }),
      ]);
      await scheduler.reconcile(repository);
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(acknowledgement.id)),
      ).resolves.toBeUndefined();

      const onSiteAt = new Date(acknowledgedAt.getTime() + 1);
      await database.$transaction([
        database.emergencyEvent.update({
          where: { id: created.emergencyEventId },
          data: {
            status: 'RESPONDING',
            version: { increment: 1 },
            respondingAt: onSiteAt,
            onSiteAt,
          },
        }),
        database.emergencyEscalation.update({
          where: { id: arrival.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: onSiteAt,
          },
        }),
      ]);
      await scheduler.reconcile(repository);
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(arrival.id)),
      ).resolves.toBeUndefined();

      const resolvedAt = new Date(onSiteAt.getTime() + 1);
      await database.$transaction([
        database.emergencyEvent.update({
          where: { id: created.emergencyEventId },
          data: {
            status: 'RESOLVED',
            version: { increment: 1 },
            resolvedAt,
          },
        }),
        database.emergencyEscalation.update({
          where: { id: resolution.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: resolvedAt,
          },
        }),
      ]);
      await scheduler.reconcile(repository);
      await expect(
        inspectionQueue.getJob(emergencySlaJobId(resolution.id)),
      ).resolves.toBeUndefined();
    } finally {
      await inspectionQueue.close();
      if (inspectionConnection.status !== 'end') {
        await inspectionConnection.quit();
      }
    }
  }, 20_000);
});

function mqttPayload(fixture: M04IntegrationFixture, eventId: string) {
  return {
    schemaVersion: '1.0',
    eventId,
    organizationSlug: fixture.organizationSlug,
    facilityCode: fixture.facilityCode,
    sourceId: fixture.sourceId,
    timestamp: new Date().toISOString(),
    reasonCode: 'IOT_EMERGENCY_BUTTON',
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for BullMQ integration condition');
}

async function deleteQueueKeys(prefix: string): Promise<void> {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(EMERGENCY_SLA_QUEUE, { connection, prefix });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
    if (connection.status !== 'end') await connection.quit();
  }
}
