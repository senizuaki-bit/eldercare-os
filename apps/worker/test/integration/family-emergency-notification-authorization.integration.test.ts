import { randomUUID } from 'node:crypto';
import { parseServiceConfig } from '@eldercare/config';
import { Prisma, createPrismaClient } from '@eldercare/db';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaFamilyEmergencyDeliveryRepository } from '../../src/family-emergency-notifications.js';

const config = parseServiceConfig();
const database = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await database.$disconnect();
});

describe('family emergency notification claim-time authorization', () => {
  it('suppresses an already queued delivery after its organization is suspended', async () => {
    await withRollback(async (transaction) => {
      const fixture = await createAuthorizedDeliveryFixture(
        transaction,
        'ORGANIZATION_SUSPENDED',
      );
      await transaction.organization.update({
        where: { id: fixture.organizationId },
        data: { status: 'SUSPENDED' },
      });
      const repository = new PrismaFamilyEmergencyDeliveryRepository(transaction);

      await expect(
        repository.claimDue(
          fixture.now,
          new Date(fixture.now.getTime() + 30_000),
          1,
        ),
      ).resolves.toEqual([]);

      await expect(
        transaction.emergencyNotificationDelivery.findUniqueOrThrow({
          where: { id: fixture.deliveryId },
          select: { status: true, lastErrorCode: true },
        }),
      ).resolves.toEqual({
        status: 'SUPPRESSED',
        lastErrorCode: 'FAMILY_DELIVERY_ORGANIZATION_INACTIVE',
      });
    });
  }, 30_000);

  it('suppresses an already queued delivery after its facility is suspended', async () => {
    await withRollback(async (transaction) => {
      const fixture = await createAuthorizedDeliveryFixture(
        transaction,
        'FACILITY_SUSPENDED',
      );
      await transaction.facility.update({
        where: { id: fixture.facilityId },
        data: { status: 'SUSPENDED' },
      });
      const repository = new PrismaFamilyEmergencyDeliveryRepository(transaction);

      await expect(
        repository.claimDue(
          fixture.now,
          new Date(fixture.now.getTime() + 30_000),
          1,
        ),
      ).resolves.toEqual([]);

      await expect(
        transaction.emergencyNotificationDelivery.findUniqueOrThrow({
          where: { id: fixture.deliveryId },
          select: { status: true, lastErrorCode: true },
        }),
      ).resolves.toEqual({
        status: 'SUPPRESSED',
        lastErrorCode: 'FAMILY_DELIVERY_FACILITY_INACTIVE',
      });
    });
  }, 30_000);

  it('suppresses revoked roles, expired scopes, and removed permissions', async () => {
    await withRollback(async (transaction) => {
      const now = new Date();
      const organization = await transaction.organization.findUniqueOrThrow({
        where: { slug: 'qinglan-demo' },
      });
      const facility = await transaction.facility.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          code: 'QL-MAIN',
        },
      });
      const elder = await transaction.elder.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          facilityId: facility.id,
        },
      });
      const policy = await transaction.escalationPolicy.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          facilityId: facility.id,
          status: 'ACTIVE',
        },
      });
      const familyRole = await transaction.role.findUniqueOrThrow({
        where: { code: 'FAMILY' },
      });
      const familySummaryPermission =
        await transaction.permission.findUniqueOrThrow({
          where: { code: 'emergency.family_summary.read' },
        });
      const consent = await transaction.consentRecord.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          facilityId: facility.id,
          elderId: elder.id,
          purpose: 'FAMILY_SHARING',
          decision: 'GRANTED',
          supersededAt: null,
          effectiveAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      const event = await transaction.emergencyEvent.create({
        data: {
          organizationId: organization.id,
          facilityId: facility.id,
          elderId: elder.id,
          sourceKind: 'STAFF_MANUAL',
          reasonCode: 'FAMILY_AUTHORIZATION_INTEGRATION_TEST',
          escalationPolicyId: policy.id,
          escalationPolicyVersion: policy.version,
          openedAt: now,
          correlationId: `m04-family-auth-it:${randomUUID()}`,
        },
      });

      const revokedRoleDeliveryId = await createDeliveryCandidate(transaction, {
        organizationId: organization.id,
        facilityId: facility.id,
        elderId: elder.id,
        emergencyEventId: event.id,
        consentRecordId: consent.id,
        familyRoleId: familyRole.id,
        nextAttemptAt: new Date('2000-01-01T00:00:00.000Z'),
        revokedAt: new Date(now.getTime() - 1_000),
        scopeValidUntil: null,
        now,
      });
      const expiredScopeDeliveryId = await createDeliveryCandidate(transaction, {
        organizationId: organization.id,
        facilityId: facility.id,
        elderId: elder.id,
        emergencyEventId: event.id,
        consentRecordId: consent.id,
        familyRoleId: familyRole.id,
        nextAttemptAt: new Date('2000-01-01T00:00:00.001Z'),
        revokedAt: null,
        scopeValidUntil: new Date(now.getTime() - 1_000),
        now,
      });
      const removedPermissionDeliveryId = await createDeliveryCandidate(
        transaction,
        {
          organizationId: organization.id,
          facilityId: facility.id,
          elderId: elder.id,
          emergencyEventId: event.id,
          consentRecordId: consent.id,
          familyRoleId: familyRole.id,
          nextAttemptAt: new Date('2000-01-01T00:00:00.002Z'),
          revokedAt: null,
          scopeValidUntil: null,
          now,
        },
      );
      const repository = new PrismaFamilyEmergencyDeliveryRepository(transaction);

      await expect(
        repository.claimDue(now, new Date(now.getTime() + 30_000), 1),
      ).resolves.toEqual([]);
      await expect(
        repository.claimDue(now, new Date(now.getTime() + 30_000), 1),
      ).resolves.toEqual([]);

      await transaction.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: familyRole.id,
            permissionId: familySummaryPermission.id,
          },
        },
      });
      await expect(
        repository.claimDue(now, new Date(now.getTime() + 30_000), 1),
      ).resolves.toEqual([]);

      const deliveries = await transaction.emergencyNotificationDelivery.findMany({
        where: {
          id: {
            in: [
              revokedRoleDeliveryId,
              expiredScopeDeliveryId,
              removedPermissionDeliveryId,
            ],
          },
        },
        orderBy: { nextAttemptAt: 'asc' },
      });
      expect(deliveries).toHaveLength(3);
      expect(deliveries.every((delivery) => delivery.status === 'SUPPRESSED')).toBe(
        true,
      );
      expect(
        deliveries.every(
          (delivery) =>
            delivery.lastErrorCode ===
            'FAMILY_DELIVERY_AUTHORIZATION_INACTIVE',
        ),
      ).toBe(true);
    });
  }, 30_000);
});

