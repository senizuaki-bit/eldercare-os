import { describe, expect, it, vi } from 'vitest';
import type { TaskUpdateEvent } from '@eldercare/contracts';
import { TaskUpdatesService } from './task-updates.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
const STAFF_ID = '30000000-0000-4000-8000-000000000001';
const TEAM_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_TEAM_ID = '40000000-0000-4000-8000-000000000002';
const ELDER_ID = '60000000-0000-4000-8000-000000000001';
const OUT_OF_SCOPE_ELDER_ID = '60000000-0000-4000-8000-000000000002';

describe('TaskUpdatesService caregiver scope', () => {
  it('rechecks team, elder scope and current eligibility before every event', async () => {
    const updates = new TaskUpdatesService();
    const received: TaskUpdateEvent[] = [];
    const checked: string[] = [];
    let eligible = true;
    const subscription = updates
      .forCaregiver(ORGANIZATION_ID, FACILITY_ID, (scope) => {
        checked.push(scope.workOrderId);
        return eligible &&
          scope.elderId === ELDER_ID &&
          (
            scope.assigneeStaffProfileId === STAFF_ID ||
            (scope.assigneeStaffProfileId === null && scope.targetTeamId === TEAM_ID)
          );
      })
      .subscribe((event) => received.push(event));

    updates.publish(scopedUpdate('other-team', null, OTHER_TEAM_ID));
    updates.publish(scopedUpdate('same-team-wrong-floor', null, TEAM_ID, OUT_OF_SCOPE_ELDER_ID));
    updates.publish(scopedUpdate('own-team', null, TEAM_ID));
    updates.publish(scopedUpdate('other-staff', '30000000-0000-4000-8000-000000000002', null));
    updates.publish(scopedUpdate('direct', STAFF_ID, null));
    updates.publish({
      ...scopedUpdate('other-facility', STAFF_ID, null),
      facilityId: '20000000-0000-4000-8000-000000000002',
    });
    await vi.waitFor(() => expect(received.map((event) => event.eventId)).toEqual(['own-team', 'direct']));

    eligible = false;
    updates.publish(scopedUpdate('revoked-before-delivery', STAFF_ID, null));
    await vi.waitFor(() => expect(checked).toHaveLength(6));

    subscription.unsubscribe();
    expect(received.map((event) => event.eventId)).toEqual(['own-team', 'direct']);
    expect(received.every((event) => !('elderId' in event))).toBe(true);
  });
});

describe('TaskUpdatesService admin scope', () => {
  it('reauthorizes every facility event and fails closed', async () => {
    const updates = new TaskUpdatesService();
    const received: TaskUpdateEvent[] = [];
    const authorize = vi.fn<() => boolean | Promise<boolean>>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockRejectedValueOnce(new Error('synthetic current-access lookup failure'));
    const subscription = updates
      .forFacility(ORGANIZATION_ID, FACILITY_ID, authorize)
      .subscribe((event) => received.push(event));

    updates.publish(scopedUpdate('admin-current', STAFF_ID, null));
    await vi.waitFor(() => expect(received.map((event) => event.eventId)).toEqual(['admin-current']));

    updates.publish(scopedUpdate('admin-revoked', STAFF_ID, null));
    updates.publish(scopedUpdate('admin-lookup-failed', STAFF_ID, null));
    updates.publish({
      ...scopedUpdate('admin-other-facility', STAFF_ID, null),
      facilityId: '20000000-0000-4000-8000-000000000002',
    });
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(3));

    subscription.unsubscribe();
    expect(received.map((event) => event.eventId)).toEqual(['admin-current']);
  });
});

function scopedUpdate(
  eventId: string,
  assigneeStaffProfileId: string | null,
  targetTeamId: string | null,
  elderId = ELDER_ID,
) {
  const workOrderId = `50000000-0000-4000-8000-${eventId.length.toString().padStart(12, '0')}`;
  return {
    organizationId: ORGANIZATION_ID,
    facilityId: FACILITY_ID,
    elderId,
    workOrderId,
    assigneeStaffProfileId,
    targetTeamId,
    event: {
      eventId,
      eventType: 'WORK_ORDER.ASSIGNED' as const,
      workOrderId,
      status: 'ASSIGNED' as const,
      version: 2,
      occurredAt: '2026-07-22T08:00:00.000Z',
    },
  };
}
