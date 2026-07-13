import { M02_PERMISSIONS } from './permissions.js';
import { isScopeActive } from './scope-policy.js';
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationTarget,
  DataScope,
} from './types.js';

export const ELDER_ACCESS_VIEWS = [
  'BASIC',
  'SENSITIVE',
  'TIMELINE',
  'FAMILY_SUMMARY',
  'CAREGIVER_SUMMARY',
] as const;

export type ElderAccessView = (typeof ELDER_ACCESS_VIEWS)[number];

export interface ElderAccessFacts {
  readonly ownsRecord?: boolean;
  readonly familyRelationshipActive?: boolean;
  readonly familySharingConsentActive?: boolean;
  readonly familySharingConsentWithdrawn?: boolean;
  readonly caregiverAssigned?: boolean;
  readonly caregiverShiftActive?: boolean;
}

export interface ElderAuthorizationRequest {
  readonly context: AuthorizationContext;
  readonly target: AuthorizationTarget & {
    readonly facilityId: string;
    readonly elderId: string;
  };
  readonly view: ElderAccessView;
  readonly facts: ElderAccessFacts;
  readonly now?: Date;
}

const privilegedRoles = new Set([
  'PLATFORM_ADMIN',
  'ORG_ADMIN',
  'FACILITY_DIRECTOR',
  'NURSING_SUPERVISOR',
  'CLINICAL_STAFF',
]);

export function authorizeElderAccess(
  request: ElderAuthorizationRequest,
): AuthorizationDecision {
  const permission = permissionForView(request.view);
  if (!request.context.permissions.includes(permission)) {
    return { allowed: false, reasonCode: 'PERMISSION_MISSING' };
  }

  if (request.context.organizationId !== request.target.organizationId) {
    return { allowed: false, reasonCode: 'SCOPE_MISSING' };
  }

  const now = request.now ?? new Date();
  const activeScopes = request.context.scopes.filter((scope) => isScopeActive(scope, now));
  const hadRelevantExpiredScope = request.context.scopes.some(
    (scope) => scope.organizationId === request.target.organizationId && !isScopeActive(scope, now),
  );

  if (request.view === 'FAMILY_SUMMARY') {
    if (!request.context.roles.includes('FAMILY')) {
      return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
    }
    return authorizeFamilySummary(request, activeScopes, hadRelevantExpiredScope);
  }
  if (request.view === 'CAREGIVER_SUMMARY') {
    if (!request.context.roles.includes('CAREGIVER')) {
      return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
    }
    return authorizeCaregiverSummary(request, activeScopes, hadRelevantExpiredScope);
  }

  if (
    request.context.roles.some((role) => privilegedRoles.has(role)) &&
    hasBroadScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    request.facts.ownsRecord === true &&
    request.target.ownerUserId === request.context.actorId &&
    hasScope(activeScopes, 'OWN_RECORD', request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (request.context.roles.includes('FAMILY')) {
    if (request.view !== 'BASIC') {
      return { allowed: false, reasonCode: 'FIELD_NOT_SHARED' };
    }
    return authorizeFamilySummary(request, activeScopes, hadRelevantExpiredScope);
  }
  if (request.context.roles.includes('CAREGIVER')) {
    if (request.view !== 'BASIC') {
      return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
    }
    return authorizeCaregiverSummary(request, activeScopes, hadRelevantExpiredScope);
  }

  return {
    allowed: false,
    reasonCode: hadRelevantExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
  };
}

function authorizeFamilySummary(
  request: ElderAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadRelevantExpiredScope: boolean,
): AuthorizationDecision {
  if (request.facts.familyRelationshipActive !== true) {
    return { allowed: false, reasonCode: 'RELATIONSHIP_INACTIVE' };
  }
  if (
    !hasResourceScope(activeScopes, 'LINKED_ELDER', request.target, request.target.elderId)
  ) {
    return {
      allowed: false,
      reasonCode: hadRelevantExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
    };
  }
  if (request.facts.familySharingConsentWithdrawn === true) {
    return { allowed: false, reasonCode: 'CONSENT_WITHDRAWN' };
  }
  if (request.facts.familySharingConsentActive !== true) {
    return { allowed: false, reasonCode: 'CONSENT_MISSING' };
  }
  return { allowed: true, reasonCode: 'ALLOWED' };
}

function authorizeCaregiverSummary(
  request: ElderAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadRelevantExpiredScope: boolean,
): AuthorizationDecision {
  if (request.facts.caregiverShiftActive !== true) {
    return { allowed: false, reasonCode: 'SHIFT_INACTIVE' };
  }
  if (!hasScope(activeScopes, 'ACTIVE_SHIFT', request.target)) {
    return {
      allowed: false,
      reasonCode: hadRelevantExpiredScope ? 'SCOPE_EXPIRED' : 'SHIFT_INACTIVE',
    };
  }
  const scopedToResource =
    hasResourceScope(activeScopes, 'ASSIGNED_ELDER', request.target, request.target.elderId) ||
    (request.target.floorId !== undefined &&
      hasResourceScope(activeScopes, 'FLOOR', request.target, request.target.floorId)) ||
    (request.target.careTeamId !== undefined &&
      hasResourceScope(activeScopes, 'CARE_TEAM', request.target, request.target.careTeamId));
  if (request.facts.caregiverAssigned !== true || !scopedToResource) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  return { allowed: true, reasonCode: 'ALLOWED' };
}

function permissionForView(view: ElderAccessView): string {
  if (view === 'SENSITIVE') return M02_PERMISSIONS.ELDER_READ_SENSITIVE;
  if (view === 'TIMELINE') return M02_PERMISSIONS.ELDER_TIMELINE_READ;
  return M02_PERMISSIONS.ELDER_READ_BASIC;
}

function hasBroadScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'PLATFORM' ||
      (scope.organizationId === target.organizationId && scope.kind === 'ORGANIZATION') ||
      (scope.organizationId === target.organizationId &&
        scope.kind === 'FACILITY' &&
        scope.facilityId === target.facilityId),
  );
}

function hasScope(
  scopes: readonly DataScope[],
  kind: DataScope['kind'],
  target: AuthorizationTarget,
): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === kind &&
      scope.organizationId === target.organizationId &&
      (scope.facilityId === undefined || scope.facilityId === target.facilityId),
  );
}

function hasResourceScope(
  scopes: readonly DataScope[],
  kind: DataScope['kind'],
  target: AuthorizationTarget,
  resourceId: string,
): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === kind &&
      scope.organizationId === target.organizationId &&
      scope.facilityId === target.facilityId &&
      scope.resourceType?.toUpperCase() === resourceTypeForKind(kind) &&
      scope.resourceId === resourceId,
  );
}

function resourceTypeForKind(kind: DataScope['kind']): string {
  if (kind === 'FLOOR') return 'FLOOR';
  if (kind === 'CARE_TEAM') return 'CARE_TEAM';
  return 'ELDER';
}
