import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { ServiceConfig } from '@eldercare/config';
import type { HealthResponse } from '@eldercare/contracts';
import type { Response } from 'express';
import { SERVICE_CONFIG } from '../tokens.js';
import { ReadinessService } from './readiness.service.js';
import { HealthResponseDto } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
    @Inject(SERVICE_CONFIG) private readonly config: ServiceConfig
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  @ApiOkResponse({ description: 'The API process is running.', type: HealthResponseDto })
  live(): HealthResponse {
    return this.response('ok');
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness' })
  @ApiOkResponse({ description: 'Required API dependencies are available.', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: 'One or more dependencies are unavailable.', type: HealthResponseDto })
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const checks = await this.readiness.check();
    const isReady = Object.values(checks).every((value) => value === 'ok');
    response.status(isReady ? 200 : 503);
    return this.response(isReady ? 'ok' : 'error', checks);
  }

  private response(status: HealthResponse['status'], checks?: HealthResponse['checks']): HealthResponse {
    return {
      service: 'api',
      status,
      version: this.config.appVersion,
      timestamp: new Date().toISOString(),
      ...(checks ? { checks } : {})
    };
  }
}
