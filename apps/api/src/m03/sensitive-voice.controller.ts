import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { M03_PERMISSIONS } from '@eldercare/authz';
import { transcriptPrivateSchema, uuidSchema, voiceAudioReadUrlSchema } from '@eldercare/contracts';
import { CurrentSession } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedSession } from '../auth/auth.types.js';
import { parseSchema } from '../common/parse-schema.js';
import { M02ContextRoute } from '../m02/m02-context.guard.js';
import { M02ContextService } from '../m02/m02-context.js';
import { M03ActionOperation, M03ReadOperation } from './m03-openapi.js';
import { VoiceWorkflowService } from './voice-workflow.service.js';

@ApiTags('M03 restricted voice data')
@ApiCookieAuth('sessionCookie')
@M02ContextRoute()
@Controller('admin/organizations/:organizationId/facilities/:facilityId/voice-submissions')
export class SensitiveVoiceController {
  constructor(
    @Inject(VoiceWorkflowService) private readonly voice: VoiceWorkflowService,
    @Inject(M02ContextService) private readonly context: M02ContextService,
  ) {}

  @Get(':submissionId/transcript')
  @M03ReadOperation(
    M03_PERMISSIONS.TRANSCRIPT_READ,
    'Read a restricted transcript with audit',
    transcriptPrivateSchema,
    { uuidParams: ['organizationId', 'facilityId', 'submissionId'] },
  )
  async transcript(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('submissionId') submissionId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.voice.getTranscriptPrivate(context, parseSchema(uuidSchema, submissionId), session);
  }

  @Post(':submissionId/audio-read-url')
  @M03ActionOperation(
    M03_PERMISSIONS.VOICE_SUBMISSION_READ,
    'Create an audited short-lived URL for restricted audio',
    voiceAudioReadUrlSchema,
    { uuidParams: ['organizationId', 'facilityId', 'submissionId'] },
  )
  async audioReadUrl(
    @Param('organizationId') organizationId: string,
    @Param('facilityId') facilityId: string,
    @Param('submissionId') submissionId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = await this.context.assertFacility(organizationId, facilityId, session, request);
    return this.voice.createAudioReadUrl(context, parseSchema(uuidSchema, submissionId), session);
  }
}
