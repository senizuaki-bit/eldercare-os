import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { M02Module } from '../m02/m02.module.js';
import { AdminNeedsController } from './admin-needs.controller.js';
import { AdminWorkOrdersController } from './admin-work-orders.controller.js';
import { AdminCurrentAccessService } from './admin-current-access.service.js';
import { M03ContextService } from './m03-context.service.js';
import { M03MutationService } from './m03-mutation.service.js';
import { NeedsService } from './needs.service.js';
import { ObjectStorageService } from './object-storage.service.js';
import {
  CaregiverWorkOrdersController,
  ElderServicesController,
  ElderVoiceController,
  FamilySummariesController,
} from './portal.controller.js';
import { SensitiveVoiceController } from './sensitive-voice.controller.js';
import { AdminTaskUpdatesController, CaregiverTaskUpdatesController } from './task-updates.controller.js';
import { TaskUpdatesService } from './task-updates.service.js';
import { VoiceWorkflowService } from './voice-workflow.service.js';
import { WorkOrdersService } from './work-orders.service.js';

@Module({
  imports: [AuthModule, M02Module],
  controllers: [
    AdminNeedsController,
    AdminWorkOrdersController,
    ElderVoiceController,
    CaregiverWorkOrdersController,
    ElderServicesController,
    FamilySummariesController,
    SensitiveVoiceController,
    CaregiverTaskUpdatesController,
    AdminTaskUpdatesController,
  ],
  providers: [
    AdminCurrentAccessService,
    M03ContextService,
    M03MutationService,
    NeedsService,
    ObjectStorageService,
    TaskUpdatesService,
    VoiceWorkflowService,
    WorkOrdersService,
  ],
})
export class M03Module {}
