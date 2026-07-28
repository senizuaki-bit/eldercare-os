import { Controller, Inject, Param, Req, Sse, type MessageEvent } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M03_PERMISSIONS } from '@eldercare/authz';
import { taskUpdateEventSchema } from '@eldercare/contracts';
import { map, takeUntil, timer, type Observable } from 'rxjs';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { M02ContextRoute } from '../m02/m02-context.guard.js';
import { M02ContextService } from '../m02/m02-context.js';
import { AdminCurrentAccessService } from './admin-current-access.service.js';
import { M03ContextService } from './m03-context.service.js';
import { M03SseOperation } from './m03-openapi.js';
import { TaskUpdatesService } from './task-updates.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const REAUTH_INTERVAL_MS = 60_000;

@ApiTags('M03 task updates')
@ApiCookieAuth('sessionCookie')
@Controller('caregiver/task-updates')
export class CaregiverTaskUpdatesController {
  constructor(
    @Inject(TaskUpdatesService) private readonly updates: TaskUpdatesService,
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(M03ContextService) private readonly context: M03ContextService,
  ) {}

  @Sse()
  @M03SseOperation(
    M03_PERMISSIONS.WORK_ORDER_READ,
    'Stream active-shift caregiver task updates',
    taskUpdateEventSchema,
  )
  async stream(@CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest): Promise<Observable<MessageEvent>> {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.updates.forCaregiver(
      context.organizationId,
      context.facilityId,
      (scope) => this.workOrders.canReceiveCaregiverTaskUpdate(context, session, scope),
    ).pipe(
      takeUntil(timer(REAUTH_INTERVAL_MS)),
      map((data) => ({ data })),
    );
  }
}

@ApiTags('M03 task updates')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/task-updates')
export class AdminTaskUpdatesController {
  constructor(
    @Inject(TaskUpdatesService) private readonly updates: TaskUpdatesService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
    @Inject(AdminCurrentAccessService) private readonly currentAccess: AdminCurrentAccessService,
  ) {}

  @Sse()
  @M03SseOperation(
    M03_PERMISSIONS.WORK_ORDER_READ,
    'Stream facility work-order updates',
    taskUpdateEventSchema,
    { uuidParams: ['organizationId', 'facilityId'] },
  )
  async stream(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ): Promise<Observable<MessageEvent>> {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.updates.forFacility(
      context.organizationId,
      context.facilityId,
      () => this.currentAccess.canReadFacilityWorkOrders(context, session),
    ).pipe(
      takeUntil(timer(REAUTH_INTERVAL_MS)),
      map((data) => ({ data })),
    );
  }
}
