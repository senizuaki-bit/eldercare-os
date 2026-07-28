import type { PrismaClient } from '@eldercare/db';
import type { Logger } from '@eldercare/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  FamilyEmergencyNotificationDispatcher,
  PrismaFamilyEmergencyDeliveryRepository,
  familyDeliverySuppressionReason,
  familyDeliveryBackoffMs,
  type ClaimedFamilyEmergencyDelivery,
  type FamilyDeliveryEligibilityCandidate,
  type FamilyEmergencyDeliveryRepository,
} from './family-emergency-notifications.js';
import type { FamilyEmergencyNotificationProvider } from './fake-emergency-notification.js';
import type { FamilyEmergencyNotificationRequest } from './fake-emergency-notification.js';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const delivery: ClaimedFamilyEmergencyDelivery = {
  id: 'delivery-1',
  organizationId: 'org-1',
  facilityId: 'facility-1',
  emergencyEventId: 'event-1',
  familyRelationshipId: 'relationship-1',
  stage: 'RESOLVED',
  channel: 'IN_APP',
  providerKey: 'm04-family-v1:fixture',
  attempts: 1,
};

describe('FamilyEmergencyNotificationDispatcher', () => {
  it('marks a claimed privacy-minimal delivery as delivered', async () => {
    const markDelivered = vi.fn();
    const sent: FamilyEmergencyNotificationRequest[] = [];
    const sendFamily = vi.fn((request: FamilyEmergencyNotificationRequest) => {
      sent.push(request);
      return Promise.resolve({
        provider: 'FAKE' as const,
        providerReference: 'fake-reference',
        deliveredAt: new Date('2026-07-28T08:00:00.000Z'),
      });
    });
    const repository: FamilyEmergencyDeliveryRepository = {
      claimDue: vi.fn().mockResolvedValue([delivery]),
      markDelivered,
      markFailed: vi.fn(),
    };
    const provider: FamilyEmergencyNotificationProvider = {
      sendFamily,
    };
    const dispatcher = new FamilyEmergencyNotificationDispatcher(
      repository,
      provider,
      logger,
      () => new Date('2026-07-28T08:00:00.000Z'),
    );

    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(Object.keys(sent[0] ?? {})).not.toContain('summary');
    expect(Object.keys(sent[0] ?? {})).not.toContain('location');
    expect(markDelivered).toHaveBeenCalledOnce();
  });

  it('records failure without throwing away the business delivery', async () => {
    const markFailed = vi.fn();
    const repository: FamilyEmergencyDeliveryRepository = {
      claimDue: vi.fn().mockResolvedValue([delivery]),
      markDelivered: vi.fn(),
      markFailed,
    };
    const provider: FamilyEmergencyNotificationProvider = {
      sendFamily: vi.fn().mockRejectedValue(new Error('fixture failure')),
    };
    const dispatcher = new FamilyEmergencyNotificationDispatcher(
      repository,
      provider,
      logger,
      () => new Date('2026-07-28T08:00:00.000Z'),
    );

    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      failed: 1,
    });
    expect(markFailed).toHaveBeenCalledWith(
      delivery,
      'FAKE_NOTIFICATION_FAILED',
      new Date('2026-07-28T08:00:01.000Z'),
    );
  });

  it('bounds retry backoff', () => {
    expect(familyDeliveryBackoffMs(1)).toBe(1_000);
    expect(familyDeliveryBackoffMs(99)).toBe(300_000);
  });
});

const eligibilityCandidate: FamilyDeliveryEligibilityCandidate = {
  organizationId: 'org-1',
  facilityId: 'facility-1',
  organization: {
    status: 'ACTIVE',
  },
  facility: {
    status: 'ACTIVE',
  },
  stage: 'RESOLVED',
  channel: 'IN_APP',
  emergencyEvent: {
    elderId: 'elder-1',
  },
  familyRelationship: {
    elderId: 'elder-1',
    status: 'VERIFIED',
    activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    activeUntil: null,
    revokedAt: null,
    familyUser: {
      status: 'ACTIVE',
      userRoles: [
        {
          organizationId: 'org-1',
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: null,
          revokedAt: null,
          role: {
            code: 'FAMILY',
            rolePermissions: [
              {
                permission: {
                  code: 'emergency.family_summary.read',
                },
              },
            ],
          },
          dataScopes: [
            {
              organizationId: 'org-1',
              kind: 'LINKED_ELDER',
              facilityId: 'facility-1',
              resourceType: 'ELDER',
              resourceId: 'elder-1',
              validFrom: new Date('2026-01-01T00:00:00.000Z'),
              validUntil: null,
            },
          ],
        },
      ],
    },
    emergencyNotificationPreference: {
      enabled: true,
      notifyOnOpened: false,
      notifyOnResolved: true,
      channel: 'IN_APP',
    },
    sharingPreferences: [{ id: 'active-family-sharing-consent' }],
  },
};

