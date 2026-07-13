import type {
  AuthorizationDecision,
  AuthorizationRequest,
  DataScope,
  QueryScopeConstraint,
} from './types.js';

function parseOptionalTimestamp(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isScopeActive(scope: DataScope, now: Date = new Date()): boolean {
  const timestamp = now.getTime();
  const startsAt = parseOptionalTimestamp(scope.validFrom);
  const endsAt = parseOptionalTimestamp(scope.validUntil);

  if (
    Number.isNaN(timestamp) ||
    startsAt === null ||
    endsAt === null ||
    (startsAt !== undefined && endsAt !== undefined && endsAt <= startsAt)
  ) {
    return false;
  }

  return (startsAt === undefined || startsAt <= timestamp) &&
    (endsAt === undefined || timestamp < endsAt);
}

export function hasPermission(
  permissions: readonly string[],
  permission: string,
): boolean {
  return permissions.includes(permission);
}

export function authorizeScopedAccess(request: AuthorizationRequest): AuthorizationDecision {
  if (!hasPermission(request.context.permissions, request.permission)) {
    return { allowed: false, reasonCode: 'PERMISSION_MISSING' };
  }

  const now = request.now ?? new Date();
  const activeScopes = request.context.scopes.filter((scope) => isScopeActive(scope, now));
  const target = request.target;

  if (activeScopes.some((scope) => scope.kind === 'PLATFORM')) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    activeScopes.some(
      (scope) =>
        scope.kind === 'OWN_RECORD' &&
        scope.organizationId === target.organizationId &&
        target.ownerUserId === request.context.actorId,
    )
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  const organizationScopes = activeScopes.filter(
    (scope) => scope.organizationId === target.organizationId,
  );

  if (organizationScopes.some((scope) => scope.kind === 'ORGANIZATION')) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    target.facilityId !== undefined &&
    organizationScopes.some(
      (scope) => scope.kind === 'FACILITY' && scope.facilityId === target.facilityId,
    )
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  const hadExpiredScope = request.context.scopes.some(
    (scope) => scope.organizationId === target.organizationId && !isScopeActive(scope, now),
  );

  return {
    allowed: false,
    reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'SCOPE_MISSING',
  };
}

export function deriveQueryScope(
  scopes: readonly DataScope[],
  now: Date = new Date(),
): QueryScopeConstraint {
  const activeScopes = scopes.filter((scope) => isScopeActive(scope, now));
  const platformWide = activeScopes.some((scope) => scope.kind === 'PLATFORM');
  const organizationIds = new Set<string>();
  const facilityIds = new Set<string>();
  const floorIds = new Set<string>();
  const careTeamIds = new Set<string>();
  const assignedElderIds = new Set<string>();
  const linkedElderIds = new Set<string>();
  const activeShiftFacilityIds = new Set<string>();

  for (const scope of activeScopes) {
    if (scope.kind === 'ORGANIZATION') organizationIds.add(scope.organizationId);
    if (scope.kind === 'FACILITY' && scope.facilityId !== undefined) {
      facilityIds.add(scope.facilityId);
    }
    if (scope.kind === 'FLOOR' && scope.resourceId !== undefined) floorIds.add(scope.resourceId);
    if (scope.kind === 'CARE_TEAM' && scope.resourceId !== undefined) {
      careTeamIds.add(scope.resourceId);
    }
    if (scope.kind === 'ASSIGNED_ELDER' && scope.resourceId !== undefined) {
      assignedElderIds.add(scope.resourceId);
    }
    if (scope.kind === 'LINKED_ELDER' && scope.resourceId !== undefined) {
      linkedElderIds.add(scope.resourceId);
    }
    if (scope.kind === 'ACTIVE_SHIFT' && scope.facilityId !== undefined) {
      activeShiftFacilityIds.add(scope.facilityId);
    }
  }

  return {
    platformWide,
    organizationIds: [...organizationIds],
    facilityIds: [...facilityIds],
    floorIds: [...floorIds],
    careTeamIds: [...careTeamIds],
    assignedElderIds: [...assignedElderIds],
    linkedElderIds: [...linkedElderIds],
    activeShiftFacilityIds: [...activeShiftFacilityIds],
  };
}
