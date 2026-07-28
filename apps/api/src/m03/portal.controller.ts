import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M03_PERMISSIONS } from '@eldercare/authz';
import {
  caregiverCompletionVoiceResultSchema,
  caregiverWorkOrderSchema,
  caregiverWorkOrdersPageSchema,
  elderHumanHelpRequestSchema,
  elderHumanHelpResponseSchema,
  elderServicesPageSchema,
  elderVoiceDemoRequestSchema,
  elderVoiceSubmissionProgressSchema,
  elderVoiceUploadIntentRequestSchema,
  familySummariesQuerySchema,
  familySummariesPageSchema,
  ratingCreateRequestSchema,
  ratingSchema,
  uuidSchema,
  voiceSubmissionCancelRequestSchema,
  voiceSubmissionSchema,
  voiceUploadFinalizeRequestSchema,
  voiceUploadIntentSchema,
  workOrderAcceptRequestSchema,
  workOrderCompletionVoiceUploadIntentRequestSchema,
  workOrderArrivalRequestSchema,
  workOrderArrivalSchema,
  workOrderCompletionRequestSchema,
  workOrderSchema,
  workOrderStartRequestSchema,
  workOrderVerifyRequestSchema,
} from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M03ContextService } from './m03-context.service.js';
import { M03ReadOperation, M03WriteOperation } from './m03-openapi.js';
import { VoiceWorkflowService } from './voice-workflow.service.js';
import { WorkOrdersService } from './work-orders.service.js';

@ApiTags('M03 elder voice requests')
@ApiCookieAuth('sessionCookie')
@Controller('elder/voice-submissions')
export class ElderVoiceController {
  constructor(
    @Inject(VoiceWorkflowService) private readonly voice: VoiceWorkflowService,
    @Inject(M03ContextService) private readonly context: M03ContextService,
  ) {}

  @Post('demo')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Create the deterministic local voice demo',
    elderVoiceSubmissionProgressSchema,
    elderVoiceDemoRequestSchema,
  )
  async demo(@Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.createDemo(context, parseSchema(elderVoiceDemoRequestSchema, body), session);
  }

  @Post('upload-intents')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Create a bounded private audio upload intent',
    voiceUploadIntentSchema,
    elderVoiceUploadIntentRequestSchema,
  )
  async uploadIntent(@Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.createUploadIntent(context, parseSchema(elderVoiceUploadIntentRequestSchema, body), session);
  }

  @Post('human-help')
  @M03WriteOperation(
    M03_PERMISSIONS.NEED_CREATE,
    'Leave AI and request human help',
    elderHumanHelpResponseSchema,
    elderHumanHelpRequestSchema,
  )
  async humanHelp(@Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.requestHumanHelp(context, parseSchema(elderHumanHelpRequestSchema, body), session);
  }

  @Get(':submissionId')
  @M03ReadOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_READ,
    'Read own submission progress without object keys or raw audio',
    elderVoiceSubmissionProgressSchema,
    { uuidParams: ['submissionId'] },
  )
  async get(@Param('submissionId') submissionId: string, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.getForElder(context, parseSchema(uuidSchema, submissionId), session);
  }

  @Post(':submissionId/finalize')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Validate and process a completed upload',
    elderVoiceSubmissionProgressSchema,
    voiceUploadFinalizeRequestSchema,
    { uuidParams: ['submissionId'] },
  )
  async finalize(@Param('submissionId') submissionId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.finalize(context, parseSchema(uuidSchema, submissionId), parseSchema(voiceUploadFinalizeRequestSchema, body), session);
  }

  @Post(':submissionId/cancel')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Cancel an unprocessed own submission',
    voiceSubmissionSchema,
    voiceSubmissionCancelRequestSchema,
    { uuidParams: ['submissionId'] },
  )
  async cancel(@Param('submissionId') submissionId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.voice.cancel(context, parseSchema(uuidSchema, submissionId), parseSchema(voiceSubmissionCancelRequestSchema, body), session);
  }
}

