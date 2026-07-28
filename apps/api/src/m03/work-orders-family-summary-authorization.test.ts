import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import type { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03MutationService } from './m03-mutation.service.js';
import type { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

describe('family summary final-query authorization', () => {
  it('binds relationship, preference and consent to both final count and row queries', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      client: {
        familySummary: { count, findMany },
        $transaction: vi.fn((operations: readonly Promise<unknown>[]) => Promise.all(operations)),
      },
    } as unknown as DatabaseService;
    const service = new WorkOrdersService(
      database,
      {} as M03MutationService,
      {} as ElderAccessService,
      {} as TaskUpdatesService,
    );
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const facilityId = '20000000-0000-4000-8000-000000000001';
    const familyUserId = '30000000-0000-4000-8000-000000000001';

    await expect(service.listFamilySummaries(
      { organizationId, facilityId, correlationId: 'family-final-query-test' },
      { page: 1, pageSize: 20 },
      { userId: familyUserId } as never,
    )).resolves.toEqual({
      items: [],
      pageInfo: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });

    const countWhere = (count.mock.calls[0]?.[0] as { where: unknown }).where;
    const rowsWhere = (findMany.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(rowsWhere).toBe(countWhere);
    const serialized = JSON.stringify(rowsWhere);
    for (const required of [
      familyUserId,
      'familyRelationships',
      'sharingPreferences',
      'TIMELINE_SUMMARY',
      'FAMILY_SHARING',
      'GRANTED',
      'supersededAt',
      'expiresAt',
      'validUntil',
      'revokedAt',
    ]) {
      expect(serialized).toContain(required);
    }
    expect(serialized).toContain(organizationId);
    expect(serialized).toContain(facilityId);
  });
});
