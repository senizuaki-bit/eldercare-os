import type { Prisma } from '@eldercare/db';

import type { M03FacilityContext } from './m03-context.service.js';

const CAREGIVER_RESOURCE_SCOPE_KINDS = [
  'FLOOR',
  'CARE_TEAM',
  'ASSIGNED_ELDER',
  'ACTIVE_SHIFT',
] as const;

export interface CurrentCaregiverDataScope {
  readonly kind: string;
  readonly resourceId: string | null;
  readonly resourceType: string | null;
  readonly scopeKey: string;
}

export interface CurrentCaregiverScopeTarget {
  readonly elderId: string;
  readonly floorId: string;
  readonly shiftAssignmentId: string;
  readonly teamId: string;
}

/**
 * Filters a current caregiver role assignment. Resource authorization is
 * intentionally completed by caregiverRoleHasCurrentScopeAccess once the
 * exact shift, elder residence and target team are known.
 */
export function activeCaregiverRoleWhere(
  context: M03FacilityContext,
  userId: string,
  now: Date,
  requiredPermission: string,
): Prisma.UserRoleWhereInput {
  return {
    userId,
    organizationId: context.organizationId,
    user: { status: 'ACTIVE' },
    organization: { status: 'ACTIVE' },
    activeFrom: { lte: now },
    revokedAt: null,
    role: { code: 'CAREGIVER' },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        role: {
          rolePermissions: {
            some: { permission: { code: requiredPermission } },
          },
        },
      },
      {
        dataScopes: {
          some: activeCaregiverDataScopeWhere(context, now),
        },
      },
    ],
  };
}

/** Select only currently valid scopes for the active facility. */
export function activeCaregiverDataScopeWhere(
  context: M03FacilityContext,
  now: Date,
): Prisma.DataScopeWhereInput {
  return {
    organizationId: context.organizationId,
    facilityId: context.facilityId,
    facility: { is: { status: 'ACTIVE' } },
    kind: { in: [...CAREGIVER_RESOURCE_SCOPE_KINDS] },
    validFrom: { lte: now },
    AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: now } }] }],
  };
}

/**
 * Mirrors the caregiver resource-policy shape: one exact ACTIVE_SHIFT scope
 * and one exact elder/floor/team resource scope are both required.
 */
export function caregiverRoleHasCurrentScopeAccess(
  scopes: readonly CurrentCaregiverDataScope[] | null | undefined,
  target: CurrentCaregiverScopeTarget,
): boolean {
  const hasExactShift = scopes?.some((scope) =>
    scope.kind === 'ACTIVE_SHIFT' &&
    (
      scope.scopeKey === `active-shift:${target.shiftAssignmentId}` ||
      scope.scopeKey === `shift-assignment:${target.shiftAssignmentId}` ||
      (
        scope.resourceType?.toUpperCase() === 'SHIFT_ASSIGNMENT' &&
        scope.resourceId === target.shiftAssignmentId
      )
    )) ?? false;
  if (!hasExactShift) return false;

  return scopes?.some((scope) =>
    (scope.kind === 'ASSIGNED_ELDER' &&
      scope.resourceType?.toUpperCase() === 'ELDER' &&
      scope.resourceId === target.elderId) ||
    (scope.kind === 'FLOOR' &&
      scope.resourceType?.toUpperCase() === 'FLOOR' &&
      scope.resourceId === target.floorId) ||
    (scope.kind === 'CARE_TEAM' &&
      scope.resourceType?.toUpperCase() === 'CARE_TEAM' &&
      scope.resourceId === target.teamId)) ?? false;
}
