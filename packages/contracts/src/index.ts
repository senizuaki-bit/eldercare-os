import { z } from 'zod';
import { identifierSchema, isoTimestampSchema } from './common.js';

export * from './audit.js';
export * from './auth.js';
export * from './common.js';
export * from './identity.js';
export * from './facility-directory.js';
export * from './elder.js';
export * from './staffing.js';
export * from './needs-workorders.js';

export const healthCheckSchema = z
  .enum(['ok', 'error']);

export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'error']),
    service: z.string().min(1).max(64),
    version: z.string().min(1).max(64),
    timestamp: isoTimestampSchema,
    checks: z.record(z.string().min(1), healthCheckSchema).optional(),
  })
  .strict();

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorDetailSchema = z
  .object({
    field: z.string().min(1).max(128),
    code: z.string().min(1).max(64),
  })
  .strict();

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(512),
        correlationId: identifierSchema,
        details: z.array(errorDetailSchema).max(100).optional(),
      })
      .strict(),
    timestamp: isoTimestampSchema,
  })
  .strict();

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const mqttTopicKindSchema = z.enum([
  'heartbeat',
  'telemetry',
  'location',
  'event',
]);

const topicPrefixSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
    'must contain safe MQTT topic segments',
  );

export const mqttTopicPartsSchema = z
  .object({
    organizationId: identifierSchema,
    facilityId: identifierSchema,
    deviceId: identifierSchema,
    version: z.string().regex(/^v[1-9]\d*$/).default('v1'),
    kind: mqttTopicKindSchema,
    prefix: topicPrefixSchema.optional(),
  })
  .strict();

export type MqttTopicKind = z.infer<typeof mqttTopicKindSchema>;
export type MqttTopicParts = z.output<typeof mqttTopicPartsSchema>;

export function buildMqttTopic(input: z.input<typeof mqttTopicPartsSchema>): string {
  const parts = mqttTopicPartsSchema.parse(input);
  const baseTopic = [
    'org',
    parts.organizationId,
    'facility',
    parts.facilityId,
    'device',
    parts.deviceId,
    parts.version,
    parts.kind,
  ].join('/');

  return parts.prefix === undefined ? baseTopic : `${parts.prefix}/${baseTopic}`;
}

export function parseMqttTopic(topic: string, prefix?: string): MqttTopicParts {
  const parsedPrefix = prefix === undefined ? undefined : topicPrefixSchema.parse(prefix);
  const baseTopic =
    parsedPrefix === undefined
      ? topic
      : topic.startsWith(`${parsedPrefix}/`)
        ? topic.slice(parsedPrefix.length + 1)
        : '';
  const match =
    /^org\/([^/]+)\/facility\/([^/]+)\/device\/([^/]+)\/(v[1-9]\d*)\/([^/]+)$/.exec(
      baseTopic,
    );

  if (match === null) {
    throw new Error('Invalid MQTT topic');
  }

  return mqttTopicPartsSchema.parse({
    organizationId: match[1],
    facilityId: match[2],
    deviceId: match[3],
    version: match[4],
    kind: match[5],
    prefix: parsedPrefix,
  });
}

export const mqttBaseMessageSchema = z
  .object({
    schemaVersion: z.string().regex(/^[1-9]\d*\.\d+$/),
    eventId: identifierSchema,
    deviceId: identifierSchema,
    timestamp: isoTimestampSchema,
    nonce: z.string().min(1).max(256).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type MqttBaseMessage = z.infer<typeof mqttBaseMessageSchema>;
export type MQTTBaseMessage = MqttBaseMessage;
export const mqttMessageSchema = mqttBaseMessageSchema;
