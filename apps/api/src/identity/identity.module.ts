import { Module } from '@nestjs/common';
import { AuditController } from '../audit/audit.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { TenantContextService } from '../authorization/tenant-context.service.js';
import { IdentityController } from './identity.controller.js';
import { IdentityService } from './identity.service.js';

@Module({
  imports: [AuthModule],
  controllers: [IdentityController, AuditController],
  providers: [IdentityService, TenantContextService],
  exports: [TenantContextService],
})
export class IdentityModule {}
