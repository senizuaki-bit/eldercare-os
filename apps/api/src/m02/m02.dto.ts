import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageInfoDto } from '../identity/identity.dto.js';

export class VersionedFacilityRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiProperty({ format: 'uuid', type: String })
  facilityId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  version!: number;

  @ApiProperty({ format: 'date-time', type: String })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', type: String })
  updatedAt!: string;
}

export class DirectoryRecordDto extends VersionedFacilityRecordDto {
  @ApiProperty({ example: 'B1', type: String })
  code!: string;

  @ApiProperty({ example: 'Main building', type: String })
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], type: String })
  status!: string;

  @ApiPropertyOptional({ type: Number })
  sortOrder?: number;
}

export class DirectoryPageDto {
  @ApiProperty({ type: [DirectoryRecordDto] })
  items!: DirectoryRecordDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class RoomDto extends VersionedFacilityRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  floorId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  zoneId!: string | null;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], type: String })
  status!: string;

  @ApiProperty({ description: 'All physical beds, including inactive beds.', minimum: 0, type: Number })
  bedCount!: number;

  @ApiProperty({ description: 'Beds whose operational status is ACTIVE.', minimum: 0, type: Number })
  activeBedCount!: number;

  @ApiProperty({ description: 'Active beds with an active elder stay.', minimum: 0, type: Number })
  occupiedBedCount!: number;

  @ApiProperty({ description: 'Active beds without an active elder stay.', minimum: 0, type: Number })
  availableBedCount!: number;
}

export class RoomsPageDto {
  @ApiProperty({ type: [RoomDto] })
  items!: RoomDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class BedDto extends VersionedFacilityRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  roomId!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ enum: ['ACTIVE', 'OUT_OF_SERVICE', 'ARCHIVED'], type: String })
  operationalStatus!: string;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  occupancy!: Record<string, unknown> | null;
}

export class BedsPageDto {
  @ApiProperty({ type: [BedDto] })
  items!: BedDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class ElderDto extends VersionedFacilityRecordDto {
  @ApiProperty({ type: String })
  recordNumber!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  preferredName!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'DISCHARGED', 'ARCHIVED'], type: String })
  status!: string;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  careLevel!: Record<string, unknown> | null;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  currentResidence!: Record<string, unknown> | null;
}

export class EldersPageDto {
  @ApiProperty({ type: [ElderDto] })
  items!: ElderDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class FamilyElderSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  preferredName?: string | null;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  currentResidence?: Record<string, unknown> | null;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  careLevel?: Record<string, unknown> | null;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  accessibilitySummary?: Record<string, unknown>;

  @ApiPropertyOptional({ additionalProperties: true, type: 'object' })
  communicationPreference?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  personalBaselineSummary?: string[];

  @ApiPropertyOptional({ type: [Object] })
  consentSummary?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: [Object] })
  timelineSummary?: Record<string, unknown>[];

  @ApiProperty({ type: [String] })
  sharedFields!: string[];
}

export class FamilyEldersPageDto {
  @ApiProperty({ type: [FamilyElderSummaryDto] })
  items!: FamilyElderSummaryDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class CaregiverElderSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  preferredName!: string | null;

  @ApiProperty({ additionalProperties: true, type: 'object' })
  currentResidence!: Record<string, unknown>;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  careLevel!: Record<string, unknown> | null;

  @ApiPropertyOptional({ additionalProperties: true, nullable: true, type: 'object' })
  accessibilitySummary!: Record<string, unknown> | null;

  @ApiProperty({ type: [String] })
  operationalAttention!: string[];

  @ApiProperty({ format: 'uuid', type: String })
  shiftAssignmentId!: string;
}

export class CaregiverEldersPageDto {
  @ApiProperty({ type: [CaregiverElderSummaryDto] })
  items!: CaregiverElderSummaryDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class ElderRelatedRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  elderId!: string;

  @ApiPropertyOptional({ minimum: 1, type: Number })
  version?: number;
}

export class ElderRelatedPageDto {
  @ApiProperty({ type: [ElderRelatedRecordDto] })
  items!: ElderRelatedRecordDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class StaffDto extends VersionedFacilityRecordDto {
  @ApiProperty({ format: 'uuid', type: String })
  userId!: string;

  @ApiProperty({ type: String })
  employeeCode!: string;

  @ApiProperty({ type: String })
  displayName!: string;

  @ApiProperty({ type: String })
  jobTitle!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], type: String })
  status!: string;
}

export class StaffPageDto {
  @ApiProperty({ type: [StaffDto] })
  items!: StaffDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class TeamDto extends DirectoryRecordDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ minimum: 0, type: Number })
  activeMemberCount!: number;
}

export class TeamsPageDto {
  @ApiProperty({ type: [TeamDto] })
  items!: TeamDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class ShiftDto extends VersionedFacilityRecordDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ format: 'date-time', type: String })
  startsAt!: string;

  @ApiProperty({ format: 'date-time', type: String })
  endsAt!: string;

  @ApiProperty({ enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], type: String })
  status!: string;

  @ApiProperty({ type: [ElderRelatedRecordDto] })
  assignments!: ElderRelatedRecordDto[];
}

export class ShiftsPageDto {
  @ApiProperty({ type: [ShiftDto] })
  items!: ShiftDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}
