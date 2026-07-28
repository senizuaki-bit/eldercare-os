import { Prisma, type PrismaClient } from '@eldercare/db';
import type { Logger } from '@eldercare/observability';

export interface EmergencyLocationRetentionRepository {
  deleteExpired(now: Date, limit: number): Promise<number>;
}

export class PrismaEmergencyLocationRetentionRepository
  implements EmergencyLocationRetentionRepository
{
  constructor(private readonly database: PrismaClient) {}

  async deleteExpired(now: Date, limit: number): Promise<number> {
    return this.database.$transaction(
      async (transaction) => {
        const snapshots = await transaction.emergencyLocationSnapshot.findMany({
          where: { retentionUntil: { lte: now } },
          select: {
            id: true,
            organizationId: true,
            facilityId: true,
          },
          orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }],
          take: Math.min(Math.max(limit, 1), 1_000),
        });
        const deletedByTenant = new Map<
          string,
          {
            readonly organizationId: string;
            readonly facilityId: string;
            count: number;
          }
        >();
        let deleted = 0;

        for (const snapshot of snapshots) {
          const result = await transaction.emergencyLocationSnapshot.deleteMany({
            where: {
              id: snapshot.id,
              organizationId: snapshot.organizationId,
              facilityId: snapshot.facilityId,
              retentionUntil: { lte: now },
            },
          });
          if (result.count !== 1) continue;

          deleted += 1;
          const tenantKey = `${snapshot.organizationId}:${snapshot.facilityId}`;
          const current = deletedByTenant.get(tenantKey);
          if (current === undefined) {
            deletedByTenant.set(tenantKey, {
              organizationId: snapshot.organizationId,
              facilityId: snapshot.facilityId,
              count: 1,
            });
          } else {
            current.count += 1;
          }
        }

        for (const group of deletedByTenant.values()) {
          await transaction.auditEvent.create({
            data: {
              organizationId: group.organizationId,
              facilityId: group.facilityId,
              actorType: 'SYSTEM',
              action: 'emergency.location.retention.delete',
              outcome: 'SUCCESS',
              resourceType: 'EmergencyLocationRetentionBatch',
              resourceId: null,
              reasonCode: 'LOCATION_RETENTION_EXPIRED',
              correlationId: retentionCorrelationId(
                group.organizationId,
                group.facilityId,
                now,
              ),
              safeMetadata: {
                policyVersion: 'm04-location-retention-v1',
                deletedCount: group.count,
              },
              occurredAt: now,
            },
          });
        }

        return deleted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

export class EmergencyLocationRetentionCleanup {
  constructor(
    private readonly repository: EmergencyLocationRetentionRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(limit = 500): Promise<number> {
    const deleted = await this.repository.deleteExpired(this.now(), limit);
    if (deleted > 0) {
      this.logger.info('Expired emergency location snapshots deleted', {
        deletedCount: deleted,
      });
    }
    return deleted;
  }
}

function retentionCorrelationId(
  organizationId: string,
  facilityId: string,
  now: Date,
): string {
  return [
    'm04-location-retention-v1',
    organizationId,
    facilityId,
    now.toISOString(),
  ].join(':');
}
