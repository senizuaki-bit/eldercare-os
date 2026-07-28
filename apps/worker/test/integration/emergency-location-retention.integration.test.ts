import { randomUUID } from 'node:crypto';
import { parseServiceConfig } from '@eldercare/config';
import { createPrismaClient } from '@eldercare/db';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PrismaEmergencyLocationRetentionRepository } from '../../src/emergency-location-retention.js';

const config = parseServiceConfig();
const database = createPrismaClient(config.databaseUrl);
const createdEventIds: string[] = [];
let createdSonghePolicyId: string | undefined;
let createdSongheElderId: string | undefined;

afterEach(async () => {
  if (createdEventIds.length > 0) {
    await database.emergencyLocationSnapshot.deleteMany({
      where: { emergencyEventId: { in: createdEventIds } },
    });
    await database.emergencyEvent.deleteMany({
      where: { id: { in: createdEventIds } },
    });
    createdEventIds.length = 0;
  }
  if (createdSonghePolicyId !== undefined) {
    await database.escalationPolicy.deleteMany({
      where: { id: createdSonghePolicyId },
    });
    createdSonghePolicyId = undefined;
  }
  if (createdSongheElderId !== undefined) {
    await database.elder.deleteMany({
      where: { id: createdSongheElderId },
    });
    createdSongheElderId = undefined;
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe('emergency location retention cleanup', () => {
  it('deletes only expired snapshots across tenants and is idempotent', async () => {
    const uniqueOffsetMs =
      Number.parseInt(randomUUID().slice(0, 8), 16) % (24 * 60 * 60_000);
    const now = new Date(
      Date.parse('2001-01-02T00:00:00.000Z') + uniqueOffsetMs,
    );
    const qinglan = await database.organization.findUniqueOrThrow({
      where: { slug: 'qinglan-demo' },
      select: {
        id: true,
        facilities: {
          where: { code: 'QL-MAIN' },
          select: {
            id: true,
            elders: { take: 1, select: { id: true } },
          },
          take: 1,
        },
        escalationPolicies: {
          where: { status: 'ACTIVE' },
          select: { id: true, facilityId: true, version: true },
          take: 1,
        },
      },
    });
    const songhe = await database.organization.findUniqueOrThrow({
      where: { slug: 'songhe-demo' },
      select: {
        id: true,
        facilities: {
          where: { code: 'SH-MAIN' },
          select: { id: true },
          take: 1,
        },
      },
    });
    const qinglanFacility = qinglan.facilities[0];
    const qinglanElder = qinglanFacility?.elders[0];
    const qinglanPolicy = qinglan.escalationPolicies.find(
      (policy) => policy.facilityId === qinglanFacility?.id,
    );
    const songheFacility = songhe.facilities[0];
    if (
      qinglanFacility === undefined ||
      qinglanElder === undefined ||
      qinglanPolicy === undefined ||
      songheFacility === undefined
    ) {
      throw new Error('M04 retention integration seed prerequisites are missing');
    }

    createdSongheElderId = randomUUID();
    createdSonghePolicyId = randomUUID();
    await database.elder.create({
      data: {
        id: createdSongheElderId,
        organizationId: songhe.id,
        facilityId: songheFacility.id,
        recordNumber: `RET-${randomUUID()}`,
        displayName: 'Retention integration elder',
      },
    });
    await database.escalationPolicy.create({
      data: {
        id: createdSonghePolicyId,
        organizationId: songhe.id,
        facilityId: songheFacility.id,
        code: `RET-${randomUUID()}`,
        name: 'Retention integration policy',
        version: 1,
        effectiveAt: new Date(now.getTime() - 60_000),
      },
    });

    const expiredQinglanEvent = await createEmergencyEvent({
      organizationId: qinglan.id,
      facilityId: qinglanFacility.id,
      elderId: qinglanElder.id,
      policyId: qinglanPolicy.id,
      policyVersion: qinglanPolicy.version,
      now,
      retentionUntil: new Date(now.getTime() - 60_000),
    });
    const currentQinglanEvent = await createEmergencyEvent({
      organizationId: qinglan.id,
      facilityId: qinglanFacility.id,
      elderId: qinglanElder.id,
      policyId: qinglanPolicy.id,
      policyVersion: qinglanPolicy.version,
      now,
      retentionUntil: new Date(now.getTime() + 60_000),
    });
    const expiredSongheEvent = await createEmergencyEvent({
      organizationId: songhe.id,
      facilityId: songheFacility.id,
      elderId: createdSongheElderId,
      policyId: createdSonghePolicyId,
      policyVersion: 1,
      now,
      retentionUntil: new Date(now.getTime() - 30_000),
    });
    const repository = new PrismaEmergencyLocationRetentionRepository(database);

    await expect(repository.deleteExpired(now, 100)).resolves.toBe(2);
    expect(
      await database.emergencyLocationSnapshot.findUnique({
        where: { emergencyEventId: expiredQinglanEvent },
      }),
    ).toBeNull();
    expect(
      await database.emergencyLocationSnapshot.findUnique({
        where: { emergencyEventId: expiredSongheEvent },
      }),
    ).toBeNull();
    expect(
      await database.emergencyLocationSnapshot.findUnique({
        where: { emergencyEventId: currentQinglanEvent },
      }),
    ).not.toBeNull();

    const audits = await database.auditEvent.findMany({
      where: {
        organizationId: { in: [qinglan.id, songhe.id] },
        action: 'emergency.location.retention.delete',
        occurredAt: now,
      },
      orderBy: { organizationId: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.organizationId).sort()).toEqual(
      [qinglan.id, songhe.id].sort(),
    );
    for (const audit of audits) {
      expect(audit.resourceType).toBe('EmergencyLocationRetentionBatch');
      expect(audit.resourceId).toBeNull();
      expect(audit.safeMetadata).toEqual({
        policyVersion: 'm04-location-retention-v1',
        deletedCount: 1,
      });
      expect(JSON.stringify(audit.safeMetadata)).not.toMatch(
        /elder|event|floor|room|coordinate|normalized|accuracy/i,
      );
    }

    await expect(repository.deleteExpired(now, 100)).resolves.toBe(0);
    expect(
      await database.auditEvent.count({
        where: {
          organizationId: { in: [qinglan.id, songhe.id] },
          action: 'emergency.location.retention.delete',
          occurredAt: now,
        },
      }),
    ).toBe(2);
  }, 20_000);
});

async function createEmergencyEvent(input: {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly elderId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly now: Date;
  readonly retentionUntil: Date;
}): Promise<string> {
  const event = await database.emergencyEvent.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      elderId: input.elderId,
      sourceKind: 'STAFF_MANUAL',
      reasonCode: 'RETENTION_INTEGRATION_TEST',
      escalationPolicyId: input.policyId,
      escalationPolicyVersion: input.policyVersion,
      openedAt: input.now,
      correlationId: `m04-retention-it:${randomUUID()}`,
    },
  });
  createdEventIds.push(event.id);
  await database.emergencyLocationSnapshot.create({
    data: {
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      elderId: input.elderId,
      emergencyEventId: event.id,
      state: 'UNKNOWN',
      source: 'RETENTION_INTEGRATION_TEST',
      fallbackReasonCode: 'LOCATION_MISSING',
      decidedAt: new Date(input.now.getTime() - 24 * 60 * 60_000),
      retentionUntil: input.retentionUntil,
    },
  });
  return event.id;
}
