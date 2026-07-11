import { parseServiceConfig } from '@eldercare/config';
import { createLogger } from '@eldercare/observability';
import { checkBroker, connectToBroker } from './broker.js';
import { parseMode } from './mode.js';

const config = parseServiceConfig();
const logger = createLogger({ service: 'iot-simulator', level: config.logLevel });
const mode = parseMode(process.argv.slice(2));

async function run(): Promise<void> {
  if (mode === 'dry-run') {
    logger.info('IoT simulator dry run passed', { publishEnabled: false, topicPrefix: config.mqttTopicPrefix });
    return;
  }

  if (mode === 'check') {
    await checkBroker(config.mqttUrl, config.readinessTimeoutMs);
    logger.info('MQTT broker readiness check passed', { publishEnabled: false });
    return;
  }

  const client = connectToBroker(config.mqttUrl, config.readinessTimeoutMs);
  client.on('connect', () => logger.info('IoT simulator connected', { publishEnabled: false }));
  client.on('reconnect', () => logger.info('IoT simulator reconnecting', { publishEnabled: false }));
  client.on('error', () => logger.warn('IoT simulator broker unavailable', { retrying: true }));

  const shutdown = (): void => {
    client.end(false, {}, () => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void run().catch(() => {
  logger.error('IoT simulator readiness failed', { mode });
  process.exitCode = 1;
});
