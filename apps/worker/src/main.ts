import { parseServiceConfig } from '@eldercare/config';
import { createLogger } from '@eldercare/observability';
import { createHealthServer } from './health-server.js';
import { createDependencyProbe } from './probes.js';

const config = parseServiceConfig();
const logger = createLogger({ service: 'worker', level: config.logLevel });
const probe = createDependencyProbe(config.databaseUrl, config.redisUrl, config.readinessTimeoutMs);
const server = createHealthServer({ appVersion: config.appVersion, probe });

server.listen(config.workerPort, '0.0.0.0', () => {
  logger.info('Worker readiness server started', { port: config.workerPort });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('Worker shutting down', { signal });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await probe.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
