import { describe, expect, it } from 'vitest';

import { authorizeElderAccess } from './elder-policy.js';
import { M02_PERMISSIONS } from './permissions.js';
import type { AuthorizationContext, DataScope } from './types.js';

const now = new Date('2026-07-13T10:00:00.000Z');
const target = {
  organizationId: 'org-a',
  facilityId: 'facility-a',
  elderId: 'elder-a',
  resourceType: 'ELDER',
  resourceId: 'elder-a',
  ownerUserId: 'elder-user',
  floorId: 'floor-a',
  careTeamId: 'team-a',
};

function scope(
  kind: DataScope['kind'],
  overrides: Partial<DataScope> = {},
): DataScope {
  return {
    kind,
    scopeKey: `${kind.toLowerCase()}:scope`,
    organizationId: 'org-a',
    facilityId: ['PLATFORM', 'ORGANIZATION', 'OWN_RECORD'].includes(kind)
      ? undefined
      : 'facility-a',
    ...overrides,
  };
}

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    actorId: 'director-user',
    organizationId: 'org-a',
    roles: ['FACILITY_DIRECTOR'],
    permissions: [
      M02_PERMISSIONS.ELDER_READ_BASIC,
      M02_PERMISSIONS.ELDER_READ_SENSITIVE,
      M02_PERMISSIONS.ELDER_TIMELINE_READ,
    ],
    scopes: [scope('FACILITY')],
    ...overrides,
  };
}

describe('authorizeElderAccess', () => {
  it('allows a privileged facility operator but still requires each view permission', () => {
    expect(
      authorizeElderAccess({ context: context(), target, view: 'SENSITIVE', facts: {}, now }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeElderAccess({
        context: context({ permissions: [M02_PERMISSIONS.ELDER_READ_BASIC] }),
        target,
        view: 'SENSITIVE',
        facts: {},
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'PERMISSION_MISSING' });
  });

  it('never treats a caregiver facility scope as facility-wide elder access', () => {
    expect(
      authorizeElderAccess({
        context: context({
          actorId: 'caregiver-user',
          roles: ['CAREGIVER'],
          permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
          scopes: [scope('FACILITY')],
        }),
        target,
        view: 'BASIC',
        facts: { caregiverAssigned: true, caregiverShiftActive: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'SHIFT_INACTIVE' });
  });

  it('allows a caregiver only with an actual active shift and matching elder, floor or team scope', () => {
    const caregiver = context({
      actorId: 'caregiver-user',
      roles: ['CAREGIVER'],
      permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
      scopes: [
        scope('ACTIVE_SHIFT', {
          validFrom: '2026-07-13T08:00:00.000Z',
          validUntil: '2026-07-13T20:00:00.000Z',
        }),
        scope('FLOOR', { resourceType: 'FLOOR', resourceId: 'floor-a' }),
      ],
    });
    expect(
      authorizeElderAccess({
        context: caregiver,
        target,
        view: 'CAREGIVER_SUMMARY',
        facts: { caregiverAssigned: true, caregiverShiftActive: true },
        now,
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeElderAccess({
        context: caregiver,
        target: { ...target, floorId: 'floor-b', careTeamId: 'team-b' },
        view: 'CAREGIVER_SUMMARY',
        facts: { caregiverAssigned: true, caregiverShiftActive: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
  });

  it('denies immediately when a real caregiver shift is ended even if scopes have not expired', () => {
    expect(
      authorizeElderAccess({
        context: context({
          actorId: 'caregiver-user',
          roles: ['CAREGIVER'],
          permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
          scopes: [
            scope('ACTIVE_SHIFT', { validUntil: '2026-07-13T20:00:00.000Z' }),
            scope('ASSIGNED_ELDER', { resourceType: 'ELDER', resourceId: 'elder-a' }),
          ],
        }),
        target,
        view: 'CAREGIVER_SUMMARY',
        facts: { caregiverAssigned: true, caregiverShiftActive: false },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'SHIFT_INACTIVE' });
  });

  it('requires an active family relationship, a linked-elder scope and active family-sharing consent', () => {
    const family = context({
      actorId: 'family-user',
      roles: ['FAMILY'],
      permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
      scopes: [scope('LINKED_ELDER', { resourceType: 'ELDER', resourceId: 'elder-a' })],
    });
    expect(
      authorizeElderAccess({
        context: family,
        target,
        view: 'FAMILY_SUMMARY',
        facts: { familyRelationshipActive: true, familySharingConsentActive: true },
        now,
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeElderAccess({
        context: family,
        target,
        view: 'FAMILY_SUMMARY',
        facts: { familyRelationshipActive: false, familySharingConsentActive: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'RELATIONSHIP_INACTIVE' });
    expect(
      authorizeElderAccess({
        context: family,
        target,
        view: 'FAMILY_SUMMARY',
        facts: {
          familyRelationshipActive: true,
          familySharingConsentActive: false,
          familySharingConsentWithdrawn: true,
        },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'CONSENT_WITHDRAWN' });

    expect(
      authorizeElderAccess({
        context: { ...family, permissions: [M02_PERMISSIONS.ELDER_READ_SENSITIVE] },
        target,
        view: 'SENSITIVE',
        facts: { familyRelationshipActive: true, familySharingConsentActive: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'FIELD_NOT_SHARED' });
  });

  it('allows an elder only through an exact own-record relationship and scope', () => {
    expect(
      authorizeElderAccess({
        context: context({
          actorId: 'elder-user',
          roles: ['ELDER'],
          permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
          scopes: [scope('OWN_RECORD')],
        }),
        target,
        view: 'BASIC',
        facts: { ownsRecord: true },
        now,
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeElderAccess({
        context: context({
          actorId: 'other-elder-user',
          roles: ['ELDER'],
          permissions: [M02_PERMISSIONS.ELDER_READ_BASIC],
          scopes: [scope('OWN_RECORD')],
        }),
        target,
        view: 'BASIC',
        facts: { ownsRecord: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' });
  });

  it('fails closed across organizations before evaluating resource relationships', () => {
    expect(
      authorizeElderAccess({
        context: context({ organizationId: 'org-b' }),
        target,
        view: 'BASIC',
        facts: { ownsRecord: true },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'SCOPE_MISSING' });
  });
});
