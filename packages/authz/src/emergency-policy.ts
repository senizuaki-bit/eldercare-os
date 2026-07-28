import { M04_PERMISSIONS } from './permissions.js';
import { isScopeActive } from './scope-policy.js';
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationTarget,
  DataScope,
} from './types.js';

export const EMERGENCY_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESPONDING',
  'RESOLVED',
  'REVIEWED',
] as const;
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];

export const EMERGENCY_COMMANDS = [
  'ASSIGN',
  'ACKNOWLEDGE',
  'EN_ROUTE',
  'ON_SITE',
  'RESOLVE',
  'REVIEW',
  'ESCALATE',
] as const;
export type EmergencyCommand = (typeof EMERGENCY_COMMANDS)[number];

export const EMERGENCY_ACCESS_VIEWS = [
  'ADMIN',
  'CAREGIVER',
  'ELDER',
  'FAMILY_SUMMARY',
  'FAMILY_PREFERENCE',
] as const;
export type EmergencyAccessView = (typeof EMERGENCY_ACCESS_VIEWS)[number];

export interface EmergencyAccessFacts {
  readonly ownsElder?: boolean;
  readonly caregiverShiftActive?: boolean;
  readonly caregiverIsResponder?: boolean;
  readonly caregiverInTargetFloor?: boolean;
  readonly caregiverInTargetTeam?: boolean;
  readonly familyRelationshipActive?: boolean;
  readonly familySharingConsentActive?: boolean;
  readonly familySharingConsentWithdrawn?: boolean;
  readonly timelineSummaryShared?: boolean;
}

export interface EmergencyAuthorizationTarget extends AuthorizationTarget {
  readonly facilityId: string;
  readonly elderId: string;
  readonly emergencyId: string;
}

export interface EmergencyAccessAuthorizationRequest {
  readonly context: AuthorizationContext;
  readonly target: EmergencyAuthorizationTarget;
  readonly view: EmergencyAccessView;
  readonly facts: EmergencyAccessFacts;
  readonly now?: Date;
}

export interface EmergencyCommandAuthorizationRequest
  extends Omit<EmergencyAccessAuthorizationRequest, 'view'> {
  readonly command: EmergencyCommand;
  readonly status: EmergencyStatus;
  readonly actorType: 'USER' | 'SYSTEM' | 'DEVICE' | 'AGENT';
}

const privilegedRoles = new Set([
  'PLATFORM_ADMIN',
  'ORG_ADMIN',
  'FACILITY_DIRECTOR',
  'NURSING_SUPERVISOR',
  'CLINICAL_STAFF',
]);

const commandPermissions: Readonly<Record<EmergencyCommand, string>> = {
  ASSIGN: M04_PERMISSIONS.EMERGENCY_ASSIGN,
  ACKNOWLEDGE: M04_PERMISSIONS.EMERGENCY_ACKNOWLEDGE,
  EN_ROUTE: M04_PERMISSIONS.EMERGENCY_RESPOND,
  ON_SITE: M04_PERMISSIONS.EMERGENCY_RESPOND,
  RESOLVE: M04_PERMISSIONS.EMERGENCY_RESOLVE,
  REVIEW: M04_PERMISSIONS.EMERGENCY_REVIEW,
  ESCALATE: M04_PERMISSIONS.EMERGENCY_ESCALATE,
};

export function isEmergencyCommandAllowed(
  status: EmergencyStatus,
  command: EmergencyCommand,
): boolean {
  if (command === 'ASSIGN' || command === 'ESCALATE') {
    return status === 'OPEN' || status === 'ACKNOWLEDGED' || status === 'RESPONDING';
  }
  if (command === 'ACKNOWLEDGE') return status === 'OPEN';
  if (command === 'EN_ROUTE') return status === 'ACKNOWLEDGED';
  if (command === 'ON_SITE' || command === 'RESOLVE') return status === 'RESPONDING';
  return status === 'RESOLVED';
}

