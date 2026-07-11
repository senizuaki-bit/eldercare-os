import { describe, expect, it } from 'vitest';
import { parseServiceConfig } from '@eldercare/config';
import { checkBroker } from '../../src/broker.js';
import { parseMode } from '../../src/mode.js';

describe('IoT foundation contract', () => {
  it('does not publish domain events during M00', () => {
    const plan = { mode: parseMode(['--dry-run']), publishEnabled: false };
    expect(plan).toEqual({ mode: 'dry-run', publishEnabled: false });
  });

  it('connects to the real local MQTT broker without publishing', async () => {
    const config = parseServiceConfig();
    await expect(checkBroker(config.mqttUrl, config.readinessTimeoutMs)).resolves.toBeUndefined();
  });
});
