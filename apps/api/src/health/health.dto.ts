import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'], example: 'ok', type: String })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ example: 'api', type: String })
  service!: string;

  @ApiProperty({ example: '0.0.1', type: String })
  version!: string;

  @ApiProperty({ example: '2026-07-11T12:00:00.000Z', format: 'date-time', type: String })
  timestamp!: string;

  @ApiPropertyOptional({
    additionalProperties: { type: 'string', enum: ['ok', 'error'] },
    example: { postgres: 'ok', redis: 'ok' },
    type: 'object'
  })
  checks?: Record<string, 'ok' | 'error'>;
}
