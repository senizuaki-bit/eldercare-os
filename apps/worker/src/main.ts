import { parseServiceConfig } from '@eldercare/config';
import { createPrismaClient } from '@eldercare/db';
import { createLogger } from '@eldercare/observability';
import { createHealthServer } from './health-server.js';
import { createDependencyProbe } from './probes.js';
import {
  EmergencySlaProcessor,
  EmergencySlaScheduler,
  EmergencySlaWorker,
} from './emergency-sla.js';
import {
  EmergencyMqttIngestionService,
  EmergencyMqttSubscriber,
} from './emergency-mqtt.js';
import { FakeEmergencyNotificationProvider } from './fake-emergency-notification.js';
import {
  FamilyEmergencyNotificationDispatcher,
  PrismaFamilyEmergencyDeliveryRepository,
} from './family-emergency-notifications.js';
import {
  EmergencyLocationRetentionCleanup,
  PrismaEmergencyLocationRetentionRepository,
} from './emergency-location-retention.js';
import { PrismaEmergencyMqttRepository } from './prisma-emergency-mqtt-repository.js';
import { PrismaEmergencySlaRepository } from './prisma-emergency-sla-repository.js';
import {
  PrismaVoiceRetentionRepository,
  S3VoiceObjectDeletionStore,
  VoiceRetentionCleanup,
} from './voice-retention-cleanup.js';

const RETENTION_CLEANUP_INTERVAL_MS = 60_000;
const EMERGENCY_RECONCILIATION_INTERVAL_MS = 2_000;
const FAMILY_NOTIFICATION_INTERVAL_MS = 2_000;

const config = parseServiceConfig();
const logger = createLogger({ service: 'worker', level: config.logLevel });
const probe = createDependencyProbe(config.databaseUrl, config.redisUrl, config.readinessTimeoutMs);
const server = createHealthServer({ appVersion: config.appVersion, probe });
const retentionDatabase = createPrismaClient(config.databaseUrl);
const retentionCleanup = new VoiceRetentionCleanup(
  new PrismaVoiceRetentionRepository(retentionDatabase),
  new S3VoiceObjectDeletionStore(config),
  logger,
);
const emergencyLocationRetentionCleanup = new EmergencyLocationRetentionCleanup(
  new PrismaEmergencyLocationRetentionRepository(retentionDatabase),
  logger,
);
const emergencySlaRepository = new PrismaEmergencySlaRepository(retentionDatabase);
const fakeNotifications = new FakeEmergencyNotificationProvider(logger);
const emergencySlaScheduler = new EmergencySlaScheduler({
  redisUrl: config.redisUrl,
  prefix: config.emergencyQueuePrefix,
});
const emergencySlaProcessor = new EmergencySlaProcessor(
  emergencySlaRepository,
  fakeNotifications,
  logger,
);
const emergencySlaWorker = new EmergencySlaWorker(
  emergencySlaProcessor,
  logger,
  {
    redisUrl: config.redisUrl,
    prefix: config.emergencyQueuePrefix,
  },
);
const familyNotificationDispatcher = new FamilyEmergencyNotificationDispatcher(
  new PrismaFamilyEmergencyDeliveryRepository(retentionDatabase),
  fakeNotifications,
  logger,
);
const emergencyMqttSubscriber = new EmergencyMqttSubscriber(
  new EmergencyMqttIngestionService(
    config.mqttTopicPrefix,
    new PrismaEmergencyMqttRepository(retentionDatabase, {
      duplicateWindowSeconds: config.emergencyDuplicateWindowSeconds,
      locationRetentionHours: config.emergencyLocationRetentionHours,
    }),
  ),
  logger,
  {
    mqttUrl: config.mqttUrl,
    topicPrefix: config.mqttTopicPrefix,
    clientId: config.mqttEmergencyClientId,
    timeoutMs: config.readinessTimeoutMs,
  },
);

function runRetentionCleanup(): void {
  void retentionCleanup.runOnce().catch(() => {
    logger.warn('Voice retention cleanup run failed', { reasonCode: 'RETENTION_CLEANUP_RUN_FAILED' });
  });
  void emergencyLocationRetentionCleanup.runOnce().catch(() => {
    logger.warn('Emergency location retention cleanup run failed', {
      reasonCode: 'EMERGENCY_LOCATION_RETENTION_CLEANUP_FAILED',
    });
  });
}

runRetentionCleanup();
const retentionTimer = setInterval(runRetentionCleanup, RETENTION_CLEANUP_INTERVAL_MS);
retentionTimer.unref();

let reconciliationRunning = false;
function reconcileEmergencySla(): void {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  void emergencySlaScheduler
    .reconcile(emergencySlaRepository)
    .catch(() => {
      logger.warn('Emergency SLA reconciliation failed', {
        reasonCode: 'EMERGENCY_SLA_RECONCILIATION_FAILED',
      });
    })
    .finally(() => {
      reconciliationRunning = false;
    });
}

let familyNotificationsRunning = false;
function dispatchFamilyNotifications(): void {
  if (familyNotificationsRunning) return;
  familyNotificationsRunning = true;
  void familyNotificationDispatcher
    .runOnce()
    .catch(() => {
      logger.warn('Family emergency notification dispatch failed', {
        reasonCode: 'FAMILY_EMERGENCY_NOTIFICATION_DISPATCH_FAILED',
      });
    })
    .finally(() => {
      familyNotificationsRunning = false;
    });
}

reconcileEmergencySla();
dispatchFamilyNotifications();
const emergencyReconciliationTimer = setInterval(
  reconcileEmergencySla,
  EMERGENCY_RECONCILIATION_INTERVAL_MS,
);
emergencyReconciliationTimer.unref();
const familyNotificationTimer = setInterval(
  dispatchFamilyNotifications,
  FAMILY_NOTIFICATION_INTERVAL_MS,
);
familyNotificationTimer.unref();

server.listen(config.workerPort, '0.0.0.0', () => {
  logger.info('Worker readiness server started', { port: config.workerPort });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Worker shutting down', { signal });
  clearInterval(retentionTimer);
  clearInterval(emergencyReconciliationTimer);
  clearInterval(familyNotificationTimer);
  await Promise.allSettled([
    emergencyMqttSubscriber.close(),
    emergencySlaWorker.close(),
    emergencySlaScheduler.close(),
  ]);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await probe.close();
  await retentionDatabase.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
