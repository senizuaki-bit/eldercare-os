import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginRequestDto {
  @ApiProperty({ example: 'director.demo', minLength: 3, maxLength: 96, type: String })
  loginName!: string;

  @ApiProperty({ example: 'Local-Demo-Only-2026!', minLength: 1, maxLength: 256, type: String })
  password!: string;
}

export class AuthenticatedUserDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ example: 'director.demo', type: String })
  username!: string;

  @ApiProperty({ example: '林岚（虚构）', type: String })
  displayName!: string;
}

export class SessionAccessContextDto {
  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiProperty({ example: '青岚颐养中心（虚构）', type: String })
  organizationName!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  facilityId!: string | null;

  @ApiPropertyOptional({ example: '青岚院区（虚构）', nullable: true, type: String })
  facilityName!: string | null;
}

export class SessionRoleDto {
  @ApiProperty({ example: 'FACILITY_DIRECTOR', type: String })
  key!: string;

  @ApiProperty({ example: '院区负责人', type: String })
  label!: string;
}

export class SessionContextDto {
  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;

  @ApiProperty({ type: SessionAccessContextDto })
  activeContext!: SessionAccessContextDto;

  @ApiProperty({ type: [SessionAccessContextDto] })
  availableContexts!: SessionAccessContextDto[];

  @ApiProperty({ type: [SessionRoleDto] })
  roles!: SessionRoleDto[];

  @ApiProperty({ example: ['identity.user.read'], type: [String] })
  permissions!: string[];

  @ApiProperty({ enum: ['admin', 'elder', 'caregiver', 'family'], type: String })
  portal!: 'admin' | 'caregiver' | 'elder' | 'family';

  @ApiProperty({ format: 'date-time', type: String })
  expiresAt!: string;
}

export class SwitchContextRequestDto {
  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  facilityId!: string | null;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true, type: Boolean })
  loggedOut!: true;
}