export function authorizeEmergencyAccess(
  request: EmergencyAccessAuthorizationRequest,
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
  const hadExpiredScope = request.context.scopes.some(
    (scope) =>
      scope.organizationId === request.target.organizationId &&
      !isScopeActive(scope, now),
  );

  if (request.view === 'FAMILY_SUMMARY' || request.view === 'FAMILY_PREFERENCE') {
    return authorizeFamily(request, activeScopes, hadExpiredScope);
  }

  if (
    request.context.roles.some((role) => privilegedRoles.has(role)) &&
    hasBroadScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    request.view === 'ELDER' &&
    request.context.roles.includes('ELDER') &&
    request.facts.ownsElder === true &&
    request.target.ownerUserId === request.context.actorId &&
    hasOwnScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (request.view === 'CAREGIVER' && request.context.roles.includes('CAREGIVER')) {
    return authorizeCaregiver(request, activeScopes, hadExpiredScope, now);
  }

  return {
    allowed: false,
    reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
  };
}

export function authorizeEmergencyCommand(
  request: EmergencyCommandAuthorizationRequest,
): AuthorizationDecision {
  if (request.status === 'REVIEWED') {
    return { allowed: false, reasonCode: 'STATE_TERMINAL' };
  }
  if (!isEmergencyCommandAllowed(request.status, request.command)) {
    return { allowed: false, reasonCode: 'STATE_TRANSITION_INVALID' };
  }
  if (
    (request.command === 'RESOLVE' || request.command === 'REVIEW') &&
    request.actorType !== 'USER'
  ) {
    return { allowed: false, reasonCode: 'RESOURCE_POLICY_MISSING' };
  }
  const permission = commandPermissions[request.command];
  if (!request.context.permissions.includes(permission)) {
    return { allowed: false, reasonCode: 'PERMISSION_MISSING' };
  }
  if (request.context.organizationId !== request.target.organizationId) {
    return { allowed: false, reasonCode: 'SCOPE_MISSING' };
  }

  const now = request.now ?? new Date();
  const activeScopes = request.context.scopes.filter((scope) => isScopeActive(scope, now));
  if (
    request.context.roles.some((role) => privilegedRoles.has(role)) &&
    hasBroadScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    request.context.roles.includes('CAREGIVER') &&
    ['ACKNOWLEDGE', 'EN_ROUTE', 'ON_SITE', 'RESOLVE'].includes(request.command)
  ) {
    return authorizeCaregiver(
      { ...request, view: 'CAREGIVER' },
      activeScopes,
      hasExpiredScope(request, now),
      now,
      true,
    );
  }

  return {
    allowed: false,
    reasonCode: hasExpiredScope(request, now)
      ? 'SCOPE_EXPIRED'
      : 'RESOURCE_RELATIONSHIP_MISSING',
  };
}

function permissionForView(view: EmergencyAccessView): string {
  if (view === 'FAMILY_SUMMARY') {
    return M04_PERMISSIONS.EMERGENCY_FAMILY_SUMMARY_READ;
  }
  if (view === 'FAMILY_PREFERENCE') {
    return M04_PERMISSIONS.EMERGENCY_NOTIFICATION_PREFERENCE_MANAGE;
  }
  if (view === 'ELDER') return M04_PERMISSIONS.EMERGENCY_SIGNAL_CREATE;
  return M04_PERMISSIONS.EMERGENCY_READ;
}

function authorizeFamily(
  request: EmergencyAccessAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadExpiredScope: boolean,
): AuthorizationDecision {
  if (!request.context.roles.includes('FAMILY')) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  if (request.facts.familyRelationshipActive !== true) {
    return { allowed: false, reasonCode: 'RELATIONSHIP_INACTIVE' };
  }
  if (request.facts.familySharingConsentWithdrawn === true) {
    return { allowed: false, reasonCode: 'CONSENT_WITHDRAWN' };
  }
  if (request.facts.familySharingConsentActive !== true) {
    return { allowed: false, reasonCode: 'CONSENT_MISSING' };
  }
  if (
    request.view === 'FAMILY_SUMMARY' &&
    request.facts.timelineSummaryShared !== true
  ) {
    return { allowed: false, reasonCode: 'FIELD_NOT_SHARED' };
  }
  if (
    activeScopes.some(
      (scope) =>
        scope.kind === 'LINKED_ELDER' &&
        scope.organizationId === request.target.organizationId &&
        scope.facilityId === request.target.facilityId &&
        scope.resourceId === request.target.elderId,
    )
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }
  return {
    allowed: false,
    reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
  };
}

function authorizeCaregiver(
  request: EmergencyAccessAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadExpiredScope: boolean,
  now: Date,
  requireResponder = false,
): AuthorizationDecision {
  if (request.facts.caregiverShiftActive !== true) {
    return {
      allowed: false,
      reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'SHIFT_INACTIVE',
    };
  }
  const activeShift = activeScopes.some(
    (scope) =>
      scope.kind === 'ACTIVE_SHIFT' &&
      scope.organizationId === request.target.organizationId &&
      scope.facilityId === request.target.facilityId,
  );
  if (!activeShift) {
    return {
      allowed: false,
      reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'SHIFT_INACTIVE',
    };
  }
  if (request.facts.caregiverIsResponder === true) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }
  if (!requireResponder && hasCaregiverRelationship(request, activeScopes)) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }
  const elevation = request.context.emergencyElevation;
  if (
    elevation !== undefined &&
    elevation.emergencyId === request.target.emergencyId &&
    Date.parse(elevation.expiresAt) > now.getTime()
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }
  return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
}

