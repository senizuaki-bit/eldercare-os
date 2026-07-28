import type { PrismaClient } from '@eldercare/db';
import type { Logger } from '@eldercare/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  EmergencyLocationRetentionCleanup,
  PrismaEmergencyLocationRetentionRepository,
  type EmergencyLocationRetentionRepository,
} from './emergency-location-retention.js';

const now = new Date('2026-07-28T08:00:00.000Z');
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('PrismaEmergencyLocationRetentionRepository', () => {
  it('deletes with tenant guards and writes aggregate-only tenant audits', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn(
      (input: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: String(input.data['organizationId']) }),
    );
    const transaction = {
      emergencyLocationSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'snapshot-a1',
            organizationId: 'org-a',
            facilityId: 'facility-a',
          },
          {
            id: 'snapshot-a2',
            organizationId: 'org-a',
            facilityId: 'facility-a',
          },
          {
            id: 'snapshot-b1',
            organizationId: 'org-b',
            facilityId: 'facility-b',
          },
        ]),
        deleteMany,
      },
      auditEvent: {
        create: auditCreate,
      },
    };
    const runTransaction = vi.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const repository = new PrismaEmergencyLocationRetentionRepository({
      $transaction: runTransaction,
    } as unknown as PrismaClient);

    await expect(repository.deleteExpired(now, 50)).resolves.toBe(3);
    expect(deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'snapshot-a1',
        organizationId: 'org-a',
        facilityId: 'facility-a',
        retentionUntil: { lte: now },
      },
    });
    expect(deleteMany).toHaveBeenNthCalledWith(3, {
      where: {
        id: 'snapshot-b1',
        organizationId: 'org-b',
        facilityId: 'facility-b',
        retentionUntil: { lte: now },
      },
    });
    expect(auditCreate).toHaveBeenCalledTimes(2);
    const auditPayloads = auditCreate.mock.calls.map(
      ([input]) => input.data,
    );
    const organizationAAudit = auditPayloads.find(
      (payload) => payload['organizationId'] === 'org-a',
    );
    expect(organizationAAudit?.['facilityId']).toBe('facility-a');
    expect(organizationAAudit?.['resourceType']).toBe(
      'EmergencyLocationRetentionBatch',
    );
    expect(organizationAAudit?.['resourceId']).toBeNull();
    expect(organizationAAudit?.['safeMetadata']).toEqual({
      policyVersion: 'm04-location-retention-v1',
      deletedCount: 2,
    });
    expect(JSON.stringify(auditPayloads)).not.toMatch(
      /elder|event|floor|room|coordinate|normalized|accuracy/i,
    );
  });

  it('is an idempotent no-op when nothing is expired', async () => {
    const auditCreate = vi.fn();
    const transaction = {
      emergencyLocationSnapshot: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      auditEvent: {
        create: auditCreate,
      },
    };
    const repository = new PrismaEmergencyLocationRetentionRepository({
      $transaction: (
        callback: (client: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as unknown as PrismaClient);

    await expect(repository.deleteExpired(now, 50)).resolves.toBe(0);
    expect(transaction.emergencyLocationSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe('EmergencyLocationRetentionCleanup', () => {
  it('passes a bounded batch and logs only the deleted count', async () => {
    const deleteExpired = vi.fn().mockResolvedValue(2);
    const repository: EmergencyLocationRetentionRepository = { deleteExpired };
    const info = vi.fn();
    const cleanup = new EmergencyLocationRetentionCleanup(
      repository,
      { ...logger, info },
      () => now,
    );

    await expect(cleanup.runOnce(25)).resolves.toBe(2);
    expect(deleteExpired).toHaveBeenCalledWith(now, 25);
    expect(info).toHaveBeenCalledWith(
      'Expired emergency location snapshots deleted',
      { deletedCount: 2 },
    );
  });
});
