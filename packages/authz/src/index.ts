/** Foundational authorization vocabulary only. Policies are introduced in M01. */
export type Role =
  | 'PLATFORM_ADMIN'
  | 'ORG_ADMIN'
  | 'FACILITY_DIRECTOR'
  | 'NURSING_SUPERVISOR'
  | 'CAREGIVER'
  | 'CLINICAL_STAFF'
  | 'DEVICE_MANAGER'
  | 'CONTENT_EDITOR'
  | 'ACTIVITY_COORDINATOR'
  | 'SERVICE_OPERATOR'
  | 'PROVIDER_STAFF'
  | 'FINANCE_VIEWER'
  | 'ELDER'
  | 'FAMILY';

export type Permission = string;

export type DataScopeKind =
  | 'organization'
  | 'facility'
  | 'floor'
  | 'care_team'
  | 'assigned_elder'
  | 'active_shift'
  | 'linked_elder'
  | 'own_record';

export interface DataScope {
  readonly kind: DataScopeKind;
  readonly resourceIds: readonly string[];
}

export interface EmergencyElevation {
  readonly emergencyId: string;
  readonly reasonCode: string;
  readonly expiresAt: string;
}

export interface AuthorizationContext {
  readonly actorId: string;
  readonly organizationId: string;
  readonly facilityIds: readonly string[];
  readonly roles: readonly Role[];
  readonly permissions: readonly Permission[];
  readonly scopes: readonly DataScope[];
  readonly emergencyElevation?: EmergencyElevation;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
}
