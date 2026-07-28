import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { M02Module } from '../m02/m02.module.js';
import { AdminEmergenciesController } from './admin-emergencies.controller.js';
import { EmergenciesService } from './emergencies.service.js';
import { M04ContextService } from './m04-context.service.js';
import { M04MutationService } from './m04-mutation.service.js';
import {
  CaregiverEmergenciesController,
  ElderEmergenciesController,
  FamilyEmergenciesController,
} from './portal-emergencies.controller.js';

@Module({
  imports: [AuthModule, M02Module],
  controllers: [
    AdminEmergenciesController,
    ElderEmergenciesController,
    CaregiverEmergenciesController,
    FamilyEmergenciesController,
  ],
  providers: [EmergenciesService, M04ContextService, M04MutationService],
  exports: [EmergenciesService],
})
export class M04Module {}
