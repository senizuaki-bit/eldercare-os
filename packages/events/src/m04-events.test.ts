import { describe, expect, it } from 'vitest';

import {
  M04_EVENT_TYPES,
  buildM04EmergencyEventData,
  isM04EventType,
} from './index.js';

describe('M04 event contracts', () => {
  it('publishes the complete documented event vocabulary', () => {
    expect(M04_EVENT_TYPES).toEqual([
      'EMERGENCY.OPENED',
      'EMERGENCY.ACKNOWLEDGED',
      'EMERGENCY.RESPONDING',
      'EMERGENCY.ESCALATED',
      'EMERGENCY.RESOLVED',
      'EMERGENCY.REVIEWED',
      'EMERGENCY.RELATED_DUPLICATE',
    ]);
    expect(M04_EVENT_TYPES.every(isM04EventType)).toBe(true);
    expect(isM04EventType('EMERGENCY.CLOSED')).toBe(false);
  });

  it('drops sensitive and implementation-specific fields from outbox data', () => {
    const data = buildM04EmergencyEventData({
      emergencyId: 'emergency-a',
      elderId: 'elder-a',
      status: 'RESPONDING',
      version: 3,
      reasonCode: 'CAREGIVER_EN_ROUTE',
      slaStage: 'ARRIVAL',
      requestFingerprint: 'sha256-only',
      preciseCoordinates: { x: 0.4, y: 0.5 },
      caregiverUserId: 'user-a',
      internalSummary: 'private operational note',
    } as Parameters<typeof buildM04EmergencyEventData>[0] & Record<string, unknown>);

    expect(data).toEqual({
      emergencyId: 'emergency-a',
      elderId: 'elder-a',
      status: 'RESPONDING',
      version: 3,
      reasonCode: 'CAREGIVER_EN_ROUTE',
      slaStage: 'ARRIVAL',
      requestFingerprint: 'sha256-only',
    });
    expect(Object.isFrozen(data)).toBe(true);
  });
});
