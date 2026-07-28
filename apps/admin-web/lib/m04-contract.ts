import {
  emergencyAdminDetailSchema,
  emergencyAdminPageSchema,
  type EmergencyAdminDetail,
  type EmergencyAdminItem,
  type EmergencyAdminPage,
  type EmergencyLocationState,
  type EmergencyMilestoneKind,
  type EmergencySlaStage,
  type EmergencySourceKind,
  type EmergencyStatus
} from '@eldercare/contracts';

import { ContractValidationError } from './auth-contract';

type EmergencyLocationProjection = EmergencyAdminItem['location'];

export function parseEmergencyAdminPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): EmergencyAdminPage {
  const parsed = emergencyAdminPageSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.items.some(
      (item) =>
        item.organizationId !== organizationId ||
        item.facilityId !== facilityId
    )
  ) {
    throw new ContractValidationError('M04 emergency page');
  }

  return parsed.data;
}

export function parseEmergencyAdminDetail(
  value: unknown,
  organizationId: string,
  facilityId: string,
  emergencyId: string
): EmergencyAdminDetail {
  const parsed = emergencyAdminDetailSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.id !== emergencyId ||
    parsed.data.organizationId !== organizationId ||
    parsed.data.facilityId !== facilityId
  ) {
    throw new ContractValidationError('M04 emergency detail');
  }

  return parsed.data;
}

function scopeBase(organizationId: string, facilityId: string): string {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}`;
}

export const M04_API_PATHS = {
  emergencies: (organizationId: string, facilityId: string) =>
    `${scopeBase(organizationId, facilityId)}/emergencies`,
  emergency: (
    organizationId: string,
    facilityId: string,
    emergencyId: string
  ) =>
    `${scopeBase(organizationId, facilityId)}/emergencies/${encodeURIComponent(emergencyId)}`,
  responders: (
    organizationId: string,
    facilityId: string,
    emergencyId: string
  ) =>
    `${scopeBase(organizationId, facilityId)}/emergencies/${encodeURIComponent(emergencyId)}/responders`,
  resolve: (
    organizationId: string,
    facilityId: string,
    emergencyId: string
  ) =>
    `${scopeBase(organizationId, facilityId)}/emergencies/${encodeURIComponent(emergencyId)}/resolve`,
  review: (
    organizationId: string,
    facilityId: string,
    emergencyId: string
  ) =>
    `${scopeBase(organizationId, facilityId)}/emergencies/${encodeURIComponent(emergencyId)}/review`
} as const;

export type {
  EmergencyAdminDetail,
  EmergencyAdminItem,
  EmergencyAdminPage,
  EmergencyLocationProjection,
  EmergencyLocationState,
  EmergencyMilestoneKind,
  EmergencySlaStage,
  EmergencySourceKind,
  EmergencyStatus
};
