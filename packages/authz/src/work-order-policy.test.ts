import { describe, expect, it } from 'vitest';

import { M03_PERMISSIONS } from './permissions.js';
import type { AuthorizationContext } from './types.js';
import {
  allowedWorkOrderTransitions,
  authorizeWorkOrderArrival,
  authorizeWorkOrderAccess,
  authorizeWorkOrderTransition,
  isWorkOrderTransitionAllowed,
} from './work-order-policy.js';

const now = new Date('2026-07-21T08:00:00.000Z');
const organizationId = 'org-a';
const facilityId = 'facility-a';
const elderId = 'elder-a';
const workOrderId = 'work-order-a';
const actorId = 'actor-a';
const target = {
  organizationId,
  facilityId,
  elderId,
  workOrderId,
  ownerUserId: actorId,
  careTeamId: 'team-a',
};

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    actorId,
    organizationId,
    roles: ['CAREGIVER'],
    permissions: [
      M03_PERMISSIONS.WORK_ORDER_READ,
      M03_PERMISSIONS.WORK_ORDER_TRANSITION,
      M03_PERMISSIONS.VOICE_SUBMISSION_READ,
      M03_PERMISSIONS.TRANSCRIPT_READ,
    ],
    scopes: [
      {
        kind: 'ACTIVE_SHIFT',
        scopeKey: 'active-shift-a',
        organizationId,
        facilityId,
        validFrom: '2026-07-21T00:00:00.000Z',
        validUntil: '2026-07-22T00:00:00.000Z',
      },
      {
        kind: 'CARE_TEAM',
        scopeKey: 'care-team-a',
        organizationId,
        facilityId,
        resourceType: 'CARE_TEAM',
        resourceId: 'team-a',
      },
    ],
    ...overrides,
  };
}

describe('M03 work-order state policy', () => {
  it('allows only the exact forward state machine and keeps terminal states terminal', () => {
    expect(allowedWorkOrderTransitions('NEW')).toEqual(['ASSIGNED', 'CANCELLED']);
    expect(isWorkOrderTransitionAllowed('ASSIGNED', 'ACCEPTED')).toBe(true);
    expect(isWorkOrderTransitionAllowed('ACCEPTED', 'COMPLETED')).toBe(false);
    expect(isWorkOrderTransitionAllowed('COMPLETED', 'CANCELLED')).toBe(false);
    expect(allowedWorkOrderTransitions('CLOSED')).toEqual([]);
    expect(allowedWorkOrderTransitions('CANCELLED')).toEqual([]);
  });

  it('allows an active assigned caregiver to accept, start and complete only in order', () => {
    const base = {
      context: context(),
      target,
      facts: {
        caregiverShiftActive: true,
        caregiverInTargetTeam: true,
        caregiverIsAssignee: true,
      },
      now,
    } as const;
    expect(
      authorizeWorkOrderTransition({ ...base, fromStatus: 'ASSIGNED', toStatus: 'ACCEPTED' }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeWorkOrderTransition({ ...base, fromStatus: 'ACCEPTED', toStatus: 'COMPLETED' }),
    ).toEqual({ allowed: false, reasonCode: 'STATE_TRANSITION_INVALID' });
    expect(
      authorizeWorkOrderTransition({ ...base, fromStatus: 'CLOSED', toStatus: 'CANCELLED' }),
    ).toEqual({ allowed: false, reasonCode: 'STATE_TERMINAL' });
  });

  it('allows arrival only while accepted and only for the active assignee', () => {
    const base = {
      context: context(),
      target,
      facts: {
        caregiverShiftActive: true,
        caregiverInTargetTeam: true,
        caregiverIsAssignee: true,
      },
      now,
    } as const;
    expect(authorizeWorkOrderArrival({ ...base, status: 'ACCEPTED' })).toEqual({
      allowed: true,
      reasonCode: 'ALLOWED',
    });
    expect(authorizeWorkOrderArrival({ ...base, status: 'IN_PROGRESS' })).toEqual({
      allowed: false,
      reasonCode: 'STATE_TRANSITION_INVALID',
    });
    expect(
      authorizeWorkOrderArrival({
        ...base,
        status: 'ACCEPTED',
        facts: { ...base.facts, caregiverIsAssignee: false },
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
  });
});

describe('M03 work-order resource policy', () => {
  it('fails closed across tenants before considering assignment facts', () => {
    const decision = authorizeWorkOrderAccess({
      context: context({ organizationId: 'org-b' }),
      target,
      view: 'WORK_ORDER',
      facts: { caregiverShiftActive: true, caregiverIsAssignee: true },
      now,
    });
    expect(decision).toEqual({ allowed: false, reasonCode: 'SCOPE_MISSING' });
  });

  it('rejects caregivers after shift expiry and team members from private audio', () => {
    const expired = context({
      scopes: context().scopes.map((scope) => ({
        ...scope,
        validUntil: '2026-07-20T00:00:00.000Z',
      })),
    });
    expect(
      authorizeWorkOrderAccess({
        context: expired,
        target,
        view: 'WORK_ORDER',
        facts: { caregiverShiftActive: false, caregiverIsAssignee: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'SCOPE_EXPIRED' });

    expect(
      authorizeWorkOrderAccess({
        context: context(),
        target,
        view: 'PRIVATE_AUDIO',
        facts: { caregiverShiftActive: true, caregiverInTargetTeam: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
  });

  it('lets family see only a published, consented summary for a linked elder', () => {
    const familyContext = context({
      roles: ['FAMILY'],
      permissions: [M03_PERMISSIONS.FAMILY_SUMMARY_READ],
      scopes: [
        {
          kind: 'LINKED_ELDER',
          scopeKey: 'linked-elder-a',
          organizationId,
          facilityId,
          resourceType: 'ELDER',
          resourceId: elderId,
        },
      ],
    });
    const facts = {
      familyRelationshipActive: true,
      familySharingConsentActive: true,
      familySummaryPublished: true,
    } as const;
    expect(
      authorizeWorkOrderAccess({
        context: familyContext,
        target,
        view: 'FAMILY_SUMMARY',
        facts,
        now,
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeWorkOrderAccess({
        context: familyContext,
        target,
        view: 'FAMILY_SUMMARY',
        facts: { ...facts, familySummaryPublished: false },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'FIELD_NOT_SHARED' });
    expect(
      authorizeWorkOrderAccess({
        context: familyContext,
        target,
        view: 'PRIVATE_AUDIO',
        facts,
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'PERMISSION_MISSING' });
  });

  it('requires an elder-owned completed service before verification', () => {
    const elderContext = context({
      roles: ['ELDER'],
      permissions: [M03_PERMISSIONS.WORK_ORDER_VERIFY],
      scopes: [
        {
          kind: 'OWN_RECORD',
          scopeKey: 'own-record-a',
          organizationId,
          facilityId,
        },
      ],
    });
    const base = {
      context: elderContext,
      target,
      fromStatus: 'COMPLETED' as const,
      toStatus: 'VERIFIED' as const,
      now,
    };
    expect(
      authorizeWorkOrderTransition({
        ...base,
        facts: { ownsRecord: true, serviceCompletionPresent: false },
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
    expect(
      authorizeWorkOrderTransition({
        ...base,
        facts: { ownsRecord: true, serviceCompletionPresent: true },
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
  });
});
