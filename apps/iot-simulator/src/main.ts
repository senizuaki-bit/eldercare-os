import { parseServiceConfig } from '@eldercare/config';
import { createLogger } from '@eldercare/observability';
import { checkBroker, connectToBroker, publishMessage } from './broker.js';
import { buildEmergencyFixture, parseEmergencyCliOptions } from './emergency-fixture.js';
import { parseMode } from './mode.js';

const config = parseServiceConfig();
const logger = createLogger({ service: 'iot-simulator', level: config.logLevel });
const args = process.argv.slice(2);
const mode = parseMode(args);

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

  if (mode === 'emergency') {
    const options = parseEmergencyCliOptions(args);
    const fixture = buildEmergencyFixture({
      ...options,
      topicPrefix: config.mqttTopicPrefix,
    });
    await publishMessage(
      config.mqttUrl,
      config.readinessTimeoutMs,
      fixture.topic,
      JSON.stringify(fixture.message),
    );
    logger.info('Emergency fixture published', {
      eventId: options.eventId,
      locationMode: options.location,
      publishEnabled: true,
    });
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
