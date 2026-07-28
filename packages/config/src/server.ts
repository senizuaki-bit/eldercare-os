import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { z } from 'zod';

import { ConfigValidationError, type Environment } from './shared.js';

const rootEnvironmentFile = new URL('../../../.env', import.meta.url);
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

function usesProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const portSchema = z.coerce.number().int().min(1).max(65_535);
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, ['http:', 'https:']), {
    message: 'must use http or https',
  });
const corsOriginSchema = httpUrlSchema
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.pathname !== '/' ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      context.addIssue({ code: 'custom', message: 'must be an origin without credentials or path' });
    }
  })
  .transform((value) => new URL(value).origin);
const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, ['postgres:', 'postgresql:']), {
    message: 'must use postgres or postgresql',
  });
const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, ['redis:', 'rediss:']), {
    message: 'must use redis or rediss',
  });
const mqttUrlSchema = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, ['mqtt:', 'mqtts:', 'ws:', 'wss:']), {
    message: 'must use mqtt, mqtts, ws, or wss',
  });
const mqttPrefixSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const corsOriginsSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(corsOriginSchema).min(1))
  .transform((origins) => [...new Set(origins)]);

const rawServiceConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().min(1).max(64).default('0.0.1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_PORT: portSchema.default(4000),
  WORKER_PORT: portSchema.default(4001),
  ADMIN_WEB_PORT: portSchema.default(3000),
  MOBILE_WEB_PORT: portSchema.default(3001),
  CORS_ORIGINS: corsOriginsSchema,
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  MINIO_ENDPOINT: httpUrlSchema,
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(900)
    .default(300),
  VOICE_STAGING_SWEEP_MIN_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(120)
    .max(86_400)
    .default(900),
  MQTT_URL: mqttUrlSchema,
  MQTT_TOPIC_PREFIX: mqttPrefixSchema,
  MQTT_EMERGENCY_CLIENT_ID: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .default('eldercare-m04-worker-emergency-v1'),
  EMERGENCY_LOCATION_RETENTION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(720)
    .default(24),
  EMERGENCY_DUPLICATE_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(300)
    .default(30),
  EMERGENCY_FALLBACK_PHONE: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^\+?[0-9][0-9 ()-]*$/)
    .default('400-000-0120'),
  EMERGENCY_QUEUE_PREFIX: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/)
    .default('eldercare:emergency'),
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(1500),
  AUTH_SESSION_IDLE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(1800),
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(604_800)
    .default(28_800),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(900),
  AUTH_RATE_LIMIT_KEY_PREFIX: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/)
    .default('eldercare:auth'),
}).superRefine((value, context) => {
  if (value.AUTH_SESSION_ABSOLUTE_TTL_SECONDS <= value.AUTH_SESSION_IDLE_TTL_SECONDS) {
    context.addIssue({
      code: 'custom',
      path: ['AUTH_SESSION_ABSOLUTE_TTL_SECONDS'],
      message: 'must be greater than AUTH_SESSION_IDLE_TTL_SECONDS',
    });
  }
  if (
    value.VOICE_STAGING_SWEEP_MIN_AGE_SECONDS <=
    value.VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS + 60
  ) {
    context.addIssue({
      code: 'custom',
      path: ['VOICE_STAGING_SWEEP_MIN_AGE_SECONDS'],
      message: 'must exceed VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS by more than 60 seconds',
    });
  }
});

export const serviceConfigSchema = rawServiceConfigSchema.transform((value) => ({
  nodeEnv: value.NODE_ENV,
  appVersion: value.APP_VERSION,
  logLevel: value.LOG_LEVEL,
  apiPort: value.API_PORT,
  workerPort: value.WORKER_PORT,
  adminWebPort: value.ADMIN_WEB_PORT,
  mobileWebPort: value.MOBILE_WEB_PORT,
  corsOrigins: value.CORS_ORIGINS,
  databaseUrl: value.DATABASE_URL,
  redisUrl: value.REDIS_URL,
  minioEndpoint: value.MINIO_ENDPOINT,
  minioAccessKey: value.MINIO_ACCESS_KEY,
  minioSecretKey: value.MINIO_SECRET_KEY,
  minioBucket: value.MINIO_BUCKET,
  voiceUploadAuthorizationTtlSeconds: value.VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS,
  voiceStagingSweepMinAgeSeconds: value.VOICE_STAGING_SWEEP_MIN_AGE_SECONDS,
  mqttUrl: value.MQTT_URL,
  mqttTopicPrefix: value.MQTT_TOPIC_PREFIX,
  mqttEmergencyClientId: value.MQTT_EMERGENCY_CLIENT_ID,
  emergencyLocationRetentionHours: value.EMERGENCY_LOCATION_RETENTION_HOURS,
  emergencyDuplicateWindowSeconds: value.EMERGENCY_DUPLICATE_WINDOW_SECONDS,
  emergencyFallbackPhone: value.EMERGENCY_FALLBACK_PHONE,
  emergencyQueuePrefix: value.EMERGENCY_QUEUE_PREFIX,
  readinessTimeoutMs: value.READINESS_TIMEOUT_MS,
  authSessionIdleTtlSeconds: value.AUTH_SESSION_IDLE_TTL_SECONDS,
  authSessionAbsoluteTtlSeconds: value.AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  authRateLimitMaxAttempts: value.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  authRateLimitWindowSeconds: value.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  authRateLimitKeyPrefix: value.AUTH_RATE_LIMIT_KEY_PREFIX,
}));

export type ServiceConfig = z.output<typeof serviceConfigSchema>;

export function parseServiceConfig(environment: Environment = process.env): ServiceConfig {
  const result = serviceConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigValidationError(
      'service',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  return result.data;
}
