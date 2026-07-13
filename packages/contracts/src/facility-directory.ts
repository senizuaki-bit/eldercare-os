import { z } from 'zod';

import {
  displayTextSchema,
  isoTimestampSchema,
  pageInfoSchema,
  recordCodeSchema,
  sortDirectionSchema,
  uuidSchema,
  versionSchema,
} from './common.js';

export const directoryRecordStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
export const bedOperationalStatusSchema = z.enum(['ACTIVE', 'OUT_OF_SERVICE', 'ARCHIVED']);

const versionedFacilityShape = {
  id: uuidSchema,
  organizationId: uuidSchema,
  facilityId: uuidSchema,
  version: versionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
};

const baseDirectoryQueryShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(128).optional(),
  status: directoryRecordStatusSchema.optional(),
  direction: sortDirectionSchema.default('asc'),
};

export const buildingSchema = z
  .object({
    ...versionedFacilityShape,
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema,
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const buildingCreateRequestSchema = z
  .object({
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema.default('ACTIVE'),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const buildingUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    status: directoryRecordStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const buildingsQuerySchema = z
  .object({
    ...baseDirectoryQueryShape,
    sort: z.enum(['code', 'name', 'status', 'sortOrder', 'updatedAt']).default('sortOrder'),
  })
  .strict();

export const buildingsPageSchema = z
  .object({ items: z.array(buildingSchema), pageInfo: pageInfoSchema })
  .strict();

export const floorSchema = z
  .object({
    ...versionedFacilityShape,
    buildingId: uuidSchema,
    code: recordCodeSchema,
    name: displayTextSchema,
    levelNumber: z.number().int().min(-20).max(300),
    status: directoryRecordStatusSchema,
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const floorCreateRequestSchema = z
  .object({
    buildingId: uuidSchema,
    code: recordCodeSchema,
    name: displayTextSchema,
    levelNumber: z.number().int().min(-20).max(300),
    status: directoryRecordStatusSchema.default('ACTIVE'),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const floorUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    levelNumber: z.number().int().min(-20).max(300).optional(),
    status: directoryRecordStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const floorsQuerySchema = z
  .object({
    ...baseDirectoryQueryShape,
    buildingId: uuidSchema.optional(),
    sort: z.enum(['levelNumber', 'code', 'name', 'status', 'sortOrder']).default('sortOrder'),
  })
  .strict();

export const floorsPageSchema = z
  .object({ items: z.array(floorSchema), pageInfo: pageInfoSchema })
  .strict();

export const zoneSchema = z
  .object({
    ...versionedFacilityShape,
    floorId: uuidSchema,
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema,
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .strict();

export const zoneCreateRequestSchema = z
  .object({
    floorId: uuidSchema,
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema.default('ACTIVE'),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const zoneUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    status: directoryRecordStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const zonesQuerySchema = z
  .object({
    ...baseDirectoryQueryShape,
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    sort: z.enum(['code', 'name', 'status', 'sortOrder']).default('sortOrder'),
  })
  .strict();

export const zonesPageSchema = z
  .object({ items: z.array(zoneSchema), pageInfo: pageInfoSchema })
  .strict();

export const roomSchema = z
  .object({
    ...versionedFacilityShape,
    floorId: uuidSchema,
    zoneId: uuidSchema.nullable(),
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema,
    bedCount: z.number().int().min(0),
    activeBedCount: z.number().int().min(0),
    occupiedBedCount: z.number().int().min(0),
    availableBedCount: z.number().int().min(0),
  })
  .strict()
  .refine((room) => room.activeBedCount <= room.bedCount, {
    path: ['activeBedCount'],
    message: 'cannot exceed bedCount',
  })
  .refine((room) => room.occupiedBedCount <= room.activeBedCount, {
    path: ['occupiedBedCount'],
    message: 'cannot exceed activeBedCount',
  })
  .refine((room) => room.occupiedBedCount + room.availableBedCount === room.activeBedCount, {
    path: ['availableBedCount'],
    message: 'must equal activeBedCount minus occupiedBedCount',
  });

export const roomCreateRequestSchema = z
  .object({
    floorId: uuidSchema,
    zoneId: uuidSchema.optional(),
    code: recordCodeSchema,
    name: displayTextSchema,
    status: directoryRecordStatusSchema.default('ACTIVE'),
  })
  .strict();

export const roomUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    zoneId: uuidSchema.nullable().optional(),
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    status: directoryRecordStatusSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const roomsQuerySchema = z
  .object({
    ...baseDirectoryQueryShape,
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    zoneId: uuidSchema.optional(),
    occupancy: z.enum(['ANY', 'AVAILABLE', 'OCCUPIED', 'FULL']).default('ANY'),
    sort: z.enum(['code', 'name', 'status', 'bedCount', 'occupiedBedCount']).default('code'),
  })
  .strict();

export const roomsPageSchema = z
  .object({ items: z.array(roomSchema), pageInfo: pageInfoSchema })
  .strict();

export const bedOccupancySchema = z
  .object({
    elderId: uuidSchema,
    elderDisplayName: displayTextSchema,
    stayId: uuidSchema,
    admittedAt: isoTimestampSchema,
  })
  .strict();

export const bedSchema = z
  .object({
    ...versionedFacilityShape,
    roomId: uuidSchema,
    code: recordCodeSchema,
    label: displayTextSchema,
    operationalStatus: bedOperationalStatusSchema,
    occupancy: bedOccupancySchema.nullable(),
  })
  .strict();

export const bedCreateRequestSchema = z
  .object({
    roomId: uuidSchema,
    code: recordCodeSchema,
    label: displayTextSchema,
    operationalStatus: bedOperationalStatusSchema.default('ACTIVE'),
  })
  .strict();

export const bedUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    label: displayTextSchema.optional(),
    operationalStatus: bedOperationalStatusSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const bedsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    zoneId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    operationalStatus: bedOperationalStatusSchema.optional(),
    occupancy: z.enum(['ANY', 'AVAILABLE', 'OCCUPIED']).default('ANY'),
    sort: z.enum(['code', 'label', 'operationalStatus', 'updatedAt']).default('code'),
    direction: sortDirectionSchema.default('asc'),
  })
  .strict();

export const bedsPageSchema = z
  .object({ items: z.array(bedSchema), pageInfo: pageInfoSchema })
  .strict();

export const careLevelSchema = z
  .object({
    ...versionedFacilityShape,
    code: recordCodeSchema,
    name: displayTextSchema,
    rank: z.number().int().min(0).max(100),
    description: z.string().trim().max(1000).nullable(),
    status: directoryRecordStatusSchema,
  })
  .strict();

export const careLevelCreateRequestSchema = z
  .object({
    code: recordCodeSchema,
    name: displayTextSchema,
    rank: z.number().int().min(0).max(100),
    description: z.string().trim().max(1000).optional(),
    status: directoryRecordStatusSchema.default('ACTIVE'),
  })
  .strict();

export const careLevelUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    rank: z.number().int().min(0).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    status: directoryRecordStatusSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const careLevelsQuerySchema = z
  .object({
    ...baseDirectoryQueryShape,
    sort: z.enum(['rank', 'code', 'name', 'status']).default('rank'),
  })
  .strict();

export const careLevelsPageSchema = z
  .object({ items: z.array(careLevelSchema), pageInfo: pageInfoSchema })
  .strict();

export type DirectoryRecordStatus = z.infer<typeof directoryRecordStatusSchema>;
export type BedOperationalStatus = z.infer<typeof bedOperationalStatusSchema>;
export type Building = z.infer<typeof buildingSchema>;
export type BuildingCreateRequest = z.input<typeof buildingCreateRequestSchema>;
export type BuildingUpdateRequest = z.infer<typeof buildingUpdateRequestSchema>;
export type BuildingsQuery = z.output<typeof buildingsQuerySchema>;
export type BuildingsPage = z.infer<typeof buildingsPageSchema>;
export type Floor = z.infer<typeof floorSchema>;
export type FloorCreateRequest = z.input<typeof floorCreateRequestSchema>;
export type FloorUpdateRequest = z.infer<typeof floorUpdateRequestSchema>;
export type FloorsQuery = z.output<typeof floorsQuerySchema>;
export type FloorsPage = z.infer<typeof floorsPageSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type ZoneCreateRequest = z.input<typeof zoneCreateRequestSchema>;
export type ZoneUpdateRequest = z.infer<typeof zoneUpdateRequestSchema>;
export type ZonesQuery = z.output<typeof zonesQuerySchema>;
export type ZonesPage = z.infer<typeof zonesPageSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomCreateRequest = z.input<typeof roomCreateRequestSchema>;
export type RoomUpdateRequest = z.infer<typeof roomUpdateRequestSchema>;
export type RoomsQuery = z.output<typeof roomsQuerySchema>;
export type RoomsPage = z.infer<typeof roomsPageSchema>;
export type Bed = z.infer<typeof bedSchema>;
export type BedCreateRequest = z.input<typeof bedCreateRequestSchema>;
export type BedUpdateRequest = z.infer<typeof bedUpdateRequestSchema>;
export type BedsQuery = z.output<typeof bedsQuerySchema>;
export type BedsPage = z.infer<typeof bedsPageSchema>;
export type CareLevel = z.infer<typeof careLevelSchema>;
export type CareLevelCreateRequest = z.input<typeof careLevelCreateRequestSchema>;
export type CareLevelUpdateRequest = z.infer<typeof careLevelUpdateRequestSchema>;
export type CareLevelsQuery = z.output<typeof careLevelsQuerySchema>;
export type CareLevelsPage = z.infer<typeof careLevelsPageSchema>;
