import type { Permission } from './permissions.js';
import type { Role } from './roles.js';

export const DATA_SCOPE_KINDS = [
  'PLATFORM',
  'ORGANIZATION',
  'FACILITY',
  'FLOOR',
  'CARE_TEAM',
  'ASSIGNED_ELDER',
  'ACTIVE_SHIFT',
  'LINKED_ELDER',
  'OWN_RECORD',
] as const;

export type DataScopeKind = (typeof DATA_SCOPE_KINDS)[number];

export interface DataScope {
  readonly id?: string;
  readonly kind: DataScopeKind;
  readonly scopeKey: string;
  readonly organizationId: string;
  readonly facilityId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
}

export interface EmergencyElevation {
  readonly emergencyId: string;
  readonly reasonCode: string;
  readonly expiresAt: string;
}

export interface AuthorizationContext {
  readonly actorId: string;
  readonly organizationId: string;
  readonly roles: readonly Role[];
  readonly permissions: readonly Permission[];
  readonly scopes: readonly DataScope[];
  readonly emergencyElevation?: EmergencyElevation;
}

export type AuthorizationReasonCode =
  | 'ALLOWED'
  | 'AUTHENTICATION_REQUIRED'
  | 'PERMISSION_MISSING'
  | 'SCOPE_MISSING'
  | 'SCOPE_EXPIRED'
  | 'RESOURCE_RELATIONSHIP_MISSING'
  | 'RESOURCE_POLICY_MISSING'
  | 'RELATIONSHIP_INACTIVE'
  | 'SHIFT_INACTIVE'
  | 'CONSENT_MISSING'
  | 'CONSENT_WITHDRAWN'
  | 'FIELD_NOT_SHARED'
  | 'STATE_TRANSITION_INVALID'
  | 'STATE_TERMINAL';

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonCode: AuthorizationReasonCode;
}

export interface AuthorizationTarget {
  readonly organizationId: string;
  readonly facilityId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly ownerUserId?: string;
  readonly elderId?: string;
  readonly floorId?: string;
  readonly careTeamId?: string;
}

export interface AuthorizationRequest {
  readonly context: AuthorizationContext;
  readonly permission: Permission;
  readonly target: AuthorizationTarget;
  readonly now?: Date;
}

export interface QueryScopeConstraint {
  readonly platformWide: boolean;
  /** Organizations covered by an explicit ORGANIZATION scope. */
  readonly organizationIds: readonly string[];
  /** Facilities covered by an explicit FACILITY scope; these do not imply organization-wide access. */
  readonly facilityIds: readonly string[];
  readonly floorIds: readonly string[];
  readonly careTeamIds: readonly string[];
  readonly assignedElderIds: readonly string[];
  readonly linkedElderIds: readonly string[];
  readonly activeShiftFacilityIds: readonly string[];
}