async function createAuthorizedDeliveryFixture(
  transaction: Prisma.TransactionClient,
  reasonSuffix: string,
): Promise<{
  readonly organizationId: string;
  readonly facilityId: string;
  readonly deliveryId: string;
  readonly now: Date;
}> {
  const now = new Date();
  const organization = await transaction.organization.findUniqueOrThrow({
    where: { slug: 'qinglan-demo' },
  });
  const facility = await transaction.facility.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      code: 'QL-MAIN',
    },
  });
  const elder = await transaction.elder.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      facilityId: facility.id,
    },
  });
  const policy = await transaction.escalationPolicy.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      facilityId: facility.id,
      status: 'ACTIVE',
    },
  });
  const familyRole = await transaction.role.findUniqueOrThrow({
    where: { code: 'FAMILY' },
  });
  const consent = await transaction.consentRecord.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      facilityId: facility.id,
      elderId: elder.id,
      purpose: 'FAMILY_SHARING',
      decision: 'GRANTED',
      supersededAt: null,
      effectiveAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  const event = await transaction.emergencyEvent.create({
    data: {
      organizationId: organization.id,
      facilityId: facility.id,
      elderId: elder.id,
      sourceKind: 'STAFF_MANUAL',
      reasonCode: `FAMILY_AUTHORIZATION_${reasonSuffix}`,
      escalationPolicyId: policy.id,
      escalationPolicyVersion: policy.version,
      openedAt: now,
      correlationId: `m04-family-auth-it:${randomUUID()}`,
    },
  });
  const deliveryId = await createDeliveryCandidate(transaction, {
    organizationId: organization.id,
    facilityId: facility.id,
    elderId: elder.id,
    emergencyEventId: event.id,
    consentRecordId: consent.id,
    familyRoleId: familyRole.id,
    nextAttemptAt: new Date(now.getTime() - 1_000),
    revokedAt: null,
    scopeValidUntil: null,
    now,
  });

  return {
    organizationId: organization.id,
    facilityId: facility.id,
    deliveryId,
    now,
  };
}

