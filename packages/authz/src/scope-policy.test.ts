import { describe, expect, it } from 'vitest';

import { M01_PERMISSIONS } from './permissions.js';
import { authorizeScopedAccess, deriveQueryScope } from './scope-policy.js';
import type { AuthorizationContext, DataScope } from './types.js';

const organizationScope: DataScope = {
  kind: 'ORGANIZATION',
  scopeKey: 'organization',
  organizationId: 'org-a',
};

const baseContext: AuthorizationContext = {
  actorId: 'user-1',
  organizationId: 'org-a',
  roles: ['FACILITY_DIRECTOR'],
  permissions: [M01_PERMISSIONS.USER_READ],
  scopes: [organizationScope],
};

describe('authorizeScopedAccess', () => {
  it('requires the explicit permission even when the scope matches', () => {
    expect(
      authorizeScopedAccess({
        context: { ...baseContext, permissions: [] },
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a' },
      }),
    ).toEqual({ allowed: false, reasonCode: 'PERMISSION_MISSING' });
  });

  it('allows organization scope but rejects another organization', () => {
    expect(
      authorizeScopedAccess({
        context: baseContext,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a' },
      }),
    ).toEqual({ allowed: true, reasonCode: 'ALLOWED' });
    expect(
      authorizeScopedAccess({
        context: baseContext,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-b' },
      }),
    ).toEqual({ allowed: false, reasonCode: 'SCOPE_MISSING' });
  });

  it('requires an exact facility match for facility scope', () => {
    const context = {
      ...baseContext,
      scopes: [
        {
          kind: 'FACILITY',
          scopeKey: 'facility:facility-a',
          organizationId: 'org-a',
          facilityId: 'facility-a',
        },
      ],
    } satisfies AuthorizationContext;

    expect(
      authorizeScopedAccess({
        context,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a', facilityId: 'facility-a' },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeScopedAccess({
        context,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a', facilityId: 'facility-b' },
      }).allowed,
    ).toBe(false);
  });

  it('lets only an explicit platform scope cross organizations', () => {
    const context = {
      ...baseContext,
      scopes: [{ kind: 'PLATFORM', scopeKey: 'platform', organizationId: 'platform-org' }],
    } satisfies AuthorizationContext;

    expect(
      authorizeScopedAccess({
        context,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-b' },
      }).allowed,
    ).toBe(true);
  });

  it('rejects expired scopes and supports own-record scope only for the actor', () => {
    const now = new Date('2026-07-12T10:00:00.000Z');
    expect(
      authorizeScopedAccess({
        context: {
          ...baseContext,
          scopes: [{ ...organizationScope, validUntil: '2026-07-12T09:59:59.000Z' }],
        },
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a' },
        now,
      }),
    ).toEqual({ allowed: false, reasonCode: 'SCOPE_EXPIRED' });

    const ownContext = {
      ...baseContext,
      scopes: [{ kind: 'OWN_RECORD', scopeKey: 'own-record', organizationId: 'org-a' }],
    } satisfies AuthorizationContext;
    expect(
      authorizeScopedAccess({
        context: ownContext,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a', ownerUserId: 'user-1' },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeScopedAccess({
        context: ownContext,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-a', ownerUserId: 'user-2' },
      }).allowed,
    ).toBe(false);
    expect(
      authorizeScopedAccess({
        context: ownContext,
        permission: M01_PERMISSIONS.USER_READ,
        target: { organizationId: 'org-b', ownerUserId: 'user-1' },
      }).allowed,
    ).toBe(false);
  });

  it('fails closed for malformed or inverted scope validity windows', () => {
    const now = new Date('2026-07-12T10:00:00.000Z');

    for (const scope of [
      { ...organizationScope, validFrom: 'not-a-timestamp' },
      { ...organizationScope, validUntil: 'not-a-timestamp' },
      {
        ...organizationScope,
        validFrom: '2026-07-12T10:00:00.000Z',
        validUntil: '2026-07-12T09:00:00.000Z',
      },
    ]) {
      expect(
        authorizeScopedAccess({
          context: { ...baseContext, scopes: [scope] },
          permission: M01_PERMISSIONS.USER_READ,
          target: { organizationId: 'org-a' },
          now,
        }),
      ).toEqual({ allowed: false, reasonCode: 'SCOPE_EXPIRED' });
    }
  });
});

describe('deriveQueryScope', () => {
  it('returns database-filterable organization and facility constraints', () => {
    expect(
      deriveQueryScope([
        organizationScope,
        {
          kind: 'FACILITY',
          scopeKey: 'facility:facility-a',
          organizationId: 'org-b',
          facilityId: 'facility-a',
        },
      ]),
    ).toEqual({
      platformWide: false,
      organizationIds: ['org-a'],
      facilityIds: ['facility-a'],
      floorIds: [],
      careTeamIds: [],
      assignedElderIds: [],
      linkedElderIds: [],
      activeShiftFacilityIds: [],
    });
  });

  it('does not widen a facility scope into organization-wide query access', () => {
    expect(
      deriveQueryScope([
        {
          kind: 'FACILITY',
          scopeKey: 'facility:facility-a',
          organizationId: 'org-a',
          facilityId: 'facility-a',
        },
      ]),
    ).toEqual({
      platformWide: false,
      organizationIds: [],
      facilityIds: ['facility-a'],
      floorIds: [],
      careTeamIds: [],
      assignedElderIds: [],
      linkedElderIds: [],
      activeShiftFacilityIds: [],
    });
  });

  it('derives narrow elder, floor, care-team and active-shift constraints without widening them', () => {
    expect(
      deriveQueryScope([
        {
          kind: 'ACTIVE_SHIFT',
          scopeKey: 'active-shift:shift-1',
          organizationId: 'org-a',
          facilityId: 'facility-a',
          validFrom: '2026-07-12T08:00:00.000Z',
          validUntil: '2026-07-12T20:00:00.000Z',
        },
        {
          kind: 'FLOOR',
          scopeKey: 'floor:floor-1',
          organizationId: 'org-a',
          facilityId: 'facility-a',
          resourceType: 'FLOOR',
          resourceId: 'floor-1',
        },
        {
          kind: 'CARE_TEAM',
          scopeKey: 'care-team:team-1',
          organizationId: 'org-a',
          facilityId: 'facility-a',
          resourceType: 'CARE_TEAM',
          resourceId: 'team-1',
        },
        {
          kind: 'ASSIGNED_ELDER',
          scopeKey: 'assigned-elder:elder-1',
          organizationId: 'org-a',
          facilityId: 'facility-a',
          resourceType: 'ELDER',
          resourceId: 'elder-1',
        },
        {
          kind: 'LINKED_ELDER',
          scopeKey: 'linked-elder:elder-2',
          organizationId: 'org-a',
          facilityId: 'facility-a',
          resourceType: 'ELDER',
          resourceId: 'elder-2',
        },
      ], new Date('2026-07-12T10:00:00.000Z')),
    ).toEqual({
      platformWide: false,
      organizationIds: [],
      facilityIds: [],
      floorIds: ['floor-1'],
      careTeamIds: ['team-1'],
      assignedElderIds: ['elder-1'],
      linkedElderIds: ['elder-2'],
      activeShiftFacilityIds: ['facility-a'],
    });
  });
});
