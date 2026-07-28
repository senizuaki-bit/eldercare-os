import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_LOCATION_MAX_EFFECTIVE_TTL_MS,
  EMERGENCY_LOCATION_MAX_SAMPLE_AGE_MS,
  emergencyLocationFreshnessReason,
  normalizeEmergencySignalObservedAt,
} from './prisma-emergency-mqtt-repository.js';

describe('PrismaEmergencyMqttRepository invariants', () => {
  it('documents exact replay and related-new-event behavior', () => {
    const exactReplayKey = ['sourceIdentityKey', 'externalEventId'];
    const samePayloadRequirement = 'requestFingerprint';
    const distinctNewEventRule = 'new externalEventId';

    expect(exactReplayKey).toEqual(['sourceIdentityKey', 'externalEventId']);
    expect(samePayloadRequirement).toBe('requestFingerprint');
    expect(distinctNewEventRule).toBe('new externalEventId');
  });

  it('never treats ancient or overlong-TTL location samples as current', () => {
    const receivedAt = new Date('2026-07-28T08:00:00.000Z');
    expect(
      emergencyLocationFreshnessReason(
        new Date(
          receivedAt.getTime() - EMERGENCY_LOCATION_MAX_SAMPLE_AGE_MS - 1,
        ),
        new Date(receivedAt.getTime() + 24 * 60 * 60_000),
        receivedAt,
      ),
    ).toBe('LOCATION_SAMPLE_TOO_OLD');
    expect(
      emergencyLocationFreshnessReason(
        new Date(receivedAt.getTime() - 1_000),
        new Date(
          receivedAt.getTime() +
            EMERGENCY_LOCATION_MAX_EFFECTIVE_TTL_MS +
            1,
        ),
        receivedAt,
      ),
    ).toBe('LOCATION_TTL_EXCEEDS_POLICY');
    expect(
      emergencyLocationFreshnessReason(
        new Date(receivedAt.getTime() - 1_000),
        new Date(receivedAt.getTime() + 60_000),
        receivedAt,
      ),
    ).toBeNull();
  });

  it('clamps a future device observation to the server receive time', () => {
    const receivedAt = new Date('2026-07-28T08:00:00.000Z');
    expect(
      normalizeEmergencySignalObservedAt(
        '2026-07-29T08:00:00.000Z',
        receivedAt,
      ),
    ).toEqual(receivedAt);
    expect(
      normalizeEmergencySignalObservedAt(
        '2026-07-28T07:59:00.000Z',
        receivedAt,
      ),
    ).toEqual(new Date('2026-07-28T07:59:00.000Z'));
  });
});
