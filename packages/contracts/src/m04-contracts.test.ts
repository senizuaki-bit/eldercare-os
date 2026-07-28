import { describe, expect, it } from 'vitest';

import {
  EMERGENCY_RESOLUTION_CHECKLIST_CODES,
  emergenciesQuerySchema,
  emergencyLocationProjectionSchema,
  emergencyResolveRequestSchema,
  emergencyReviewRequestSchema,
  familyEmergenciesQuerySchema,
  familyEmergencyNotificationPreferenceSchema,
  familyEmergencyPreferenceUpdateRequestSchema,
  familyEmergencySummarySchema,
  mqttEmergencySignalPayloadSchema,
} from './emergency.js';

const idempotencyKey = 'm04-command-0001';

describe('M04 emergency contracts', () => {
  it('keeps location filtering inside the paginated server query', () => {
    expect(
      emergenciesQuerySchema.parse({
        page: '2',
        pageSize: '10',
        locationState: 'STALE',
      }),
    ).toMatchObject({
      page: 2,
      pageSize: 10,
      locationState: 'STALE',
    });
    expect(
      emergenciesQuerySchema.safeParse({ locationState: 'EXPIRED' }).success,
    ).toBe(false);
  });

  it('keeps the family summary list contract pagination-only', () => {
    expect(
      familyEmergenciesQuerySchema.parse({ page: '2', pageSize: '10' }),
    ).toEqual({ page: 2, pageSize: 10 });
    expect(
      familyEmergenciesQuerySchema.safeParse({
        page: '1',
        status: 'OPEN',
      }).success,
    ).toBe(false);
  });

  it('uses version zero for a family preference that has not been persisted yet', () => {
    expect(
      familyEmergencyNotificationPreferenceSchema.parse({
        id: null,
        elderId: '10000000-0000-4000-8000-000000000003',
        enabled: false,
        notifyOnOpened: false,
        notifyOnResolved: true,
        channel: 'IN_APP',
        version: 0,
        updatedAt: null,
      }).version,
    ).toBe(0);
    expect(
      familyEmergencyPreferenceUpdateRequestSchema.parse({
        expectedVersion: 0,
        idempotencyKey,
        enabled: true,
        notifyOnOpened: false,
        notifyOnResolved: true,
        channel: 'IN_APP',
      }).expectedVersion,
    ).toBe(0);
  });

  it('accepts the canonical strict IoT signal and rejects a scope-free payload', () => {
    const payload = {
      schemaVersion: '1.0',
      eventId: 'iot-event-0001',
      organizationSlug: 'qinglan-demo',
      facilityCode: 'QL-MAIN',
      sourceId: 'call-device-qinglan-001',
      timestamp: '2026-07-28T04:00:00.000Z',
      reasonCode: 'IOT_EMERGENCY_BUTTON',
    } as const;

    expect(mqttEmergencySignalPayloadSchema.parse(payload)).toEqual(payload);
    const { organizationSlug, ...scopeFree } = payload;
    expect(organizationSlug).toBe('qinglan-demo');
    expect(mqttEmergencySignalPayloadSchema.safeParse(scopeFree).success).toBe(false);
  });

  it('requires the complete server-owned resolution checklist in order', () => {
    const base = {
      expectedVersion: 4,
      idempotencyKey,
      outcomeCode: 'SAFE_WITH_FOLLOW_UP',
      summary: '现场已由值班照护人员完成安全处置，并安排后续观察。',
      familyNotify: true,
    };
    const completionChecklist = EMERGENCY_RESOLUTION_CHECKLIST_CODES.map((code) => ({
      code,
      confirmed: true as const,
    }));

    expect(
      emergencyResolveRequestSchema.parse({ ...base, completionChecklist }),
    ).toMatchObject({ completionChecklist });
    expect(
      emergencyResolveRequestSchema.safeParse({
        ...base,
        completionChecklist: completionChecklist.slice(0, 2),
      }).success,
    ).toBe(false);
    expect(
      emergencyResolveRequestSchema.safeParse({
        ...base,
        completionChecklist: completionChecklist.toReversed(),
      }).success,
    ).toBe(false);
  });

  it('keeps completed and waived review evidence mutually exclusive', () => {
    expect(
      emergencyReviewRequestSchema.safeParse({
        expectedVersion: 5,
        idempotencyKey,
        kind: 'COMPLETED',
        summary: '复盘确认响应与交接记录完整。',
      }).success,
    ).toBe(true);
    expect(
      emergencyReviewRequestSchema.safeParse({
        expectedVersion: 5,
        idempotencyKey,
        kind: 'WAIVED',
        waiverReasonCode: 'MERGED_INTO_PRIMARY_REVIEW',
      }).success,
    ).toBe(true);
    expect(
      emergencyReviewRequestSchema.safeParse({
        expectedVersion: 5,
        idempotencyKey,
        kind: 'WAIVED',
        summary: 'A hidden waiver narrative',
      }).success,
    ).toBe(false);
  });

  it('never labels non-current location as precise', () => {
    expect(
      emergencyLocationProjectionSchema.safeParse({
        state: 'STALE',
        source: 'WEARABLE',
        label: '1号楼 2层（最后已知）',
        observedAt: '2026-07-28T04:00:00.000Z',
        expiresAt: '2026-07-28T04:01:00.000Z',
        accuracyMeters: 2,
        fallbackReasonCode: 'LOCATION_EXPIRED',
      }).success,
    ).toBe(false);
  });

  it('rejects staff and precise-location fields from family-safe summaries', () => {
    const safe = {
      id: '10000000-0000-4000-8000-000000000001',
      emergencyEventId: '10000000-0000-4000-8000-000000000002',
      elderId: '10000000-0000-4000-8000-000000000003',
      elderDisplayName: '林阿姨',
      stage: 'RESPONDING',
      title: '照护人员正在响应',
      summary: '机构已安排照护人员前往查看，后续进展将继续同步。',
      publishedAt: '2026-07-28T04:02:00.000Z',
    } as const;

    expect(familyEmergencySummarySchema.parse(safe)).toEqual(safe);
    expect(
      familyEmergencySummarySchema.safeParse({
        ...safe,
        caregiverUserId: '10000000-0000-4000-8000-000000000004',
        normalizedX: 0.42,
      }).success,
    ).toBe(false);
  });
});
