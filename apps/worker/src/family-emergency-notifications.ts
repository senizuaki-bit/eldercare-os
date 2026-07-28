import { Prisma, type PrismaClient } from '@eldercare/db';
import type { Logger } from '@eldercare/observability';
import type {
  EmergencyNotificationReceipt,
  FamilyEmergencyNotificationProvider,
} from './fake-emergency-notification.js';

export interface ClaimedFamilyEmergencyDelivery {
  readonly id: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly emergencyEventId: string;
  readonly familyRelationshipId: string;
  readonly stage: 'OPENED' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED';
  readonly channel: 'IN_APP' | 'SMS' | 'PHONE' | 'EMAIL';
  readonly providerKey: string;
  readonly attempts: number;
}

export interface FamilyEmergencyDeliveryRepository {
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<readonly ClaimedFamilyEmergencyDelivery[]>;
  markDelivered(
    delivery: ClaimedFamilyEmergencyDelivery,
    receipt: EmergencyNotificationReceipt,
  ): Promise<void>;
  markFailed(
    delivery: ClaimedFamilyEmergencyDelivery,
    reasonCode: string,
    retryAt: Date,
  ): Promise<void>;
}

export class PrismaFamilyEmergencyDeliveryRepository
  implements FamilyEmergencyDeliveryRepository
{
  constructor(
    private readonly database: PrismaClient | Prisma.TransactionClient,
  ) {}

  async claimDue(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<readonly ClaimedFamilyEmergencyDelivery[]> {
    return this.inSerializable(async (transaction) => {
      const candidates = await transaction.emergencyNotificationDelivery.findMany({
        where: {
          status: { in: ['PENDING', 'FAILED'] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        select: {
          id: true,
          organizationId: true,
          facilityId: true,
          emergencyEventId: true,
          familyRelationshipId: true,
          stage: true,
          channel: true,
          status: true,
          providerKey: true,
          attempts: true,
          nextAttemptAt: true,
          organization: {
            select: { status: true },
          },
          facility: {
            select: { status: true },
          },
          emergencyEvent: {
            select: { elderId: true },
          },
          familyRelationship: {
            select: {
              elderId: true,
              status: true,
              activeFrom: true,
              activeUntil: true,
              revokedAt: true,
              familyUser: {
                select: {
                  status: true,
                  userRoles: {
                    select: {
                      organizationId: true,
                      activeFrom: true,
                      expiresAt: true,
                      revokedAt: true,
                      role: {
                        select: {
                          code: true,
                          rolePermissions: {
                            select: {
                              permission: {
                                select: { code: true },
                              },
                            },
                          },
                        },
                      },
                      dataScopes: {
                        select: {
                          organizationId: true,
                          kind: true,
                          facilityId: true,
                          resourceType: true,
                          resourceId: true,
                          validFrom: true,
                          validUntil: true,
                        },
                      },
                    },
                  },
                },
              },
              emergencyNotificationPreference: {
                select: {
                  enabled: true,
                  notifyOnOpened: true,
                  notifyOnResolved: true,
                  channel: true,
                },
              },
              sharingPreferences: {
                where: {
                  field: 'TIMELINE_SUMMARY',
                  allowed: true,
                  validFrom: { lte: now },
                  AND: [
                    { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
                    {
                      consentRecord: {
                        is: {
                          purpose: 'FAMILY_SHARING',
                          decision: 'GRANTED',
                          supersededAt: null,
                          effectiveAt: { lte: now },
                          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                        },
                      },
                    },
                  ],
                },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: Math.min(Math.max(limit, 1), 100),
      });
      const claimed: ClaimedFamilyEmergencyDelivery[] = [];

      for (const candidate of candidates) {
        const suppressionReason = familyDeliverySuppressionReason(candidate, now);
        if (suppressionReason !== null) {
          await transaction.emergencyNotificationDelivery.updateMany({
            where: {
              id: candidate.id,
              status: candidate.status,
              attempts: candidate.attempts,
              nextAttemptAt: candidate.nextAttemptAt,
            },
            data: {
              status: 'SUPPRESSED',
              suppressedAt: now,
              nextAttemptAt: null,
              lastErrorCode: suppressionReason,
            },
          });
          continue;
        }

        const changed = await transaction.emergencyNotificationDelivery.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            attempts: candidate.attempts,
            nextAttemptAt: candidate.nextAttemptAt,
          },
          data: {
            status: 'PENDING',
            attempts: { increment: 1 },
            nextAttemptAt: leaseUntil,
            lastErrorCode: null,
          },
        });
        if (changed.count === 0) continue;
        claimed.push({
          id: candidate.id,
          organizationId: candidate.organizationId,
          facilityId: candidate.facilityId,
          emergencyEventId: candidate.emergencyEventId,
          familyRelationshipId: candidate.familyRelationshipId,
          stage: candidate.stage,
          channel: candidate.channel,
          providerKey: candidate.providerKey,
          attempts: candidate.attempts + 1,
        });
      }

      return claimed;
    });
  }

  async markDelivered(
    delivery: ClaimedFamilyEmergencyDelivery,
    receipt: EmergencyNotificationReceipt,
  ): Promise<void> {
    await this.database.emergencyNotificationDelivery.updateMany({
      where: {
        id: delivery.id,
        organizationId: delivery.organizationId,
        facilityId: delivery.facilityId,
        status: 'PENDING',
        attempts: delivery.attempts,
      },
      data: {
        status: 'DELIVERED',
        deliveredAt: receipt.deliveredAt,
        nextAttemptAt: null,
        lastErrorCode: null,
      },
    });
  }

  async markFailed(
    delivery: ClaimedFamilyEmergencyDelivery,
    reasonCode: string,
    retryAt: Date,
  ): Promise<void> {
    await this.database.emergencyNotificationDelivery.updateMany({
      where: {
        id: delivery.id,
        organizationId: delivery.organizationId,
        facilityId: delivery.facilityId,
        status: 'PENDING',
        attempts: delivery.attempts,
      },
      data: {
        status: 'FAILED',
        nextAttemptAt: retryAt,
        lastErrorCode: reasonCode,
      },
    });
  }

  private async inSerializable<T>(
    callback: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (isPrismaClient(this.database)) {
      return this.database.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return callback(this.database);
  }
}

function isPrismaClient(
  database: PrismaClient | Prisma.TransactionClient,
): database is PrismaClient {
  return '$transaction' in database;
}

export interface FamilyDeliveryEligibilityCandidate {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly organization: {
    readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  };
  readonly facility: {
    readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  };
  readonly stage: 'OPENED' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED';
  readonly channel: 'IN_APP' | 'SMS' | 'PHONE' | 'EMAIL';
  readonly emergencyEvent: {
    readonly elderId: string;
  };
  readonly familyRelationship: {
    readonly elderId: string;
    readonly status: 'PENDING' | 'VERIFIED' | 'REVOKED';
    readonly activeFrom: Date;
    readonly activeUntil: Date | null;
    readonly revokedAt: Date | null;
    readonly familyUser: {
      readonly status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
      readonly userRoles: readonly {
        readonly organizationId: string;
        readonly activeFrom: Date;
        readonly expiresAt: Date | null;
        readonly revokedAt: Date | null;
        readonly role: {
          readonly code: string;
          readonly rolePermissions: readonly {
            readonly permission: {
              readonly code: string;
            };
          }[];
        };
        readonly dataScopes: readonly {
          readonly organizationId: string;
          readonly kind: string;
          readonly facilityId: string | null;
          readonly resourceType: string | null;
          readonly resourceId: string | null;
          readonly validFrom: Date;
          readonly validUntil: Date | null;
        }[];
      }[];
    };
    readonly emergencyNotificationPreference: {
      readonly enabled: boolean;
      readonly notifyOnOpened: boolean;
      readonly notifyOnResolved: boolean;
      readonly channel: 'IN_APP' | 'SMS' | 'PHONE' | 'EMAIL';
    } | null;
    readonly sharingPreferences: readonly {
      readonly id: string;
    }[];
  };
}

export function familyDeliverySuppressionReason(
  candidate: FamilyDeliveryEligibilityCandidate,
  now: Date,
): string | null {
  if (candidate.organization.status !== 'ACTIVE') {
    return 'FAMILY_DELIVERY_ORGANIZATION_INACTIVE';
  }
  if (candidate.facility.status !== 'ACTIVE') {
    return 'FAMILY_DELIVERY_FACILITY_INACTIVE';
  }

  const relationship = candidate.familyRelationship;
  if (
    relationship.elderId !== candidate.emergencyEvent.elderId ||
    relationship.familyUser.status !== 'ACTIVE' ||
    relationship.status !== 'VERIFIED' ||
    relationship.activeFrom.getTime() > now.getTime() ||
    relationship.revokedAt !== null ||
    (relationship.activeUntil !== null &&
      relationship.activeUntil.getTime() <= now.getTime())
  ) {
    return 'FAMILY_DELIVERY_LINK_INACTIVE';
  }
  if (relationship.sharingPreferences.length === 0) {
    return 'FAMILY_DELIVERY_SHARING_NOT_AUTHORIZED';
  }
  if (!hasActiveFamilySummaryAuthorization(candidate, now)) {
    return 'FAMILY_DELIVERY_AUTHORIZATION_INACTIVE';
  }

  const preference = relationship.emergencyNotificationPreference ?? {
    enabled: true,
    notifyOnOpened: false,
    notifyOnResolved: true,
    channel: 'IN_APP' as const,
  };
  if (!preference.enabled) return 'FAMILY_DELIVERY_PREFERENCE_DISABLED';
  if (preference.channel !== candidate.channel) {
    return 'FAMILY_DELIVERY_CHANNEL_CHANGED';
  }
  const stageEnabled =
    candidate.stage === 'OPENED'
      ? preference.notifyOnOpened
      : candidate.stage === 'RESOLVED'
        ? preference.notifyOnResolved
        : false;
  return stageEnabled ? null : 'FAMILY_DELIVERY_STAGE_DISABLED';
}

const FAMILY_SUMMARY_READ_PERMISSION = 'emergency.family_summary.read';

export function hasActiveFamilySummaryAuthorization(
  candidate: FamilyDeliveryEligibilityCandidate,
  now: Date,
): boolean {
  return candidate.familyRelationship.familyUser.userRoles.some(
    (userRole) =>
      userRole.organizationId === candidate.organizationId &&
      userRole.activeFrom.getTime() <= now.getTime() &&
      userRole.revokedAt === null &&
      (userRole.expiresAt === null ||
        userRole.expiresAt.getTime() > now.getTime()) &&
      userRole.role.code === 'FAMILY' &&
      userRole.role.rolePermissions.some(
        ({ permission }) => permission.code === FAMILY_SUMMARY_READ_PERMISSION,
      ) &&
      userRole.dataScopes.some(
        (scope) =>
          scope.kind === 'LINKED_ELDER' &&
          scope.organizationId === candidate.organizationId &&
          scope.facilityId === candidate.facilityId &&
          scope.resourceType === 'ELDER' &&
          scope.resourceId === candidate.emergencyEvent.elderId &&
          scope.validFrom.getTime() <= now.getTime() &&
          (scope.validUntil === null ||
            scope.validUntil.getTime() > now.getTime()),
      ),
  );
}

export class FamilyEmergencyNotificationDispatcher {
  constructor(
    private readonly repository: FamilyEmergencyDeliveryRepository,
    private readonly provider: FamilyEmergencyNotificationProvider,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 25): Promise<{ claimed: number; delivered: number; failed: number }> {
    const startedAt = this.now();
    const deliveries = await this.repository.claimDue(
      startedAt,
      new Date(startedAt.getTime() + 30_000),
      limit,
    );
    let delivered = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      try {
        const receipt = await this.provider.sendFamily({
          organizationId: delivery.organizationId,
          facilityId: delivery.facilityId,
          emergencyEventId: delivery.emergencyEventId,
          deliveryId: delivery.id,
          familyRelationshipId: delivery.familyRelationshipId,
          stage: delivery.stage,
          channel: delivery.channel,
          idempotencyKey: delivery.providerKey,
        });
        await this.repository.markDelivered(delivery, receipt);
        delivered += 1;
      } catch {
        const retryAt = new Date(
          this.now().getTime() + familyDeliveryBackoffMs(delivery.attempts),
        );
        await this.repository.markFailed(
          delivery,
          'FAKE_NOTIFICATION_FAILED',
          retryAt,
        );
        failed += 1;
      }
    }

    if (deliveries.length > 0) {
      this.logger.info('Family emergency notification batch processed', {
        claimed: deliveries.length,
        delivered,
        failed,
      });
    }
    return { claimed: deliveries.length, delivered, failed };
  }
}

export function familyDeliveryBackoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 9));
}
