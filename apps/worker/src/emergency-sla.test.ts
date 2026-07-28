import type { Logger } from '@eldercare/observability';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  EmergencySlaProcessor,
  advanceEmergencyCancellationCursor,
  emergencySlaJobId,
  initialEmergencyCancellationCursor,
  type EmergencyEscalationClaim,
  type EmergencySlaJobData,
  type EmergencySlaRepository,
} from './emergency-sla.js';
import type { EmergencyNotificationProvider } from './fake-emergency-notification.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const claim: EmergencyEscalationClaim = {
  id: 'escalation-1',
  emergencyEventId: 'event-1',
  organizationId: 'org-1',
  facilityId: 'facility-1',
  elderId: 'elder-1',
  status: 'OPEN',
  stage: 'ACKNOWLEDGEMENT',
  reasonCode: 'ACK_PRIMARY',
  basisTransitionVersion: 1,
  dueAt: new Date('2026-07-28T08:00:00.000Z'),
  notificationIdempotencyKey: 'event-1:ACK_PRIMARY:fake',
  aggregateVersion: 1,
  correlationId: 'correlation-1',
};

function job(): Job<EmergencySlaJobData> {
  return {
    data: {
      schemaVersion: '1.0',
      escalationId: claim.id,
      emergencyEventId: claim.emergencyEventId,
      organizationId: claim.organizationId,
      facilityId: claim.facilityId,
      stage: claim.stage,
      reasonCode: claim.reasonCode,
      basisTransitionVersion: claim.basisTransitionVersion,
      dueAt: claim.dueAt.toISOString(),
    },
  } as Job<EmergencySlaJobData>;
}

describe('EmergencySlaProcessor', () => {
  it('uses deterministic queue identifiers', () => {
    expect(emergencySlaJobId('escalation-1')).toBe('emergency--escalation-1');
  });

  it('does not notify when the database current-state check rejects a stale job', async () => {
    const send = vi.fn();
    const completeDelivery = vi.fn();
    const repository: EmergencySlaRepository = {
      listPending: vi.fn(),
      listCancelled: vi.fn(),
      prepareDelivery: vi.fn().mockResolvedValue(null),
      completeDelivery,
      recordDeliveryFailure: vi.fn(),
    };
    const notifications: EmergencyNotificationProvider = { send };
    const processor = new EmergencySlaProcessor(repository, notifications, logger);

    await expect(processor.process(job())).resolves.toBe('stale');
    expect(send).not.toHaveBeenCalled();
    expect(completeDelivery).not.toHaveBeenCalled();
  });

  it('persists one receipt after notification delivery', async () => {
    const receipt = {
      provider: 'FAKE' as const,
      providerReference: 'fake-reference',
      deliveredAt: new Date('2026-07-28T08:00:01.000Z'),
    };
    const completeDelivery = vi.fn();
    const repository: EmergencySlaRepository = {
      listPending: vi.fn(),
      listCancelled: vi.fn(),
      prepareDelivery: vi.fn().mockResolvedValue(claim),
      completeDelivery,
      recordDeliveryFailure: vi.fn(),
    };
    const notifications: EmergencyNotificationProvider = {
      send: vi.fn().mockResolvedValue(receipt),
    };
    const processor = new EmergencySlaProcessor(repository, notifications, logger);

    await expect(processor.process(job())).resolves.toBe('delivered');
    expect(completeDelivery).toHaveBeenCalledWith(claim, receipt);
  });

  it('records a safe reason and lets BullMQ retry a notification failure', async () => {
    const recordDeliveryFailure = vi.fn();
    const repository: EmergencySlaRepository = {
      listPending: vi.fn(),
      listCancelled: vi.fn(),
      prepareDelivery: vi.fn().mockResolvedValue(claim),
      completeDelivery: vi.fn(),
      recordDeliveryFailure,
    };
    const notifications: EmergencyNotificationProvider = {
      send: vi.fn().mockRejectedValue(new Error('provider details')),
    };
    const processor = new EmergencySlaProcessor(repository, notifications, logger);

    await expect(processor.process(job())).rejects.toThrow('provider details');
    expect(recordDeliveryFailure).toHaveBeenCalledWith(
      claim,
      'FAKE_NOTIFICATION_FAILED',
    );
  });

  it('uses a bounded startup lookback and advances a stable cancellation cursor', () => {
    const now = new Date('2026-07-28T08:00:00.000Z');
    const initial = initialEmergencyCancellationCursor(now);
    expect(initial).toEqual({
      cancelledAt: new Date('2026-07-27T08:00:00.000Z'),
      id: '00000000-0000-0000-0000-000000000000',
    });
    expect(
      advanceEmergencyCancellationCursor(initial, [
        {
          id: 'escalation-a',
          cancelledAt: new Date('2026-07-28T07:59:58.000Z'),
        },
        {
          id: 'escalation-b',
          cancelledAt: new Date('2026-07-28T07:59:59.000Z'),
        },
      ]),
    ).toEqual({
      id: 'escalation-b',
      cancelledAt: new Date('2026-07-28T07:59:59.000Z'),
    });
  });
});