interface DeliveryCandidateInput {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly elderId: string;
  readonly emergencyEventId: string;
  readonly consentRecordId: string;
  readonly familyRoleId: string;
  readonly nextAttemptAt: Date;
  readonly revokedAt: Date | null;
  readonly scopeValidUntil: Date | null;
  readonly now: Date;
}

async function createDeliveryCandidate(
  transaction: Prisma.TransactionClient,
  input: DeliveryCandidateInput,
): Promise<string> {
  const suffix = randomUUID();
  const familyUser = await transaction.user.create({
    data: {
      loginName: `family-auth-it-${suffix}`,
      normalizedLoginName: `family-auth-it-${suffix}`,
      displayName: 'Family authorization integration user',
    },
  });
  const relationship = await transaction.familyRelationship.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      elderId: input.elderId,
      familyUserId: familyUser.id,
      relationshipKind: 'OTHER',
      relationshipLabel: 'Integration fixture',
      status: 'VERIFIED',
      activeFrom: new Date(input.now.getTime() - 60_000),
      verifiedAt: input.now,
    },
  });
  await transaction.sharingPreference.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      elderId: input.elderId,
      familyRelationshipId: relationship.id,
      consentRecordId: input.consentRecordId,
      field: 'TIMELINE_SUMMARY',
      allowed: true,
      validFrom: new Date(input.now.getTime() - 60_000),
    },
  });
  await transaction.familyEmergencyNotificationPreference.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      elderId: input.elderId,
      familyRelationshipId: relationship.id,
      enabled: true,
      notifyOnOpened: false,
      notifyOnResolved: true,
      channel: 'IN_APP',
      updatedByUserId: familyUser.id,
    },
  });
  const userRole = await transaction.userRole.create({
    data: {
      userId: familyUser.id,
      roleId: input.familyRoleId,
      organizationId: input.organizationId,
      activeFrom: new Date(input.now.getTime() - 60_000),
      revokedAt: input.revokedAt,
    },
  });
  await transaction.dataScope.create({
    data: {
      userRoleId: userRole.id,
      organizationId: input.organizationId,
      kind: 'LINKED_ELDER',
      scopeKey: `linked-elder:${input.elderId}:${suffix}`,
      facilityId: input.facilityId,
      resourceType: 'ELDER',
      resourceId: input.elderId,
      validFrom: new Date(input.now.getTime() - 60_000),
      validUntil: input.scopeValidUntil,
    },
  });
  const delivery = await transaction.emergencyNotificationDelivery.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      emergencyEventId: input.emergencyEventId,
      familyRelationshipId: relationship.id,
      stage: 'RESOLVED',
      channel: 'IN_APP',
      status: 'PENDING',
      providerKey: `m04-family-auth-it:${suffix}`,
      nextAttemptAt: input.nextAttemptAt,
      correlationId: `m04-family-auth-it:${suffix}`,
    },
  });
  return delivery.id;
}

async function withRollback(
  callback: (transaction: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  const rollback = new Error('M04_FAMILY_AUTH_INTEGRATION_ROLLBACK');
  try {
    await database.$transaction(
      async (transaction) => {
        await callback(transaction);
        throw rollback;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 25_000,
      },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