describe('family delivery claim-time authorization', () => {
  const now = new Date('2026-07-28T08:00:00.000Z');

  it('allows an active relationship, sharing consent, stage, and channel', () => {
    expect(familyDeliverySuppressionReason(eligibilityCandidate, now)).toBeNull();
  });

  it('fails closed when the organization or facility is no longer active', () => {
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          organization: { status: 'SUSPENDED' },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_ORGANIZATION_INACTIVE');
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          facility: { status: 'ARCHIVED' },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_FACILITY_INACTIVE');
  });

  it('suppresses after family-sharing consent is withdrawn', () => {
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            sharingPreferences: [],
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_SHARING_NOT_AUTHORIZED');
  });

  it('suppresses after the current notification preference is disabled', () => {
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            emergencyNotificationPreference: {
              enabled: false,
              notifyOnOpened: true,
              notifyOnResolved: true,
              channel: 'IN_APP',
            },
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_PREFERENCE_DISABLED');
  });

  it('suppresses after the family link becomes inactive', () => {
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            revokedAt: new Date('2026-07-28T07:59:59.000Z'),
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_LINK_INACTIVE');
  });

  it('suppresses after the FAMILY user role is revoked', () => {
    const activeRole =
      eligibilityCandidate.familyRelationship.familyUser.userRoles[0];
    expect(activeRole).toBeDefined();
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            familyUser: {
              ...eligibilityCandidate.familyRelationship.familyUser,
              userRoles: [
                {
                  ...activeRole!,
                  revokedAt: new Date('2026-07-28T07:59:59.000Z'),
                },
              ],
            },
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_AUTHORIZATION_INACTIVE');
  });

  it('suppresses after family-summary permission is removed', () => {
    const activeRole =
      eligibilityCandidate.familyRelationship.familyUser.userRoles[0];
    expect(activeRole).toBeDefined();
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            familyUser: {
              ...eligibilityCandidate.familyRelationship.familyUser,
              userRoles: [
                {
                  ...activeRole!,
                  role: {
                    ...activeRole!.role,
                    rolePermissions: [],
                  },
                },
              ],
            },
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_AUTHORIZATION_INACTIVE');
  });

  it('suppresses after the LINKED_ELDER scope expires', () => {
    const activeRole =
      eligibilityCandidate.familyRelationship.familyUser.userRoles[0];
    const linkedScope = activeRole?.dataScopes[0];
    expect(activeRole).toBeDefined();
    expect(linkedScope).toBeDefined();
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          familyRelationship: {
            ...eligibilityCandidate.familyRelationship,
            familyUser: {
              ...eligibilityCandidate.familyRelationship.familyUser,
              userRoles: [
                {
                  ...activeRole!,
                  dataScopes: [
                    {
                      ...linkedScope!,
                      validUntil: now,
                    },
                  ],
                },
              ],
            },
          },
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_AUTHORIZATION_INACTIVE');
  });

  it('suppresses a changed channel or disabled stage', () => {
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          channel: 'SMS',
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_CHANNEL_CHANGED');
    expect(
      familyDeliverySuppressionReason(
        {
          ...eligibilityCandidate,
          stage: 'OPENED',
        },
        now,
      ),
    ).toBe('FAMILY_DELIVERY_STAGE_DISABLED');
  });

  it('atomically marks an ineligible candidate suppressed instead of claiming it', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      emergencyNotificationDelivery: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...eligibilityCandidate,
            id: 'delivery-privacy-recheck',
            organizationId: 'org-1',
            facilityId: 'facility-1',
            emergencyEventId: 'event-1',
            familyRelationshipId: 'relationship-1',
            status: 'PENDING',
            providerKey: 'm04-family-v1:privacy-recheck',
            attempts: 0,
            nextAttemptAt: now,
            familyRelationship: {
              ...eligibilityCandidate.familyRelationship,
              sharingPreferences: [],
            },
          },
        ]),
        updateMany,
      },
    };
    const runTransaction = vi.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const database = {
      $transaction: runTransaction,
    } as unknown as PrismaClient;
    const repository = new PrismaFamilyEmergencyDeliveryRepository(database);

    await expect(
      repository.claimDue(now, new Date(now.getTime() + 30_000), 10),
    ).resolves.toEqual([]);
    expect(runTransaction).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'delivery-privacy-recheck',
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
      },
      data: {
        status: 'SUPPRESSED',
        suppressedAt: now,
        nextAttemptAt: null,
        lastErrorCode: 'FAMILY_DELIVERY_SHARING_NOT_AUTHORIZED',
      },
    });
  });
});
