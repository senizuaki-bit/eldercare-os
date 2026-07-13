import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PageInfoDto } from '../identity/identity.dto.js';

export class AuditEventDto {
  @ApiProperty({ format: 'uuid', type: String })
  id!: string;

  @ApiProperty({ format: 'uuid', type: String })
  organizationId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  facilityId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  actorUserId!: string | null;

  @ApiProperty({ enum: ['USER', 'ANONYMOUS', 'SYSTEM'], type: String })
  actorType!: string;

  @ApiProperty({ example: 'IDENTITY.USERS_READ', type: String })
  action!: string;

  @ApiProperty({ enum: ['SUCCESS', 'DENIED', 'FAILURE'], type: String })
  outcome!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  resourceType!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resourceId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  reasonCode!: string | null;

  @ApiProperty({ type: String })
  correlationId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  safeMetadata!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time', type: String })
  occurredAt!: string;
}

export class AuditEventsPageDto {
  @ApiProperty({ type: [AuditEventDto] })
  items!: AuditEventDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo!: PageInfoDto;
}
