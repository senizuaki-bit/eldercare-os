import { describe, expect, it } from 'vitest';
import {
  buildEmergencyFixture,
  parseEmergencyCliOptions,
} from './emergency-fixture.js';

const base = {
  organizationSlug: 'qinglan-demo',
  facilityCode: 'QL-MAIN',
  sourceId: 'call-device-qinglan-001',
  eventId: 'b2000000-0000-4000-8000-000000000001',
  topicPrefix: 'test-m04',
  now: new Date('2026-07-28T08:00:00.000Z'),
} as const;

describe('emergency IoT fixture', () => {
  it.each(['current', 'stale', 'missing'] as const)(
    'builds a deterministic %s-location event',
    (location) => {
      const first = buildEmergencyFixture({ ...base, location });
      const second = buildEmergencyFixture({ ...base, location });

      expect(first).toEqual(second);
      expect(first.topic).toBe(
        'test-m04/v1/orgs/qinglan-demo/facilities/QL-MAIN/emergency/call-device-qinglan-001',
      );
      expect(first.message.eventId).toBe(base.eventId);
      expect(first.message).toMatchObject({
        sourceId: base.sourceId,
        organizationSlug: base.organizationSlug,
        facilityCode: base.facilityCode,
        reasonCode: 'IOT_EMERGENCY_BUTTON',
      });
      if (location === 'missing') {
        expect(first.message).not.toHaveProperty('location');
      } else {
        const fixtureLocation = first.message.location;
        expect(fixtureLocation).toBeDefined();
        if (fixtureLocation === undefined) throw new Error('Expected location fixture');
        expect(
          Date.parse(fixtureLocation.expiresAt) >
            Date.parse(fixtureLocation.observedAt),
        ).toBe(true);
        expect(
          Date.parse(fixtureLocation.expiresAt) > base.now.getTime(),
        ).toBe(location === 'current');
      }
    },
  );

  it('parses explicit replay identifiers and rejects unknown location modes', () => {
    expect(
      parseEmergencyCliOptions([
        '--emergency',
        '--event-id',
        base.eventId,
        '--location',
        'stale',
      ]),
    ).toMatchObject({ eventId: base.eventId, location: 'stale' });
    expect(() =>
      parseEmergencyCliOptions(['--emergency', '--location', 'live']),
    ).toThrow('current, stale, or missing');
  });
});
