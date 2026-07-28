import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantContextService } from '../authorization/tenant-context.service.js';
import { FacilityDirectoryController } from './facility-directory.controller.js';
import { FacilityDirectoryService } from './facility-directory.service.js';
import { ElderAccessService } from './elder-access.service.js';
import { EldersController, PortalEldersController } from './elders.controller.js';
import { EldersService } from './elders.service.js';
import { M02ContextService } from './m02-context.js';
import { M02MutationService } from './m02-mutation.service.js';
import { StaffingController } from './staffing.controller.js';
import { StaffingService } from './staffing.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    FacilityDirectoryController,
    EldersController,
    PortalEldersController,
    StaffingController,
  ],
  providers: [
    TenantContextService,
    M02ContextService,
    M02MutationService,
    ElderAccessService,
    FacilityDirectoryService,
    EldersService,
    StaffingService,
  ],
  exports: [M02ContextService, ElderAccessService],
})
export class M02Module {}
