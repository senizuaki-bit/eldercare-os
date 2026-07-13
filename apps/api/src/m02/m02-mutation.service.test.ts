import type { Prisma } from '@eldercare/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import {
  createEventId,
  createOutboxIdempotencyKey,
  isCanonicalEventType,
  M02MutationService,
} from './m02-mutation.service.js';

describe('M02 event envelope identifiers', () => {
  it('creates a 26-character uppercase Crockford identifier accepted by the migration', () => {
    const eventId = createEventId(1_752_384_000_000, Buffer.alloc(16, 31));
    expect(eventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(eventId).toHaveLength(26);
  });

  it('accepts canonical event names and rejects lowercase event names', () => {
    expect(isCanonicalEventType('FACILITY.BUILDING.CREATED.V1')).toBe(true);
    expect(isCanonicalEventType('facility.building.created.v1')).toBe(false);
  });

  it('hashes maximum-length correlation IDs into a bounded deterministic idempotency key', () => {
    const correlationId = 'c'.repeat(128);
    const key = createOutboxIdempotencyKey(
      correlationId,
      'ELDER.FAMILY_RELATIONSHIP_REVOKED.V1',
      '87000000-0000-4000-8000-000000000001',
      999_999,
    );

    expect(key).toBe(createOutboxIdempotencyKey(
      correlationId,
      'ELDER.FAMILY_RELATIONSHIP_REVOKED.V1',
      '87000000-0000-4000-8000-000000000001',
      999_999,
    ));
    expect(key).toMatch(/^m02-v1:[a-f0-9]{64}$/);
    expect(key.length).toBeLessThanOrEqual(192);
    expect(key).not.toContain(correlationId);
  });

  it('separates otherwise ambiguous idempotency key components', () => {
    expect(createOutboxIdempotencyKey('abcdefgh', 'A.B', 'c:d', 1)).not.toBe(
      createOutboxIdempotencyKey('abcdefgh:A', 'B.c', 'd', 1),
    );
  });

  it('threads a validated non-sensitive relationship reason code into the audit event', async () => {
    const auditRecord = vi.fn<AuditService['record']>().mockResolvedValue(undefined);
    const outboxCreate = vi.fn<
      (input: { data: { idempotencyKey: string } }) => Promise<{ id: string }>
    >().mockResolvedValue({ id: 'outbox' });
    const service = new M02MutationService({ record: auditRecord } as unknown as AuditService);
    const transaction = {
      outboxEvent: { create: outboxCreate },
    } as unknown as Prisma.TransactionClient;

    await service.record(
      transaction,
      {
        organizationId: '10000000-0000-4000-8000-000000000002',
        facilityId: '20000000-0000-4000-8000-000000000001',
        correlationId: 'c'.repeat(128),
      },
      { userId: '30000000-0000-4000-8000-000000000002' } as AuthenticatedSession,
      {
        action: 'ELDER.FAMILY_RELATIONSHIP_REVOKED',
        eventType: 'ELDER.FAMILY_RELATIONSHIP_REVOKED.V1',
        aggregateType: 'FAMILY_RELATIONSHIP',
        aggregateId: '88000000-0000-4000-8000-000000000001',
        aggregateVersion: 2,
        resourceType: 'FAMILY_RELATIONSHIP',
        reasonCode: 'CONSENT_WITHDRAWN',
      },
    );

    expect(auditRecord.mock.calls[0]?.[0].reasonCode).toBe('CONSENT_WITHDRAWN');
    expect(auditRecord.mock.calls[0]?.[1]).toBe(transaction);
    expect(outboxCreate.mock.calls[0]?.[0].data.idempotencyKey).toMatch(
      /^m02-v1:[a-f0-9]{64}$/,
    );
  });
});
