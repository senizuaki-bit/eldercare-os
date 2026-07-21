import { roomSchema } from '@eldercare/contracts';
import { describe, expect, it } from 'vitest';
import { deriveRoomCapacity } from './facility-directory.service.js';

describe('M02 room capacity projection', () => {
  it('separates inactive physical capacity from operational occupancy', () => {
    const capacity = deriveRoomCapacity([
      { operationalStatus: 'ACTIVE', stays: [{ id: 'active-stay' }] },
      { operationalStatus: 'ACTIVE', stays: [] },
      { operationalStatus: 'OUT_OF_SERVICE', stays: [] },
      { operationalStatus: 'ARCHIVED', stays: [] },
    ]);

    expect(capacity).toEqual({
      bedCount: 4,
      activeBedCount: 2,
      occupiedBedCount: 1,
      availableBedCount: 1,
    });
    expect(roomSchema.safeParse({
      id: '84000000-0000-4000-8000-000000000001',
      organizationId: '10000000-0000-4000-8000-000000000002',
      facilityId: '20000000-0000-4000-8000-000000000001',
      floorId: '82000000-0000-4000-8000-000000000001',
      zoneId: null,
      code: 'R101',
      name: 'Room 101',
      status: 'ACTIVE',
      ...capacity,
      version: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    }).success).toBe(true);
  });

  it('does not count a legacy stay on an inactive bed as operational occupancy', () => {
    expect(deriveRoomCapacity([
      { operationalStatus: 'OUT_OF_SERVICE', stays: [{ id: 'legacy-stay' }] },
    ])).toEqual({
      bedCount: 1,
      activeBedCount: 0,
      occupiedBedCount: 0,
      availableBedCount: 0,
    });
  });
});
