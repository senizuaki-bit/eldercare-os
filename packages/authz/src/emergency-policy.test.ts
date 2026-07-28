import { describe, expect, it } from 'vitest';

import {
  authorizeEmergencyAccess,
  authorizeEmergencyCommand,
  isEmergencyCommandAllowed,
  type EmergencyAccessAuthorizationRequest,
} from './emergency-policy.js';
import { M04_PERMISSIONS } from './permissions.js';
import type { AuthorizationContext } from './types.js';

const now = new Date('2026-07-28T05:00:00.000Z');
const target = {
  organizationId: 'org-a',
  facilityId: 'facility-a',
  elderId: 'elder-a',
  emergencyId: 'emergency-a',
  ownerUserId: 'elder-user',
  floorId: 'floor-a',
};

function caregiverContext(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    actorId: 'caregiver-user',
    organizationId: 'org-a',
    roles: ['CAREGIVER'],
    permissions: [
      M04_PERMISSIONS.EMERGENCY_READ,
      M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE,
      M04_PERMISSIONS.EMERGENCY_RESPOND,
      M04_PERMISSIONS.EMERGENCY_RESOLVE,
    ],
    scopes: [
      {
        kind: 'ACTIVE_SHIFT',
        scopeKey: 'shift-a',
        organizationId: 'org-a',
        facilityId: 'facility-a',
        validFrom: '2026-07-28T04:00:00.000Z',
        validUntil: '2026-07-28T12:00:00.000Z',
      },
      {
        kind: 'FLOOR',
        scopeKey: 'floor-a',
        organizationId: 'org-a',
        facilityId: 'facility-a',
        resourceId: 'floor-a',
        validUntil: '2026-07-28T12:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function caregiverRead(
  context: AuthorizationContext,
): EmergencyAccessAuthorizationRequest {
  return {
    context,
    target,
    view: 'CAREGIVER',
    facts: {
      caregiverShiftActive: true,
      caregiverInTargetFloor: true,
    },
    now,
  };
}

describe('M04 emergency authorization', () => {
  it('allows only the documented forward state commands', () => {
    expect(isEmergencyCommandAllowed('OPEN', 'ACKNOWLEDGE')).toBe(true);
    expect(isEmergencyCommandAllowed('ACKNOWLEDGED', 'EN_ROUTE')).toBe(true);
    expect(isEmergencyCommandAllowed('RESPONDING', 'ON_SITE')).toBe(true);
    expect(isEmergencyCommandAllowed('RESPONDING', 'RESOLVE')).toBe(true);
    expect(isEmergencyCommandAllowed('RESOLVED', 'REVIEW')).toBe(true);
    expect(isEmergencyCommandAllowed('OPEN', 'RESOLVE')).toBe(false);
    expect(isEmergencyCommandAllowed('REVIEWED', 'ASSIGN')).toBe(false);
  });

  it('rejects cross-tenant and expired-shift caregiver access', () => {
    expect(
      authorizeEmergencyAccess(
        caregiverRead(caregiverContext({ organizationId: 'org-b' })),
      ),
    ).toEqual({ allowed: false, reasonCode: 'SCOPE_MISSING' });

    const expired = caregiverContext({
      scopes: caregiverContext().scopes.map((scope) => ({
        ...scope,
        validUntil: '2026-07-28T04:59:59.999Z',
      })),
    });
    expect(authorizeEmergencyAccess(caregiverRead(expired))).toEqual({
      allowed: false,
      reasonCode: 'SCOPE_EXPIRED',
    });
  });

  it('limits emergency elevation to the matching event and expiry', () => {
    const base = caregiverContext({
      scopes: [caregiverContext().scopes[0]!],
      emergencyElevation: {
        emergencyId: 'emergency-a',
        reasonCode: 'SUPERVISOR_APPROVED',
        expiresAt: '2026-07-28T05:10:00.000Z',
      },
    });
    expect(
      authorizeEmergencyAccess({
        ...caregiverRead(base),
        facts: { caregiverShiftActive: true },
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeEmergencyAccess({
        ...caregiverRead({
          ...base,
          emergencyElevation: { ...base.emergencyElevation!, emergencyId: 'emergency-b' },
        }),
        facts: { caregiverShiftActive: true },
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
  });

  it.each(['SYSTEM', 'DEVICE', 'AGENT'] as const)(
    'prevents %s from resolving an emergency',
    (actorType) => {
      expect(
        authorizeEmergencyCommand({
          context: caregiverContext(),
          target,
          command: 'RESOLVE',
          status: 'RESPONDING',
          actorType,
          facts: {
            caregiverShiftActive: true,
            caregiverIsResponder: true,
          },
          now,
        }),
      ).toEqual({ allowed: false, reasonCode: 'RESOURCE_POLICY_MISSING' });
    },
  );

  it('requires active relationship, consent and shared field for family summaries', () => {
    const request: EmergencyAccessAuthorizationRequest = {
      context: {
        actorId: 'family-user',
        organizationId: 'org-a',
        roles: ['FAMILY'],
        permissions: [M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ],
        scopes: [
          {
            kind: 'LINKED_ELDER',
            scopeKey: 'family-link',
            organizationId: 'org-a',
            facilityId: 'facility-a',
            resourceId: 'elder-a',
          },
        ],
      },
      target,
      view: 'FAMILY_SUMMARY',
      facts: {
        familyRelationshipActive: true,
        familySharingConsentActive: true,
        timelineSummaryShared: true,
      },
      now,
    };

    expect(authorizeEmergencyAccess(request)).toEqual({
      allowed: true,
      reasonCode: 'ALLOWED',
    });
    expect(
      authorizeEmergencyAccess({
        ...request,
        facts: { ...request.facts, familySharingConsentWithdrawn: true },
      }),
    ).toEqual({ allowed: false, reasonCode: 'CONSENT_WITHDRAWN' });
    expect(
      authorizeEmergencyAccess({
        ...request,
        facts: { ...request.facts, timelineSummaryShared: false },
      }),
    ).toEqual({ allowed: false, reasonCode: 'FIELD_NOT_SHARED' });
  });
});
