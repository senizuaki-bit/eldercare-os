import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { parseServiceConfig } from '@eldercare/config';
import { correlationIdMiddleware } from './common/correlation-id.middleware.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { SERVICE_CONFIG } from './tokens.js';

@Module({
  controllers: [HealthController],
  providers: [
    ReadinessService,
    {
      provide: SERVICE_CONFIG,
      useFactory: () => parseServiceConfig()
    }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes('*');
  }
}
