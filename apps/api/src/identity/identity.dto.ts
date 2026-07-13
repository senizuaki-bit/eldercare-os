import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PageInfoDto {
  @ApiProperty({ example: 1, type: Number })
  page!: number;

  @ApiProperty({ example: 20, type: Number })
  pageSize!: number;

  @ApiProperty({ example: 7, type: Number })
  total!: number;

  @ApiProperty({ example: 1, type: Number })
  totalPages!: number;
}

export class DataScopeDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ enum: ['PLATFORM', 'ORGANIZATION', 'FACILITY', 'FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'ACTIVE_SHIFT', 'LINKED_ELDER', 'OWN_RECORD'], type: String })
  kind!: string;

  @ApiProperty({ example: 'facility:20000000-0000-4000-8000-000000000001', type: String })
  scopeKey!: string;

  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  facilityId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resourceType!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resourceId!: string | null;

  @ApiProperty({ format: 'date-time', type: String })
  validFrom!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  validUntil!: string | null;
}

export class RoleSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ example: 'FACILITY_DIRECTOR', type: String })
  code!: string;

  @ApiProperty({ example: 'Facility director', type: String })
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: Boolean })
  isSystem!: boolean;

  @ApiProperty({ type: [String], example: ['identity.user.read'] })
  permissions!: string[];
}

export class RoleListItemDto extends RoleSummaryDto {
  @ApiProperty({ example: 2, type: Number })
  assignedUserCount!: number;

  @ApiProperty({ type: [String], example: ['FACILITY'] })
  scopeKinds!: string[];
}

export class UserRoleAssignmentDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiProperty({ type: RoleSummaryDto })
  role!: RoleSummaryDto;

  @ApiProperty({ type: [DataScopeDto] })
  scopes!: DataScopeDto[];

  @ApiProperty({ format: 'date-time', type: String })
  activeFrom!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  expiresAt!: string | null;
}

export class UserSummaryDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ example: 'facility.director', type: String })
  loginName!: string;

  @ApiProperty({ example: 'Demo facility director', type: String })
  displayName!: string;

  @ApiProperty({ enum: ['ACTIVE', 'LOCKED', 'DISABLED'], type: String })
  status!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  lastLoginAt!: string | null;

  @ApiProperty({ example: 1, type: Number })
  accessVersion!: number;

  @ApiProperty({ type: [UserRoleAssignmentDto] })
  assignments!: UserRoleAssignmentDto[];
}

export class UsersPageDto {
  @ApiProperty({ type: [UserSummaryDto] })
  items!: UserSummaryDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class RolesPageDto {
  @ApiProperty({ type: [RoleListItemDto] })
  items!: RoleListItemDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}

export class AccessScopeInputDto {
  @ApiProperty({ enum: ['FACILITY', 'ACTIVE_SHIFT', 'OWN_RECORD'], type: String })
  kind!: string;

  @ApiProperty({ type: String })
  scopeKey!: string;

  @ApiPropertyOptional({ format: 'uuid', type: String })
  facilityId?: string;

  @ApiPropertyOptional({ type: String })
  resourceType?: string;

  @ApiPropertyOptional({ type: String })
  resourceId?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  validFrom?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  validUntil?: string;
}

export class AccessAssignmentInputDto {
  @ApiProperty({ format: 'uuid', type: String })
  roleId!: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  activeFrom?: string;

  @ApiPropertyOptional({ format: 'date-time', type: String })
  expiresAt?: string;

  @ApiProperty({ type: [AccessScopeInputDto] })
  scopes!: AccessScopeInputDto[];
}

export class ReplaceUserAccessRequestDto {
  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  expectedAccessVersion!: number;

  @ApiProperty({ type: [AccessAssignmentInputDto] })
  assignments!: AccessAssignmentInputDto[];
}
