import {
  bedsPageSchema,
  buildingsPageSchema,
  elderDetailSchema,
  eldersPageSchema,
  floorsPageSchema,
  roomsPageSchema,
  shiftsPageSchema,
  staffPageSchema,
  type Bed,
  type Building,
  type ElderDetail,
  type ElderListItem,
  type Floor,
  type PageInfo,
  type Room,
  type Shift,
  type StaffProfile
} from '@eldercare/contracts';

import { ContractValidationError } from './auth-contract';

export interface ScopedPage<T> {
  items: T[];
  pageInfo: PageInfo;
}

interface ScopedRecord {
  organizationId: string;
  facilityId: string;
}

function parseScopedPage<T extends ScopedRecord>(
  value: unknown,
  contractName: string,
  schema: {
    safeParse: (input: unknown) =>
      | { success: true; data: { items: T[]; pageInfo: PageInfo } }
      | { success: false };
  },
  organizationId: string,
  facilityId: string
): ScopedPage<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ContractValidationError(contractName);
  }

  if (
    parsed.data.items.some(
      (item) => item.organizationId !== organizationId || item.facilityId !== facilityId
    )
  ) {
    throw new ContractValidationError(contractName);
  }

  return parsed.data;
}

export function parseEldersPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<ElderListItem> {
  return parseScopedPage(
    value,
    'elder directory',
    eldersPageSchema,
    organizationId,
    facilityId
  );
}

export function parseElderDetail(
  value: unknown,
  organizationId: string,
  facilityId: string
): ElderDetail {
  const parsed = elderDetailSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.organizationId !== organizationId ||
    parsed.data.facilityId !== facilityId
  ) {
    throw new ContractValidationError('elder detail');
  }

  return parsed.data;
}

export function parseBuildingsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<Building> {
  return parseScopedPage(
    value,
    'building directory',
    buildingsPageSchema,
    organizationId,
    facilityId
  );
}

export function parseFloorsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<Floor> {
  return parseScopedPage(
    value,
    'floor directory',
    floorsPageSchema,
    organizationId,
    facilityId
  );
}

export function parseRoomsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<Room> {
  return parseScopedPage(
    value,
    'room directory',
    roomsPageSchema,
    organizationId,
    facilityId
  );
}

export function parseBedsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<Bed> {
  return parseScopedPage(
    value,
    'bed directory',
    bedsPageSchema,
    organizationId,
    facilityId
  );
}

export function parseStaffPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<StaffProfile> {
  return parseScopedPage(
    value,
    'staff directory',
    staffPageSchema,
    organizationId,
    facilityId
  );
}

export function parseShiftsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<Shift> {
  const page = parseScopedPage(
    value,
    'shift directory',
    shiftsPageSchema,
    organizationId,
    facilityId
  );

  if (
    page.items.some((shift) =>
      shift.assignments.some(
        (assignment) =>
          assignment.organizationId !== organizationId ||
          assignment.facilityId !== facilityId ||
          assignment.shiftId !== shift.id
      )
    )
  ) {
    throw new ContractValidationError('shift directory');
  }

  return page;
}

export type {
  Bed,
  Building,
  ElderDetail,
  ElderListItem,
  Floor,
  Room,
  Shift,
  StaffProfile
};
