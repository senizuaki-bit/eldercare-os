import { describe, expect, it } from 'vitest';
import {
  isShiftAssignmentStatusTransitionAllowed,
  isShiftStatusTransitionAllowed,
  isStaffStatusTransitionAllowed,
  isTeamStatusTransitionAllowed,
} from './staffing.service.js';

describe('M02 staffing state transitions', () => {
  it('allows inactive staff and teams to reactivate but keeps archived records terminal', () => {
    expect(isStaffStatusTransitionAllowed('ACTIVE', 'INACTIVE')).toBe(true);
    expect(isStaffStatusTransitionAllowed('INACTIVE', 'ACTIVE')).toBe(true);
    expect(isStaffStatusTransitionAllowed('ARCHIVED', 'ACTIVE')).toBe(false);

    expect(isTeamStatusTransitionAllowed('ACTIVE', 'INACTIVE')).toBe(true);
    expect(isTeamStatusTransitionAllowed('INACTIVE', 'ACTIVE')).toBe(true);
    expect(isTeamStatusTransitionAllowed('ARCHIVED', 'INACTIVE')).toBe(false);
  });

  it('keeps completed and cancelled shifts terminal and rejects skipped completion', () => {
    expect(isShiftStatusTransitionAllowed('SCHEDULED', 'IN_PROGRESS')).toBe(true);
    expect(isShiftStatusTransitionAllowed('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(isShiftStatusTransitionAllowed('SCHEDULED', 'COMPLETED')).toBe(false);
    expect(isShiftStatusTransitionAllowed('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isShiftStatusTransitionAllowed('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isShiftStatusTransitionAllowed('CANCELLED', 'SCHEDULED')).toBe(false);
  });

  it('requires assignments to be accepted before cancellation or terminal cancellation', () => {
    expect(isShiftAssignmentStatusTransitionAllowed('ASSIGNED', 'ACCEPTED')).toBe(true);
    expect(isShiftAssignmentStatusTransitionAllowed('ASSIGNED', 'CANCELLED')).toBe(true);
    expect(isShiftAssignmentStatusTransitionAllowed('ACCEPTED', 'ASSIGNED')).toBe(false);
    expect(isShiftAssignmentStatusTransitionAllowed('ACCEPTED', 'CANCELLED')).toBe(true);
    expect(isShiftAssignmentStatusTransitionAllowed('CANCELLED', 'ACCEPTED')).toBe(false);
  });
});