@ApiTags('M03 caregiver tasks')
@ApiCookieAuth('sessionCookie')
@Controller('caregiver/work-orders')
export class CaregiverWorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(VoiceWorkflowService) private readonly voice: VoiceWorkflowService,
    @Inject(M03ContextService) private readonly context: M03ContextService,
  ) {}

  @Get()
  @M03ReadOperation(M03_PERMISSIONS.WORK_ORDER_READ, 'List tasks covered by the active caregiver shift', caregiverWorkOrdersPageSchema)
  async list(@CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.listCaregiver(context, session);
  }

  @Get(':workOrderId')
  @M03ReadOperation(M03_PERMISSIONS.WORK_ORDER_READ, 'Read one active-shift task', caregiverWorkOrderSchema, {
    uuidParams: ['workOrderId'],
  })
  async get(@Param('workOrderId') workOrderId: string, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.getCaregiver(context, parseSchema(uuidSchema, workOrderId), session);
  }

  @Post(':workOrderId/accept')
  @M03WriteOperation(
    M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    'Atomically claim and accept a task',
    caregiverWorkOrderSchema,
    workOrderAcceptRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async accept(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.accept(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderAcceptRequestSchema, body), session);
  }

  @Post(':workOrderId/arrive')
  @M03WriteOperation(
    M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    'Record arrival without inventing a new state',
    workOrderArrivalSchema,
    workOrderArrivalRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async arrive(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.arrive(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderArrivalRequestSchema, body), session);
  }

  @Post(':workOrderId/start')
  @M03WriteOperation(
    M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    'Start an arrived task',
    caregiverWorkOrderSchema,
    workOrderStartRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async start(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.start(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderStartRequestSchema, body), session);
  }

  @Post(':workOrderId/voice-submissions/upload-intents')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Create a caregiver completion-voice upload intent',
    voiceUploadIntentSchema,
    workOrderCompletionVoiceUploadIntentRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async completionVoiceUploadIntent(
    @Param('workOrderId') workOrderId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.voice.createCaregiverCompletionUploadIntent(
      context,
      parseSchema(uuidSchema, workOrderId),
      parseSchema(workOrderCompletionVoiceUploadIntentRequestSchema, body),
      session,
    );
  }

  @Post(':workOrderId/voice-submissions/:submissionId/finalize')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Finalize completion voice and create a reviewable AI draft',
    caregiverCompletionVoiceResultSchema,
    voiceUploadFinalizeRequestSchema,
    { uuidParams: ['workOrderId', 'submissionId'] },
  )
  async finalizeCompletionVoice(
    @Param('workOrderId') workOrderId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.voice.finalizeCaregiverCompletion(
      context,
      parseSchema(uuidSchema, workOrderId),
      parseSchema(uuidSchema, submissionId),
      parseSchema(voiceUploadFinalizeRequestSchema, body),
      session,
    );
  }

  @Post(':workOrderId/voice-submissions/:submissionId/cancel')
  @M03WriteOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    'Cancel and retry deletion of own completion voice',
    voiceSubmissionSchema,
    voiceSubmissionCancelRequestSchema,
    { uuidParams: ['workOrderId', 'submissionId'] },
  )
  async cancelCompletionVoice(
    @Param('workOrderId') workOrderId: string,
    @Param('submissionId') submissionId: string,
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.voice.cancelCaregiverCompletion(
      context,
      parseSchema(uuidSchema, workOrderId),
      parseSchema(uuidSchema, submissionId),
      parseSchema(voiceSubmissionCancelRequestSchema, body),
      session,
    );
  }

  @Post(':workOrderId/complete')
  @M03WriteOperation(
    M03_PERMISSIONS.WORK_ORDER_TRANSITION,
    'Complete a task with a reviewable note',
    caregiverWorkOrderSchema,
    workOrderCompletionRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async complete(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['caregiver']);
    return this.workOrders.complete(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderCompletionRequestSchema, body), session);
  }
}

@ApiTags('M03 elder service review')
@ApiCookieAuth('sessionCookie')
@Controller('elder')
export class ElderServicesController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(M03ContextService) private readonly context: M03ContextService,
  ) {}

  @Get('services')
  @M03ReadOperation(M03_PERMISSIONS.WORK_ORDER_READ, 'List own service progress', elderServicesPageSchema)
  async list(@CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.workOrders.listElderServices(context, session);
  }

  @Post('work-orders/:workOrderId/verify')
  @M03WriteOperation(
    M03_PERMISSIONS.WORK_ORDER_VERIFY,
    'Confirm own completed service',
    workOrderSchema,
    workOrderVerifyRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async verify(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.workOrders.verifyElder(context, parseSchema(uuidSchema, workOrderId), parseSchema(workOrderVerifyRequestSchema, body), session);
  }

  @Post('work-orders/:workOrderId/ratings')
  @M03WriteOperation(
    M03_PERMISSIONS.RATING_CREATE,
    'Rate an own verified service without automatic punishment',
    ratingSchema,
    ratingCreateRequestSchema,
    { uuidParams: ['workOrderId'] },
  )
  async rate(@Param('workOrderId') workOrderId: string, @Body() body: unknown, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['elder']);
    return this.workOrders.rateElder(context, parseSchema(uuidSchema, workOrderId), parseSchema(ratingCreateRequestSchema, body), session);
  }
}

@ApiTags('M03 family summaries')
@ApiCookieAuth('sessionCookie')
@Controller('family/summaries')
export class FamilySummariesController {
  constructor(
    @Inject(WorkOrdersService) private readonly workOrders: WorkOrdersService,
    @Inject(M03ContextService) private readonly context: M03ContextService,
  ) {}

  @Get()
  @M03ReadOperation(
    M03_PERMISSIONS.FAMILY_SUMMARY_READ,
    'List only published consent-filtered family summaries',
    familySummariesPageSchema,
    { querySchema: familySummariesQuerySchema },
  )
  async list(@Query() query: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession, @Req() request: AuthenticatedRequest) {
    const context = await this.context.fromPortal(session, request, ['family']);
    return this.workOrders.listFamilySummaries(context, parseSchema(familySummariesQuerySchema, query), session);
  }
}
