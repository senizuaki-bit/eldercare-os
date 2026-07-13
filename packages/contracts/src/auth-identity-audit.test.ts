import { describe, expect, it } from 'vitest';

import {
  auditEventSchema,
  accessScopeInputSchema,
  loginRequestSchema,
  rolesQuerySchema,
  sessionContextSchema,
  userSummarySchema,
  usersQuerySchema,
} from './index.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';

describe('M01 authentication and identity contracts', () => {
  it('accepts a bounded login request and rejects unknown credential fields', () => {
    expect(
      loginRequestSchema.parse({
        loginName: 'facility.director',
        password: 'LocalDemoOnly!2026',
      }),
    ).toMatchObject({ loginName: 'facility.director' });

    expect(() =>
      loginRequestSchema.parse({
        loginName: 'facility.director',
        password: 'LocalDemoOnly!2026',
        sessionToken: 'client-supplied-token',
      }),
    ).toThrow();
  });

  it('keeps password and session credential material out of session responses', () => {
    const safeSession = {
      user: {
        id: userId,
        username: 'facility.director',
        displayName: '院区负责人（演示）',
      },
      activeContext: {
        organizationId,
        organizationName: '青岚颐养中心（虚构）',
        facilityId: null,
        facilityName: null,
      },
      availableContexts: [
        {
          organizationId,
          organizationName: '青岚颐养中心（虚构）',
          facilityId: null,
          facilityName: null,
        },
      ],
      roles: [{ key: 'FACILITY_DIRECTOR', label: '院区负责人' }],
      permissions: ['identity.user.read'],
      portal: 'admin',
      expiresAt: '2026-07-12T08:00:00.000Z',
    };

    expect(sessionContextSchema.parse(safeSession)).toEqual(safeSession);
    expect(() => sessionContextSchema.parse({ ...safeSession, tokenHash: 'secret' })).toThrow();
    expect(() => sessionContextSchema.parse({ ...safeSession, sessionToken: 'secret' })).toThrow();
    expect(() =>
      sessionContextSchema.parse({
        ...safeSession,
        user: { ...safeSession.user, passwordHash: 'secret' },
      }),
    ).toThrow();
    expect(() =>
      sessionContextSchema.parse({
        ...safeSession,
        roles: [{ key: '../FACILITY_DIRECTOR', label: 'unsafe' }],
      }),
    ).toThrow();
    expect(() =>
      sessionContextSchema.parse({
        ...safeSession,
        permissions: ['identity.user.read<script>'],
      }),
    ).toThrow();
  });

  it('applies safe pagination defaults and forbids arbitrary query fields', () => {
    expect(usersQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: 'displayName',
      direction: 'asc',
    });
    expect(() => usersQuerySchema.parse({ organizationId, includePassword: true })).toThrow();

    expect(rolesQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'name',
      direction: 'asc',
    });
    expect(() => rolesQuerySchema.parse({ includePermissions: true })).toThrow();
  });

  it('rejects credential material embedded in a user summary', () => {
    const summary = {
      id: userId,
      loginName: 'caregiver.demo',
      displayName: '护工（演示）',
      status: 'ACTIVE',
      lastLoginAt: null,
      accessVersion: 1,
      assignments: [],
    };

    expect(userSummarySchema.parse(summary)).toEqual(summary);
    expect(() => userSummarySchema.parse({ ...summary, passwordHash: 'secret' })).toThrow();
  });

  it('enforces scope shapes and validity windows', () => {
    const facilityId = '33333333-3333-4333-8333-333333333333';

    expect(
      accessScopeInputSchema.parse({
        kind: 'FACILITY',
        scopeKey: `facility:${facilityId}`,
        facilityId,
      }),
    ).toMatchObject({ kind: 'FACILITY', facilityId });
    expect(() =>
      accessScopeInputSchema.parse({ kind: 'FACILITY', scopeKey: 'missing-facility' }),
    ).toThrow();
    expect(() =>
      accessScopeInputSchema.parse({
        kind: 'FACILITY',
        scopeKey: '<script>',
        facilityId,
      }),
    ).toThrow();
    expect(() =>
      accessScopeInputSchema.parse({
        kind: 'OWN_RECORD',
        scopeKey: 'own-record',
        facilityId,
      }),
    ).toThrow();
    expect(() =>
      accessScopeInputSchema.parse({
        kind: 'ACTIVE_SHIFT',
        scopeKey: 'active-shift',
        facilityId,
      }),
    ).toThrow();
    expect(
      accessScopeInputSchema.parse({
        kind: 'ACTIVE_SHIFT',
        scopeKey: 'active-shift',
        facilityId,
        validFrom: '2026-07-12T08:00:00.000Z',
        validUntil: '2026-07-12T20:00:00.000Z',
      }),
    ).toMatchObject({ kind: 'ACTIVE_SHIFT', facilityId });
    expect(() =>
      accessScopeInputSchema.parse({
        kind: 'ACTIVE_SHIFT',
        scopeKey: 'active-shift',
        facilityId,
        validFrom: '2026-07-12T10:00:00.000Z',
        validUntil: '2026-07-12T09:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('M01 audit contract', () => {
  it('accepts only the explicit audit response fields', () => {
    const event = {
      id: '33333333-3333-4333-8333-333333333333',
      organizationId,
      facilityId: null,
      actorUserId: userId,
      actorType: 'USER',
      action: 'IDENTITY.USER_LIST_READ',
      outcome: 'SUCCESS',
      resourceType: 'user-list',
      resourceId: null,
      reasonCode: null,
      correlationId: 'corr-m01-0001',
      safeMetadata: { resultCount: 7 },
      occurredAt: '2026-07-12T00:00:00.000Z',
    };

    expect(auditEventSchema.parse(event)).toEqual(event);
    expect(() => auditEventSchema.parse({ ...event, cookie: 'raw-cookie' })).toThrow();
  });
});
