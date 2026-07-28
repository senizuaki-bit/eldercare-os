import type { Logger } from '@eldercare/observability';
import { describe, expect, it, vi } from 'vitest';
import { FakeEmergencyNotificationProvider } from './fake-emergency-notification.js';

const info = vi.fn();
const logger: Logger = {
  debug: vi.fn(),
  info,
  warn: vi.fn(),
  error: vi.fn(),
};

describe('FakeEmergencyNotificationProvider', () => {
  it('returns the same deterministic receipt for an idempotent retry', async () => {
    const provider = new FakeEmergencyNotificationProvider(
      logger,
      () => new Date('2026-07-28T08:00:00.000Z'),
    );
    const request = {
      organizationId: 'org-1',
      facilityId: 'facility-1',
      emergencyEventId: 'event-1',
      escalationId: 'escalation-1',
      stage: 'ACKNOWLEDGEMENT' as const,
      reasonCode: 'ACK_PRIMARY',
      idempotencyKey: 'event-1:ACK_PRIMARY:fake',
    };

    const first = await provider.send(request);
    const replay = await provider.send(request);

    expect(replay).toEqual(first);
    expect(first.providerReference).toMatch(/^fake-[a-f0-9]{24}$/);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('deduplicates family delivery by the stored provider key', async () => {
    const provider = new FakeEmergencyNotificationProvider(
      logger,
      () => new Date('2026-07-28T08:00:00.000Z'),
    );
    const request = {
      organizationId: 'org-1',
      facilityId: 'facility-1',
      emergencyEventId: 'event-1',
      deliveryId: 'delivery-1',
      familyRelationshipId: 'relationship-1',
      stage: 'RESOLVED' as const,
      channel: 'IN_APP' as const,
      idempotencyKey: 'm04-family-v1:fixture',
    };

    const first = await provider.sendFamily(request);
    const replay = await provider.sendFamily(request);

    expect(replay).toEqual(first);
  });
});