function hasCaregiverRelationship(
  request: EmergencyAccessAuthorizationRequest,
  activeScopes: readonly DataScope[],
): boolean {
  if (request.facts.caregiverInTargetFloor === true && request.target.floorId !== undefined) {
    return activeScopes.some(
      (scope) =>
        scope.kind === 'FLOOR' &&
        scope.organizationId === request.target.organizationId &&
        scope.facilityId === request.target.facilityId &&
        scope.resourceId === request.target.floorId,
    );
  }
  if (
    request.facts.caregiverInTargetTeam === true &&
    request.target.careTeamId !== undefined
  ) {
    return activeScopes.some(
      (scope) =>
        scope.kind === 'CARE_TEAM' &&
        scope.organizationId === request.target.organizationId &&
        scope.facilityId === request.target.facilityId &&
        scope.resourceId === request.target.careTeamId,
    );
  }
  return activeScopes.some(
    (scope) =>
      scope.kind === 'ASSIGNED_ELDER' &&
      scope.organizationId === request.target.organizationId &&
      scope.facilityId === request.target.facilityId &&
      scope.resourceId === request.target.elderId,
  );
}

function hasBroadScope(
  scopes: readonly DataScope[],
  target: EmergencyAuthorizationTarget,
): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'PLATFORM' ||
      (scope.organizationId === target.organizationId &&
        (scope.kind === 'ORGANIZATION' ||
          (scope.kind === 'FACILITY' && scope.facilityId === target.facilityId))),
  );
}

function hasOwnScope(
  scopes: readonly DataScope[],
  target: EmergencyAuthorizationTarget,
): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'OWN_RECORD' &&
      scope.organizationId === target.organizationId &&
      scope.facilityId === target.facilityId &&
      (scope.resourceId === undefined || scope.resourceId === target.elderId),
  );
}

function hasExpiredScope(
  request: Pick<EmergencyAccessAuthorizationRequest, 'context' | 'target'>,
  now: Date,
): boolean {
  return request.context.scopes.some(
    (scope) =>
      scope.organizationId === request.target.organizationId &&
      !isScopeActive(scope, now),
  );
}
