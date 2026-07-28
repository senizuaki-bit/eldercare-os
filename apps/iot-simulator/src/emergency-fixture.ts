import { mqttEmergencySignalPayloadSchema } from '@eldercare/contracts';

export type EmergencyLocationMode = 'current' | 'stale' | 'missing';

export interface EmergencyFixtureOptions {
  readonly organizationSlug: string;
  readonly facilityCode: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly location: EmergencyLocationMode;
  readonly topicPrefix?: string;
  readonly now?: Date;
}

export interface EmergencyFixture {
  readonly topic: string;
  readonly message: ReturnType<typeof mqttEmergencySignalPayloadSchema.parse>;
}

const LOCATION_TTL_MS = 5 * 60 * 1000;
const STALE_LOCATION_AGE_MS = 10 * 60 * 1000;

export function buildEmergencyFixture(options: EmergencyFixtureOptions): EmergencyFixture {
  const now = options.now ?? new Date();
  const location =
    options.location === 'missing'
      ? undefined
      : buildLocationFixture(options.location, now);

  const message = mqttEmergencySignalPayloadSchema.parse({
    schemaVersion: '1.0',
    eventId: options.eventId,
    sourceId: options.sourceId,
    organizationSlug: options.organizationSlug,
    facilityCode: options.facilityCode,
    timestamp: now.toISOString(),
    reasonCode: 'IOT_EMERGENCY_BUTTON',
    ...(location === undefined ? {} : { location }),
  });

  return {
    topic: buildEmergencyTopic(options),
    message,
  };
}

function buildLocationFixture(mode: Exclude<EmergencyLocationMode, 'missing'>, now: Date) {
  const observedAt =
    mode === 'current'
      ? new Date(now.getTime() - 5_000)
      : new Date(now.getTime() - STALE_LOCATION_AGE_MS);

  return {
    source: 'DEVICE',
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + LOCATION_TTL_MS).toISOString(),
    normalizedX: 0.42,
    normalizedY: 0.36,
    accuracyMeters: 4,
  } as const;
}

export interface EmergencyCliOptions {
  readonly organizationSlug: string;
  readonly facilityCode: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly location: EmergencyLocationMode;
}

const DEFAULTS: EmergencyCliOptions = {
  organizationSlug: 'qinglan-demo',
  facilityCode: 'QL-MAIN',
  sourceId: 'call-device-qinglan-001',
  eventId: 'b2000000-0000-4000-8000-000000000001',
  location: 'current',
};

export function parseEmergencyCliOptions(args: readonly string[]): EmergencyCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === undefined || !key.startsWith('--') || key === '--emergency') continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const location = values.get('--location') ?? DEFAULTS.location;
  if (location !== 'current' && location !== 'stale' && location !== 'missing') {
    throw new Error('Emergency location must be current, stale, or missing');
  }

  return {
    organizationSlug:
      values.get('--organization-slug') ?? DEFAULTS.organizationSlug,
    facilityCode: values.get('--facility-code') ?? DEFAULTS.facilityCode,
    sourceId: values.get('--source-id') ?? DEFAULTS.sourceId,
    eventId: values.get('--event-id') ?? DEFAULTS.eventId,
    location,
  };
}

export function buildEmergencyTopic(
  options: Pick<
    EmergencyFixtureOptions,
    'organizationSlug' | 'facilityCode' | 'sourceId' | 'topicPrefix'
  >,
): string {
  const prefix = options.topicPrefix?.replace(/\/+$/, '');
  if (prefix === undefined || prefix.length === 0) {
    throw new Error('MQTT topic prefix is required');
  }
  for (const value of [
    options.organizationSlug,
    options.facilityCode,
    options.sourceId,
  ]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
      throw new Error('Emergency MQTT topic contains an unsafe segment');
    }
  }
  return [
    prefix,
    'v1',
    'orgs',
    options.organizationSlug,
    'facilities',
    options.facilityCode,
    'emergency',
    options.sourceId,
  ].join('/');
}
