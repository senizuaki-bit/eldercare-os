import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  parseBrowserConfig,
  parseServiceConfig,
} from './index.js';

const validEnvironment = {
  NODE_ENV: 'test',
  APP_VERSION: '0.0.1-test',
  LOG_LEVEL: 'warn',
  API_PORT: '4100',
  WORKER_PORT: '4101',
  ADMIN_WEB_PORT: '3100',
  MOBILE_WEB_PORT: '3101',
  CORS_ORIGINS: 'http://localhost:3100, http://localhost:3101',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/eldercare',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'local-access',
  MINIO_SECRET_KEY: 'local-secret',
  MINIO_BUCKET: 'eldercare-private',
  MQTT_URL: 'mqtt://localhost:1883',
  MQTT_TOPIC_PREFIX: 'eldercare-test',
  READINESS_TIMEOUT_MS: '2000',
} as const;

describe('typed configuration', () => {
  it('returns the server shape expected by services', () => {
    const config = parseServiceConfig(validEnvironment);

    expect(config).toMatchObject({
      nodeEnv: 'test',
      apiPort: 4100,
      workerPort: 4101,
      corsOrigins: ['http://localhost:3100', 'http://localhost:3101'],
      readinessTimeoutMs: 2000,
      authSessionIdleTtlSeconds: 1800,
      authSessionAbsoluteTtlSeconds: 28_800,
      authRateLimitMaxAttempts: 5,
      authRateLimitWindowSeconds: 900,
      authRateLimitKeyPrefix: 'eldercare:auth',
      voiceUploadAuthorizationTtlSeconds: 300,
      voiceStagingSweepMinAgeSeconds: 900,
    });
  });

  it('keeps the staging orphan sweep safely beyond the upload authorization window', () => {
    expect(
      parseServiceConfig({
        ...validEnvironment,
        VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS: '240',
        VOICE_STAGING_SWEEP_MIN_AGE_SECONDS: '600',
      }),
    ).toMatchObject({
      voiceUploadAuthorizationTtlSeconds: 240,
      voiceStagingSweepMinAgeSeconds: 600,
    });

    expect(() =>
      parseServiceConfig({
        ...validEnvironment,
        VOICE_UPLOAD_AUTHORIZATION_TTL_SECONDS: '300',
        VOICE_STAGING_SWEEP_MIN_AGE_SECONDS: '360',
      }),
    ).toThrow('VOICE_STAGING_SWEEP_MIN_AGE_SECONDS');
  });

  it('validates session lifetime ordering and auth rate-limit settings', () => {
    expect(() =>
      parseServiceConfig({
        ...validEnvironment,
        AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
        AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '1800',
      }),
    ).toThrow('AUTH_SESSION_ABSOLUTE_TTL_SECONDS');

    expect(
      parseServiceConfig({
        ...validEnvironment,
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: '7',
        AUTH_RATE_LIMIT_KEY_PREFIX: 'eldercare:test-auth',
      }),
    ).toMatchObject({
      authRateLimitMaxAttempts: 7,
      authRateLimitKeyPrefix: 'eldercare:test-auth',
    });
  });

  it('normalizes and strictly validates CORS origins', () => {
    expect(
      parseServiceConfig({
        ...validEnvironment,
        CORS_ORIGINS: 'http://localhost:3100/, http://localhost:3100',
      }).corsOrigins,
    ).toEqual(['http://localhost:3100']);

    for (const corsOrigins of [
      'http://localhost:3100/admin',
      'http://user:password@localhost:3100',
      'http://localhost:3100?tenant=demo',
    ]) {
      expect(() => parseServiceConfig({ ...validEnvironment, CORS_ORIGINS: corsOrigins })).toThrow(
        'CORS_ORIGINS',
      );
    }
  });

  it('fails fast without echoing secret values', () => {
    const secret = 'do-not-echo-this-value';

    try {
      parseServiceConfig({ ...validEnvironment, DATABASE_URL: secret });
      throw new Error('expected config validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain('DATABASE_URL');
    }
  });

  it('parses browser configuration only from an explicit public environment', () => {
    expect(
      parseBrowserConfig({ NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test' }),
    ).toEqual({ apiBaseUrl: 'https://api.example.test' });
  });
});
