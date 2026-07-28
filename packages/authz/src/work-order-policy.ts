import { M03_PERMISSIONS } from './permissions.js';
import { isScopeActive } from './scope-policy.js';
import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationTarget,
  DataScope,
} from './types.js';

export const WORK_ORDER_STATUSES = [
  'NEW',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED',
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_ACCESS_VIEWS = [
  'WORK_ORDER',
  'ELDER_REVIEW',
  'FAMILY_SUMMARY',
  'PRIVATE_AUDIO',
] as const;

export type WorkOrderAccessView = (typeof WORK_ORDER_ACCESS_VIEWS)[number];

export interface WorkOrderAccessFacts {
  readonly ownsRecord?: boolean;
  readonly familyRelationshipActive?: boolean;
  readonly familySharingConsentActive?: boolean;
  readonly familySharingConsentWithdrawn?: boolean;
  readonly familySummaryPublished?: boolean;
  readonly caregiverShiftActive?: boolean;
  readonly caregiverInTargetTeam?: boolean;
  readonly caregiverIsAssignee?: boolean;
  readonly serviceCompletionPresent?: boolean;
}

export interface WorkOrderAuthorizationRequest {
  readonly context: AuthorizationContext;
  readonly target: AuthorizationTarget & {
    readonly facilityId: string;
    readonly elderId: string;
    readonly workOrderId: string;
  };
  readonly view: WorkOrderAccessView;
  readonly facts: WorkOrderAccessFacts;
  readonly now?: Date;
}

export interface WorkOrderTransitionAuthorizationRequest
  extends Omit<WorkOrderAuthorizationRequest, 'view'> {
  readonly fromStatus: WorkOrderStatus;
  readonly toStatus: WorkOrderStatus;
}

export interface WorkOrderArrivalAuthorizationRequest
  extends Omit<WorkOrderAuthorizationRequest, 'view'> {
  readonly status: WorkOrderStatus;
}

const privilegedRoles = new Set([
  'PLATFORM_ADMIN',
  'ORG_ADMIN',
  'FACILITY_DIRECTOR',
  'NURSING_SUPERVISOR',
  'CLINICAL_STAFF',
]);

const transitions: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  NEW: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['VERIFIED'],
  VERIFIED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function allowedWorkOrderTransitions(status: WorkOrderStatus): readonly WorkOrderStatus[] {
  return transitions[status];
}

export function isWorkOrderTransitionAllowed(
  fromStatus: WorkOrderStatus,
  toStatus: WorkOrderStatus,
): boolean {
  return transitions[fromStatus].includes(toStatus);
}

export function authorizeWorkOrderAccess(
  request: WorkOrderAuthorizationRequest,
): AuthorizationDecision {
  const requiredPermissions = permissionsForView(request.view);
  if (requiredPermissions.some((permission) => !request.context.permissions.includes(permission))) {
    return { allowed: false, reasonCode: 'PERMISSION_MISSING' };
  }
  if (request.context.organizationId !== request.target.organizationId) {
    return { allowed: false, reasonCode: 'SCOPE_MISSING' };
  }

  const now = request.now ?? new Date();
  const activeScopes = request.context.scopes.filter((scope) => isScopeActive(scope, now));
  const hadExpiredScope = request.context.scopes.some(
    (scope) => scope.organizationId === request.target.organizationId && !isScopeActive(scope, now),
  );

  if (request.view === 'FAMILY_SUMMARY') {
    return authorizeFamilySummary(request, activeScopes, hadExpiredScope);
  }

  if (
    request.context.roles.some((role) => privilegedRoles.has(role)) &&
    hasBroadScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (
    request.context.roles.includes('ELDER') &&
    request.view !== 'PRIVATE_AUDIO' &&
    request.facts.ownsRecord === true &&
    request.target.ownerUserId === request.context.actorId &&
    hasOwnScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  if (request.context.roles.includes('CAREGIVER')) {
    return authorizeCaregiver(request, activeScopes, hadExpiredScope);
  }

  return {
    allowed: false,
    reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
  };
}

export function authorizeWorkOrderTransition(
  request: WorkOrderTransitionAuthorizationRequest,
): AuthorizationDecision {
  if (request.fromStatus === 'CLOSED' || request.fromStatus === 'CANCELLED') {
    return { allowed: false, reasonCode: 'STATE_TERMINAL' };
  }
  if (!isWorkOrderTransitionAllowed(request.fromStatus, request.toStatus)) {
    return { allowed: false, reasonCode: 'STATE_TRANSITION_INVALID' };
  }

  const permission = permissionForTransition(request.toStatus);
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

  if (request.context.roles.includes('CAREGIVER')) {
    const caregiverTargets = new Set<WorkOrderStatus>(['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']);
    if (!caregiverTargets.has(request.toStatus)) {
      return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
    }
    return authorizeCaregiver(
      { ...request, view: 'WORK_ORDER' },
      activeScopes,
      hasExpiredScope(request, now),
      true,
    );
  }

  if (
    request.context.roles.includes('ELDER') &&
    request.toStatus === 'VERIFIED' &&
    request.facts.serviceCompletionPresent === true &&
    request.facts.ownsRecord === true &&
    request.target.ownerUserId === request.context.actorId &&
    hasOwnScope(activeScopes, request.target)
  ) {
    return { allowed: true, reasonCode: 'ALLOWED' };
  }

  return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
}

/** Arrival is an audited versioned fact, not a work-order status. */
export function authorizeWorkOrderArrival(
  request: WorkOrderArrivalAuthorizationRequest,
): AuthorizationDecision {
  if (request.status !== 'ACCEPTED') {
    return { allowed: false, reasonCode: 'STATE_TRANSITION_INVALID' };
  }
  if (!request.context.permissions.includes(M03_PERMISSIONS.WORK_ORDER_TRANSITION)) {
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
  if (!request.context.roles.includes('CAREGIVER')) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  return authorizeCaregiver(
    { ...request, view: 'WORK_ORDER' },
    activeScopes,
    request.context.scopes.some(
      (scope) => scope.organizationId === request.target.organizationId && !isScopeActive(scope, now),
    ),
    true,
  );
}

function permissionsForView(view: WorkOrderAccessView): readonly string[] {
  if (view === 'ELDER_REVIEW') return [M03_PERMISSIONS.WORK_ORDER_VERIFY];
  if (view === 'FAMILY_SUMMARY') return [M03_PERMISSIONS.FAMILY_SUMMARY_READ];
  if (view === 'PRIVATE_AUDIO') {
    return [M03_PERMISSIONS.VOICE_SUBMISSION_READ, M03_PERMISSIONS.TRANSCRIPT_READ];
  }
  return [M03_PERMISSIONS.WORK_ORDER_READ];
}

function permissionForTransition(toStatus: WorkOrderStatus): string {
  if (toStatus === 'ASSIGNED') return M03_PERMISSIONS.WORK_ORDER_ASSIGN;
  if (toStatus === 'VERIFIED') return M03_PERMISSIONS.WORK_ORDER_VERIFY;
  if (toStatus === 'CLOSED') return M03_PERMISSIONS.WORK_ORDER_CLOSE;
  return M03_PERMISSIONS.WORK_ORDER_TRANSITION;
}

function authorizeFamilySummary(
  request: WorkOrderAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadExpiredScope: boolean,
): AuthorizationDecision {
  if (!request.context.roles.includes('FAMILY')) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  if (request.facts.familyRelationshipActive !== true) {
    return { allowed: false, reasonCode: 'RELATIONSHIP_INACTIVE' };
  }
  if (!hasLinkedElderScope(activeScopes, request.target)) {
    return {
      allowed: false,
      reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'RESOURCE_RELATIONSHIP_MISSING',
    };
  }
  if (request.facts.familySharingConsentWithdrawn === true) {
    return { allowed: false, reasonCode: 'CONSENT_WITHDRAWN' };
  }
  if (request.facts.familySharingConsentActive !== true) {
    return { allowed: false, reasonCode: 'CONSENT_MISSING' };
  }
  if (request.facts.familySummaryPublished !== true) {
    return { allowed: false, reasonCode: 'FIELD_NOT_SHARED' };
  }
  return { allowed: true, reasonCode: 'ALLOWED' };
}

function authorizeCaregiver(
  request: WorkOrderAuthorizationRequest,
  activeScopes: readonly DataScope[],
  hadExpiredScope: boolean,
  requireAssignee = false,
): AuthorizationDecision {
  if (request.facts.caregiverShiftActive !== true || !hasActiveShiftScope(activeScopes, request.target)) {
    return { allowed: false, reasonCode: hadExpiredScope ? 'SCOPE_EXPIRED' : 'SHIFT_INACTIVE' };
  }
  const eligible = requireAssignee
    ? request.facts.caregiverIsAssignee === true
    : request.facts.caregiverIsAssignee === true || request.facts.caregiverInTargetTeam === true;
  if (!eligible || !hasCaregiverResourceScope(activeScopes, request.target)) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  if (request.view === 'PRIVATE_AUDIO' && request.facts.caregiverIsAssignee !== true) {
    return { allowed: false, reasonCode: 'RESOURCE_RELATIONSHIP_MISSING' };
  }
  return { allowed: true, reasonCode: 'ALLOWED' };
}

function hasBroadScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'PLATFORM' ||
      (scope.kind === 'ORGANIZATION' && scope.organizationId === target.organizationId) ||
      (scope.kind === 'FACILITY' &&
        scope.organizationId === target.organizationId &&
        scope.facilityId === target.facilityId),
  );
}

function hasOwnScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'OWN_RECORD' &&
      scope.organizationId === target.organizationId &&
      (scope.facilityId === undefined || scope.facilityId === target.facilityId),
  );
}

function hasLinkedElderScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'LINKED_ELDER' &&
      scope.organizationId === target.organizationId &&
      scope.facilityId === target.facilityId &&
      scope.resourceType?.toUpperCase() === 'ELDER' &&
      scope.resourceId === target.elderId,
  );
}

function hasActiveShiftScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.kind === 'ACTIVE_SHIFT' &&
      scope.organizationId === target.organizationId &&
      scope.facilityId === target.facilityId,
  );
}

function hasCaregiverResourceScope(scopes: readonly DataScope[], target: AuthorizationTarget): boolean {
  return scopes.some(
    (scope) =>
      scope.organizationId === target.organizationId &&
      scope.facilityId === target.facilityId &&
      ((scope.kind === 'ASSIGNED_ELDER' && scope.resourceId === target.elderId) ||
        (scope.kind === 'CARE_TEAM' &&
          target.careTeamId !== undefined &&
          scope.resourceId === target.careTeamId)),
  );
}

function hasExpiredScope(request: WorkOrderTransitionAuthorizationRequest, now: Date): boolean {
  return request.context.scopes.some(
    (scope) => scope.organizationId === request.target.organizationId && !isScopeActive(scope, now),
  );
}
