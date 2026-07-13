import { describe, expect, it } from 'vitest';

import { createLogger, REDACTED_VALUE, redactSensitive } from './index.js';

describe('redactSensitive', () => {
  it('deeply redacts credentials and high-sensitivity care fields', () => {
    const input = {
      correlationId: 'corr-safe',
      request: {
        authorization: 'Bearer raw-token',
        resident: {
          elderName: 'Example Person',
          observations: [
            {
              transcript: 'raw voice transcript',
              preciseLocation: { latitude: 1, longitude: 2 },
              emotionObservation: 'possible distress',
            },
          ],
        },
      },
    };

    const result = redactSensitive(input) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('corr-safe');
    expect(serialized).toContain(REDACTED_VALUE);
    expect(serialized).not.toContain('raw-token');
    expect(serialized).not.toContain('Example Person');
    expect(serialized).not.toContain('raw voice transcript');
    expect(serialized).not.toContain('possible distress');
  });

  it('handles circular structures without throwing', () => {
    const input: Record<string, unknown> = { event: 'ready' };
    input.self = input;

    expect(redactSensitive(input)).toEqual({ event: 'ready', self: '[CIRCULAR]' });
  });

  it('redacts authentication and request-fingerprint fields while retaining safe IDs', () => {
    const serialized = JSON.stringify(
      redactSensitive({
        actorId: 'user-safe-id',
        organizationId: 'org-safe-id',
        loginName: 'platform.admin',
        sessionId: 'session-secret',
        csrfToken: 'csrf-secret',
        setCookie: 'eldercare.sid=raw-cookie',
        userAgent: 'browser-fingerprint',
        ipAddress: '203.0.113.42',
        forwardedFor: '198.51.100.8',
        providerCredential: 'provider-secret',
      }),
    );

    expect(serialized).toContain('user-safe-id');
    expect(serialized).toContain('org-safe-id');
    expect(serialized).not.toContain('platform.admin');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('csrf-secret');
    expect(serialized).not.toContain('browser-fingerprint');
    expect(serialized).not.toContain('203.0.113.42');
    expect(serialized).not.toContain('198.51.100.8');
    expect(serialized).not.toContain('provider-secret');
  });
});

describe('createLogger', () => {
  it('emits stable JSON and filters messages below the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'api',
      level: 'warn',
      sink: (line) => lines.push(line),
      now: () => new Date('2026-07-11T10:00:00.000Z'),
    });

    logger.info('not emitted', { password: 'still-secret' });
    logger.warn('dependency degraded', {
      correlationId: 'corr-1',
      databaseUrl: 'postgresql://user:secret@localhost:5432/eldercare',
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('secret');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      timestamp: '2026-07-11T10:00:00.000Z',
      level: 'warn',
      service: 'api',
      message: 'dependency degraded',
      context: { correlationId: 'corr-1' },
    });
  });
});
