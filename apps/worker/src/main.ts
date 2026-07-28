import { parseServiceConfig } from '@eldercare/config';
import { createPrismaClient } from '@eldercare/db';
import { createLogger } from '@eldercare/observability';
import { createHealthServer } from './health-server.js';
import { createDependencyProbe } from './probes.js';
import {
  PrismaVoiceRetentionRepository,
  S3VoiceObjectDeletionStore,
  VoiceRetentionCleanup,
} from './voice-retention-cleanup.js';

const RETENTION_CLEANUP_INTERVAL_MS = 60_000;

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

function runRetentionCleanup(): void {
  void retentionCleanup.runOnce().catch(() => {
    logger.warn('Voice retention cleanup run failed', { reasonCode: 'RETENTION_CLEANUP_RUN_FAILED' });
  });
}

runRetentionCleanup();
const retentionTimer = setInterval(runRetentionCleanup, RETENTION_CLEANUP_INTERVAL_MS);
retentionTimer.unref();

server.listen(config.workerPort, '0.0.0.0', () => {
  logger.info('Worker readiness server started', { port: config.workerPort });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Worker shutting down', { signal });
  clearInterval(retentionTimer);
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
