import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfGuard } from './auth/csrf.guard.js';
import { SessionGuard } from './auth/session.guard.js';
import { PermissionGuard } from './authorization/permission.guard.js';
import { correlationIdMiddleware } from './common/correlation-id.middleware.js';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';
import { IdentityModule } from './identity/identity.module.js';
import { M02Module } from './m02/m02.module.js';
import { M02ContextGuard } from './m02/m02-context.guard.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule, AuthModule, IdentityModule, M02Module],
  controllers: [HealthController],
  providers: [
    ReadinessService,
    PermissionGuard,
    M02ContextGuard,
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: M02ContextGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes('*');
  }
}
