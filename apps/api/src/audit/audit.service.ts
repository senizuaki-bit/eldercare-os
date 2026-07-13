import { Inject, Injectable } from '@nestjs/common';
import type { AuditEventsPage, AuditEventsQuery } from '@eldercare/contracts';
import type { Prisma, PrismaClient } from '@eldercare/db';
import { redactSensitive } from '@eldercare/observability';
import { DatabaseService } from '../database/database.service.js';

export type AuditActorType = 'ANONYMOUS' | 'SYSTEM' | 'USER';
export type AuditOutcome = 'DENIED' | 'FAILURE' | 'SUCCESS';

export interface AuditInput {
  readonly organizationId: string;
  readonly facilityId?: string | null;
  readonly actorUserId?: string | null;
  readonly actorType: AuditActorType;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly reasonCode?: string | null;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
}

type AuditClient = Pick<PrismaClient, 'auditEvent'> | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async record(input: AuditInput, client: AuditClient = this.database.client): Promise<void> {
    const safeMetadata = sanitizeAuditMetadata(input.metadata);
    await client.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        facilityId: input.facilityId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType,
        action: input.action,
        outcome: input.outcome,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        reasonCode: input.reasonCode ?? null,
        correlationId: input.correlationId,
        safeMetadata,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  }

  async listForFacility(
    organizationId: string,
    facilityId: string,
    query: AuditEventsQuery,
  ): Promise<AuditEventsPage> {
    const where: Prisma.AuditEventWhereInput = {
      organizationId,
      facilityId,
      ...(query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.outcome === undefined ? {} : { outcome: query.outcome }),
      ...(query.correlationId === undefined ? {} : { correlationId: query.correlationId }),
      ...(query.occurredFrom === undefined && query.occurredTo === undefined
        ? {}
        : {
            occurredAt: {
              ...(query.occurredFrom === undefined ? {} : { gte: new Date(query.occurredFrom) }),
              ...(query.occurredTo === undefined ? {} : { lte: new Date(query.occurredTo) }),
            },
          }),
    };
    const [total, events] = await this.database.client.$transaction([
      this.database.client.auditEvent.count({ where }),
      this.database.client.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: events.map((event) => ({
        id: event.id,
        organizationId: event.organizationId,
        facilityId: event.facilityId,
        actorUserId: event.actorUserId,
        actorType: event.actorType,
        action: event.action,
        outcome: event.outcome,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        reasonCode: event.reasonCode,
        correlationId: event.correlationId,
        safeMetadata: asMetadataRecord(event.safeMetadata),
        occurredAt: event.occurredAt.toISOString(),
      })),
      pageInfo: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }
}

const ALLOWED_METADATA_KEYS = new Set([
  'contextChanged',
  'page',
  'pageSize',
  'resultCount',
  'roleKeys',
  'scopeKinds',
  'source',
  'targetFacilityId',
  'targetOrganizationId',
]);

export function sanitizeAuditMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, Prisma.JsonValue> {
  if (metadata === undefined) return {};

  const output: Record<string, Prisma.JsonValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    const redacted = redactSensitive(value);
    if (isSafeJsonValue(redacted)) output[key] = redacted;
  }

  const serialized = JSON.stringify(output);
  if (serialized.length > 2_048) {
    return { source: 'metadata-truncated' };
  }
  return output;
}

function isSafeJsonValue(value: unknown): value is Prisma.JsonValue {
  if (value === null) return true;
  if (['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSafeJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isSafeJsonValue);
}

function asMetadataRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}
