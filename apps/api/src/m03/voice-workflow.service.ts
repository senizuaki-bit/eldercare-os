import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DETERMINISTIC_FAKE_PROVIDER,
  DeterministicFakeAIError,
  DeterministicFakeNeedAnalysisProvider,
  DeterministicFakeTranscriptionProvider,
  evaluateDeterministicNeedRisk,
  splitDeterministicNeedAnalysis,
} from '@eldercare/ai';
import { M03_PERMISSIONS } from '@eldercare/authz';
import {
  needAnalysisOutputSchema,
  type ElderHumanHelpRequest,
  type ElderVoiceDemoRequest,
  type NeedAnalysisOutput,
  type VoiceSubmissionCancelRequest,
  type VoiceUploadFinalizeRequest,
  type VoiceUploadIntentRequest,
  type WorkOrderCompletionVoiceUploadIntentRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import { resourceNotFound } from '../authorization/tenant-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ElderAccessService } from '../m02/elder-access.service.js';
import type { M03FacilityContext } from './m03-context.service.js';
import {
  activeCaregiverDataScopeWhere,
  activeCaregiverRoleWhere,
  caregiverRoleHasCurrentScopeAccess,
} from './caregiver-current-access.js';
import { hasActiveElderOwnedAccess } from './elder-current-access.js';
import {
  mapAnalysis,
  mapNeed,
  mapTranscriptMetadata,
  mapVoiceSubmission,
  mapWorkOrder,
  WORK_ORDER_INCLUDE,
} from './m03-mappers.js';
import { m03Conflict } from './m03-errors.js';
import { M03MutationService } from './m03-mutation.service.js';
import { NeedsService } from './needs.service.js';
import { ObjectStorageService } from './object-storage.service.js';
import { voiceConsentFailureCode } from './voice-consent.js';

const RETENTION_DAYS = 30;
const SEAL_LEASE_MS = 30_000;
const PROCESSING_STALE_MS = 30_000;
const ACCEPTED_MIME_TYPES = ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'] as const;

interface UploadIntentSubject {
  readonly elderId: string;
  readonly purpose: 'ELDER_REQUEST' | 'WORK_ORDER_COMPLETION';
  readonly workOrderId: string | null;
}

@Injectable()
export class VoiceWorkflowService {
  private readonly transcription = new DeterministicFakeTranscriptionProvider();
  private readonly analysis = new DeterministicFakeNeedAnalysisProvider();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ElderAccessService) private readonly elderAccess: ElderAccessService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(NeedsService) private readonly needs: NeedsService,
    @Inject(M03MutationService) private readonly mutations: M03MutationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createDemo(
    context: M03FacilityContext,
    input: ElderVoiceDemoRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    await this.assertVoiceConsents(context, elder.id);
    const repeated = await this.database.client.voiceSubmission.findFirst({
      where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
    });
    if (repeated !== null) {
      return this.replayDemo(context, repeated, input, session, elder.id);
    }

    const submissionId = randomUUID();
    const objectKey = this.storage.sealedObjectKey(
      context.organizationId,
      context.facilityId,
      elder.id,
      submissionId,
      randomUUID(),
    );
    const stored = await this.storage.putDemoFixture(objectKey);
    try {
      await this.database.client.voiceSubmission.create({
        data: {
          id: submissionId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: elder.id,
          submittedByUserId: session.userId,
          purpose: 'ELDER_REQUEST',
          status: 'UPLOADED',
          bucket: this.storage.bucketName,
          objectKey,
          mimeType: 'audio/wav',
          declaredSizeBytes: stored.sizeBytes,
          actualSizeBytes: stored.sizeBytes,
          checksumSha256: stored.checksumSha256,
          fixtureKey: input.fixtureKey,
          uploadedAt: new Date(),
          retentionUntil: retentionUntil(),
          idempotencyKey: input.idempotencyKey,
          correlationId: context.correlationId,
        },
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        await this.storage.delete(objectKey).catch(() => undefined);
        const existing = await this.database.client.voiceSubmission.findFirst({
          where: { organizationId: context.organizationId, idempotencyKey: input.idempotencyKey },
        });
        if (existing !== null) {
          return this.replayDemo(context, existing, input, session, elder.id);
        }
      }
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
    await this.process(context, submissionId, session);
    return this.aggregate(context, submissionId, elder.id);
  }

  private async replayDemo(
    context: M03FacilityContext,
    existing: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    input: ElderVoiceDemoRequest,
    session: AuthenticatedSession,
    elderId: string,
  ) {
    if (
      existing.facilityId !== context.facilityId ||
      existing.elderId !== elderId ||
      existing.submittedByUserId !== session.userId ||
      existing.purpose !== 'ELDER_REQUEST' ||
      existing.workOrderId !== null ||
      existing.bucket !== this.storage.bucketName ||
      existing.uploadObjectKey !== null ||
      existing.uploadAuthorizedUntil !== null ||
      existing.sealCandidateObjectKey !== null ||
      existing.sealCandidateSourceETag !== null ||
      existing.sealLeaseToken !== null ||
      existing.sealLeaseUntil !== null ||
      existing.objectDeletionPendingAt !== null ||
      !this.storage.isSealedObjectKey(
        existing.objectKey,
        context.organizationId,
        context.facilityId,
        elderId,
        existing.id,
      )
    ) {
      throw resourceNotFound();
    }
    const fixture = this.storage.demoFixtureMetadata();
    if (
      existing.fixtureKey !== input.fixtureKey ||
      existing.mimeType !== fixture.mimeType ||
      existing.declaredSizeBytes !== fixture.sizeBytes ||
      existing.actualSizeBytes !== fixture.sizeBytes ||
      existing.checksumSha256 !== fixture.checksumSha256
    ) {
      throw m03Conflict('VOICE_IDEMPOTENCY_FINGERPRINT_MISMATCH');
    }
    if (
      existing.objectDeletedAt !== null ||
      existing.objectDeletionPendingAt !== null ||
      existing.retentionUntil <= new Date() ||
      existing.status === 'CANCELLED'
    ) {
      throw resourceNotFound();
    }
    if (['UPLOADED', 'PROCESSING', 'FAILED'].includes(existing.status)) {
      await this.process(context, existing.id, session).catch((error: unknown) => {
        if (!isM03ConflictCode(error, 'VOICE_SUBMISSION_VERSION_CONFLICT')) throw error;
      });
    }
    if (existing.status === 'UPLOADED' || existing.status === 'PROCESSING') {
      await this.waitForProcessing(existing.id);
    }
    return this.aggregate(context, existing.id, elderId);
  }

  private async waitForProcessing(submissionId: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await this.database.client.voiceSubmission.findUnique({
        where: { id: submissionId },
        select: { status: true },
      });
      if (
        current === null ||
        current.status === 'COMPLETED' ||
        current.status === 'FAILED' ||
        current.status === 'CANCELLED'
      ) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw m03Conflict('VOICE_SUBMISSION_PROCESSING');
  }

  async createUploadIntent(
    context: M03FacilityContext,
    input: VoiceUploadIntentRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    await this.assertVoiceConsents(context, elder.id);
    if (input.purpose !== 'ELDER_REQUEST') throw resourceNotFound();
    return this.createUploadIntentForSubject(context, input, session, {
      elderId: elder.id,
      purpose: 'ELDER_REQUEST',
      workOrderId: null,
    });
  }

  async createCaregiverCompletionUploadIntent(
    context: M03FacilityContext,
    workOrderId: string,
    input: WorkOrderCompletionVoiceUploadIntentRequest,
    session: AuthenticatedSession,
  ) {
    const subject = await this.assertCaregiverCompletionAccess(context, workOrderId, session);
    await this.assertVoiceConsents(context, subject.elderId);
    return this.createUploadIntentForSubject(context, {
      ...input,
      purpose: 'WORK_ORDER_COMPLETION',
    }, session, subject);
  }

  private async createUploadIntentForSubject(
    context: M03FacilityContext,
    input: VoiceUploadIntentRequest,
    session: AuthenticatedSession,
    subject: UploadIntentSubject,
  ) {
    const existing = await this.findUploadByIdempotencyKey(context.organizationId, input.idempotencyKey);
    if (existing !== null) return this.replayUploadIntent(context, existing, input, session, subject);

    const submissionId = randomUUID();
    const uploadObjectKey = this.storage.stagingObjectKey(
      context.organizationId,
      context.facilityId,
      subject.elderId,
      submissionId,
    );
    let created: Prisma.VoiceSubmissionGetPayload<Record<string, never>>;
    try {
      created = await this.database.client.voiceSubmission.create({
        data: {
          id: submissionId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: subject.elderId,
          workOrderId: subject.workOrderId,
          submittedByUserId: session.userId,
          purpose: subject.purpose,
          status: 'UPLOAD_PENDING',
          bucket: this.storage.bucketName,
          objectKey: uploadObjectKey,
          uploadObjectKey,
          mimeType: input.mimeType,
          declaredSizeBytes: input.sizeBytes,
          checksumSha256: input.checksumSha256 ?? null,
          fixtureKey: input.fixtureKey ?? null,
          retentionUntil: retentionUntil(),
          idempotencyKey: input.idempotencyKey,
          correlationId: context.correlationId,
        },
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        const raced = await this.findUploadByIdempotencyKey(context.organizationId, input.idempotencyKey);
        if (raced !== null) return this.replayUploadIntent(context, raced, input, session, subject);
      }
      throw error;
    }
    return this.authorizeStagingUpload(context, created, session, subject);
  }

  async finalize(
    context: M03FacilityContext,
    submissionId: string,
    input: VoiceUploadFinalizeRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    await this.assertVoiceConsents(context, elder.id);
    const subject: UploadIntentSubject = { elderId: elder.id, purpose: 'ELDER_REQUEST', workOrderId: null };
    await this.finalizeForSubject(context, submissionId, input, session, subject);
    return this.aggregate(context, submissionId, elder.id);
  }

  async finalizeCaregiverCompletion(
    context: M03FacilityContext,
    workOrderId: string,
    submissionId: string,
    input: VoiceUploadFinalizeRequest,
    session: AuthenticatedSession,
  ) {
    const subject = await this.assertCaregiverCompletionAccess(context, workOrderId, session);
    await this.assertVoiceConsents(context, subject.elderId);
    await this.finalizeForSubject(context, submissionId, input, session, subject);
    return this.completionAggregate(context, submissionId, subject, session);
  }

  async cancel(
    context: M03FacilityContext,
    submissionId: string,
    input: VoiceSubmissionCancelRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    return this.cancelForSubject(context, submissionId, input, session, {
      elderId: elder.id,
      purpose: 'ELDER_REQUEST',
      workOrderId: null,
    });
  }

  async cancelCaregiverCompletion(
    context: M03FacilityContext,
    workOrderId: string,
    submissionId: string,
    input: VoiceSubmissionCancelRequest,
    session: AuthenticatedSession,
  ) {
    const submission = await this.database.client.voiceSubmission.findFirst({
      where: {
        id: submissionId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        submittedByUserId: session.userId,
        purpose: 'WORK_ORDER_COMPLETION',
        workOrderId,
      },
      select: { elderId: true },
    });
    if (submission === null) throw resourceNotFound();
    return this.cancelForSubject(context, submissionId, input, session, {
      elderId: submission.elderId,
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
    });
  }

  async requestHumanHelp(
    context: M03FacilityContext,
    input: ElderHumanHelpRequest,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    const need = await this.needs.createElderOwnedManual(context, {
      elderId: elder.id,
      summary: input.message ?? '老人请求工作人员联系并协助确认当前需求。',
      category: 'OTHER',
      priority: 'PRIORITY',
      requiresHumanReview: true,
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
    }, session, M03_PERMISSIONS.NEED_CREATE);
    return { need, workOrder: null, humanReviewRequired: true as const };
  }

  async getForElder(
    context: M03FacilityContext,
    submissionId: string,
    session: AuthenticatedSession,
  ) {
    const elder = await this.elderForSession(context, session);
    return this.aggregate(context, submissionId, elder.id);
  }

  async getTranscriptPrivate(context: M03FacilityContext, submissionId: string, session: AuthenticatedSession) {
    const now = new Date();
    const transcript = await this.database.client.transcript.findFirst({
      where: {
        voiceSubmissionId: submissionId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        retentionUntil: { gt: now },
        contentDeletedAt: null,
        voiceSubmission: {
          status: { not: 'CANCELLED' },
          objectDeletionPendingAt: null,
          objectDeletedAt: null,
          retentionUntil: { gt: now },
        },
      },
    });
    if (transcript === null) throw resourceNotFound();
    await this.assertVoiceConsents(context, transcript.elderId);
    await this.audit.record({
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'TRANSCRIPT.READ',
      outcome: 'SUCCESS',
      resourceType: 'TRANSCRIPT',
      resourceId: transcript.id,
      correlationId: context.correlationId,
      metadata: { source: 'm03-sensitive-read' },
    });
    return { ...mapTranscriptMetadata(transcript), text: transcript.text };
  }

  async createAudioReadUrl(context: M03FacilityContext, submissionId: string, session: AuthenticatedSession) {
    const now = new Date();
    const submission = await this.database.client.voiceSubmission.findFirst({
      where: {
        id: submissionId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        status: { in: ['COMPLETED', 'FAILED'] },
        objectDeletionPendingAt: null,
        objectDeletedAt: null,
        retentionUntil: { gt: now },
      },
    });
    if (submission === null) throw resourceNotFound();
    if (!this.storage.isSealedObjectKey(
      submission.objectKey,
      context.organizationId,
      context.facilityId,
      submission.elderId,
      submission.id,
    )) throw resourceNotFound();
    await this.assertVoiceConsents(context, submission.elderId);
    const signed = await this.storage.createReadUrl(submission.objectKey);
    await this.audit.record({
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'VOICE_SUBMISSION.READ_URL_CREATE',
      outcome: 'SUCCESS',
      resourceType: 'VOICE_SUBMISSION',
      resourceId: submission.id,
      correlationId: context.correlationId,
      metadata: { source: 'm03-sensitive-read' },
    });
    return { submissionId: submission.id, ...signed };
  }

  private async findUploadByIdempotencyKey(organizationId: string, idempotencyKey: string) {
    return this.database.client.voiceSubmission.findFirst({
      where: { organizationId, idempotencyKey },
    });
  }

  private async replayUploadIntent(
    context: M03FacilityContext,
    existing: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    input: VoiceUploadIntentRequest,
    session: AuthenticatedSession,
    subject: UploadIntentSubject,
  ) {
    const expectedUploadObjectKey = this.storage.stagingObjectKey(
      context.organizationId,
      context.facilityId,
      subject.elderId,
      existing.id,
    );
    if (
      existing.facilityId !== context.facilityId ||
      existing.elderId !== subject.elderId ||
      existing.submittedByUserId !== session.userId ||
      existing.purpose !== subject.purpose ||
      existing.workOrderId !== subject.workOrderId ||
      existing.bucket !== this.storage.bucketName ||
      existing.objectKey !== expectedUploadObjectKey ||
      existing.uploadObjectKey !== expectedUploadObjectKey ||
      !this.storage.isStagingObjectKey(
        existing.uploadObjectKey,
        context.organizationId,
        context.facilityId,
        subject.elderId,
        existing.id,
      )
    ) {
      throw resourceNotFound();
    }
    if (
      existing.mimeType !== input.mimeType ||
      existing.declaredSizeBytes !== input.sizeBytes ||
      existing.checksumSha256 !== (input.checksumSha256 ?? null) ||
      existing.fixtureKey !== (input.fixtureKey ?? null)
    ) {
      throw m03Conflict('VOICE_IDEMPOTENCY_FINGERPRINT_MISMATCH');
    }
    if (
      existing.sealCandidateObjectKey !== null ||
      existing.sealCandidateSourceETag !== null ||
      existing.sealLeaseToken !== null ||
      existing.sealLeaseUntil !== null
    ) {
      throw m03Conflict('VOICE_SUBMISSION_FINALIZING');
    }
    if (
      existing.objectDeletedAt !== null ||
      existing.retentionUntil <= new Date() ||
      existing.status === 'CANCELLED'
    ) {
      throw resourceNotFound();
    }
    if (existing.status !== 'UPLOAD_PENDING') throw m03Conflict('VOICE_SUBMISSION_ALREADY_FINALIZED');
    return this.authorizeStagingUpload(context, existing, session, subject);
  }

  private async authorizeStagingUpload(
    context: M03FacilityContext,
    record: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    subject: UploadIntentSubject,
  ) {
    if (record.uploadObjectKey === null) throw resourceNotFound();
    const request: VoiceUploadIntentRequest = {
      purpose: record.purpose,
      mimeType: record.mimeType as VoiceUploadIntentRequest['mimeType'],
      sizeBytes: record.declaredSizeBytes,
      ...(record.checksumSha256 === null ? {} : { checksumSha256: record.checksumSha256 }),
      ...(record.fixtureKey === null
        ? {}
        : { fixtureKey: record.fixtureKey as NonNullable<VoiceUploadIntentRequest['fixtureKey']> }),
      idempotencyKey: record.idempotencyKey,
    };
    const upload = await this.storage.createUpload(record.uploadObjectKey, request);
    const authorization = await this.database.client.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.voiceSubmission.findFirst({
        where: {
          id: record.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: subject.elderId,
          submittedByUserId: session.userId,
          purpose: subject.purpose,
          workOrderId: subject.workOrderId,
        },
      });
      if (
        current === null ||
        current.version !== record.version ||
        current.status !== 'UPLOAD_PENDING' ||
        current.objectKey !== record.uploadObjectKey ||
        current.uploadObjectKey !== record.uploadObjectKey ||
        current.objectDeletedAt !== null ||
        current.objectDeletionPendingAt !== null ||
        current.retentionUntil <= now
      ) {
        return { outcome: 'CONFLICT' as const };
      }
      const reasonCode = await this.currentSubmissionGuardReason(
        tx,
        context,
        current,
        session,
        now,
      );
      if (reasonCode !== null) {
        const aborted = await tx.voiceSubmission.updateMany({
          where: {
            id: current.id,
            version: current.version,
            status: 'UPLOAD_PENDING',
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
          },
          data: {
            status: 'CANCELLED',
            failureCode: reasonCode,
            objectDeletionPendingAt: now,
            uploadAuthorizedUntil: null,
            version: { increment: 1 },
          },
        });
        if (aborted.count !== 1) return { outcome: 'CONFLICT' as const };
        await this.audit.record({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'VOICE_SUBMISSION.UPLOAD_AUTHORIZATION_ABORT',
          outcome: 'DENIED',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: current.id,
          reasonCode,
          correlationId: context.correlationId,
          metadata: { source: 'm03-upload-authorization-guard' },
        }, tx);
        return { outcome: 'ABORTED' as const };
      }
      const changed = await tx.voiceSubmission.updateMany({
        where: {
          id: current.id,
          version: current.version,
          status: 'UPLOAD_PENDING',
          objectDeletedAt: null,
          objectDeletionPendingAt: null,
          uploadObjectKey: current.uploadObjectKey,
          sealCandidateObjectKey: null,
          sealCandidateSourceETag: null,
          sealLeaseToken: null,
          sealLeaseUntil: null,
        },
        data: { uploadAuthorizedUntil: new Date(upload.expiresAt) },
      });
      return changed.count === 1
        ? { outcome: 'AUTHORIZED' as const, record: current }
        : { outcome: 'CONFLICT' as const };
    }, { isolationLevel: 'Serializable' });
    if (authorization.outcome === 'ABORTED') throw resourceNotFound();
    if (authorization.outcome === 'CONFLICT') {
      throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    }
    return this.uploadIntentResponse(authorization.record, upload);
  }

  private uploadIntentResponse(
    record: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    upload: Awaited<ReturnType<ObjectStorageService['createUpload']>>,
  ) {
    return {
      submissionId: record.id,
      expectedVersion: record.version,
      upload,
      acceptedMimeTypes: [...ACCEPTED_MIME_TYPES],
      maxSizeBytes: 10 * 1024 * 1024,
    };
  }

  private async finalizeForSubject(
    context: M03FacilityContext,
    submissionId: string,
    input: VoiceUploadFinalizeRequest,
    session: AuthenticatedSession,
    subject: UploadIntentSubject,
  ): Promise<void> {
    const requestedAt = new Date();
    const submission = await this.database.client.voiceSubmission.findFirst({
      where: {
        id: submissionId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: subject.elderId,
        submittedByUserId: session.userId,
        purpose: subject.purpose,
        workOrderId: subject.workOrderId,
      },
    });
    if (
      submission === null ||
      submission.objectDeletedAt !== null ||
      submission.objectDeletionPendingAt !== null ||
      submission.retentionUntil <= requestedAt ||
      submission.status === 'CANCELLED'
    ) {
      throw resourceNotFound();
    }
    if (
      input.checksumSha256 !== undefined &&
      submission.checksumSha256 !== null &&
      input.checksumSha256 !== submission.checksumSha256
    ) {
      throw m03Conflict('VOICE_FINALIZE_FINGERPRINT_MISMATCH');
    }
    if (['UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(submission.status)) {
      if (
        submission.version < input.expectedVersion + 1 ||
        !this.storage.isSealedObjectKey(
          submission.objectKey,
          context.organizationId,
          context.facilityId,
          subject.elderId,
          submission.id,
        )
      ) {
        throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      }
      if (submission.status !== 'COMPLETED') {
        await this.process(context, submission.id, session).catch((error: unknown) => {
          if (!isM03ConflictCode(error, 'VOICE_SUBMISSION_VERSION_CONFLICT')) throw error;
        });
      }
      return;
    }
    if (submission.version !== input.expectedVersion || submission.status !== 'UPLOAD_PENDING') {
      throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    }
    if (
      submission.uploadObjectKey === null ||
      submission.uploadAuthorizedUntil === null ||
      submission.uploadAuthorizedUntil <= requestedAt ||
      submission.objectKey !== submission.uploadObjectKey ||
      !this.storage.isStagingObjectKey(
        submission.uploadObjectKey,
        context.organizationId,
        context.facilityId,
        subject.elderId,
        submission.id,
      )
    ) {
      throw resourceNotFound();
    }
    let sealedObjectKey = submission.sealCandidateObjectKey;
    let sourceETag = submission.sealCandidateSourceETag;
    let leaseToken = submission.sealLeaseToken;
    let leaseUntil = submission.sealLeaseUntil;
    if (
      (sealedObjectKey === null) !== (sourceETag === null) ||
      (sealedObjectKey === null) !== (leaseToken === null) ||
      (sealedObjectKey === null) !== (leaseUntil === null)
    ) {
      throw resourceNotFound();
    }
    const requestedLeaseToken = randomUUID();
    if (
      sealedObjectKey === null ||
      sourceETag === null ||
      leaseToken === null ||
      leaseUntil === null
    ) {
      const actual = await this.storage.inspect(submission.uploadObjectKey);
      this.storage.assertUploadedObject(
        {
          mimeType: submission.mimeType,
          sizeBytes: submission.declaredSizeBytes,
          checksumSha256: input.checksumSha256 ?? submission.checksumSha256,
        },
        actual,
      );
      if (actual.eTag === null) throw m03Conflict('VOICE_OBJECT_ETAG_REQUIRED');
      const candidate = this.storage.sealedObjectKey(
        context.organizationId,
        context.facilityId,
        subject.elderId,
        submission.id,
        randomUUID(),
      );
      const candidateLeaseUntil = boundedSealLeaseUntil(submission.uploadAuthorizedUntil);
      const reserved = await this.database.client.voiceSubmission.updateMany({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          version: input.expectedVersion,
          status: 'UPLOAD_PENDING',
          objectKey: submission.uploadObjectKey,
          uploadObjectKey: submission.uploadObjectKey,
          sealCandidateObjectKey: null,
          sealCandidateSourceETag: null,
          sealLeaseToken: null,
          sealLeaseUntil: null,
          uploadAuthorizedUntil: { gt: new Date() },
          objectDeletionPendingAt: null,
          objectDeletedAt: null,
        },
        data: {
          sealCandidateObjectKey: candidate,
          sealCandidateSourceETag: actual.eTag,
          sealLeaseToken: requestedLeaseToken,
          sealLeaseUntil: candidateLeaseUntil,
        },
      });
      if (reserved.count === 1) {
        sealedObjectKey = candidate;
        sourceETag = actual.eTag;
        leaseToken = requestedLeaseToken;
        leaseUntil = candidateLeaseUntil;
      } else {
        const raced = await this.database.client.voiceSubmission.findUnique({
          where: { id: submission.id },
        });
        if (
          raced !== null &&
          ['UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(raced.status) &&
          raced.objectDeletionPendingAt === null &&
          raced.objectDeletedAt === null &&
          this.storage.isSealedObjectKey(
            raced.objectKey,
            context.organizationId,
            context.facilityId,
            subject.elderId,
            raced.id,
          )
        ) return;
        if (
          raced === null ||
          raced.status !== 'UPLOAD_PENDING' ||
          raced.version !== input.expectedVersion ||
          raced.objectDeletionPendingAt !== null ||
          raced.sealCandidateObjectKey === null ||
          raced.sealCandidateSourceETag === null ||
          raced.sealLeaseToken === null ||
          raced.sealLeaseUntil === null
        ) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
        throw m03Conflict('VOICE_SUBMISSION_FINALIZING');
      }
    } else {
      if (leaseUntil > requestedAt) throw m03Conflict('VOICE_SUBMISSION_FINALIZING');
      const takeoverLeaseUntil = boundedSealLeaseUntil(submission.uploadAuthorizedUntil);
      const takeover = await this.database.client.voiceSubmission.updateMany({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          version: input.expectedVersion,
          status: 'UPLOAD_PENDING',
          objectKey: submission.uploadObjectKey,
          uploadObjectKey: submission.uploadObjectKey,
          uploadAuthorizedUntil: { gt: new Date() },
          sealCandidateObjectKey: sealedObjectKey,
          sealCandidateSourceETag: sourceETag,
          sealLeaseToken: leaseToken,
          sealLeaseUntil: leaseUntil,
          objectDeletionPendingAt: null,
          objectDeletedAt: null,
        },
        data: {
          sealLeaseToken: requestedLeaseToken,
          sealLeaseUntil: takeoverLeaseUntil,
        },
      });
      if (takeover.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      leaseToken = requestedLeaseToken;
      leaseUntil = takeoverLeaseUntil;
    }
    if (!this.storage.isSealedObjectKey(
      sealedObjectKey,
      context.organizationId,
      context.facilityId,
      subject.elderId,
      submission.id,
    )) throw resourceNotFound();
    const sealed = await this.storage.copyToSealed(
      submission.uploadObjectKey,
      sealedObjectKey,
      sourceETag,
      leaseUntil,
    );
    this.storage.assertUploadedObject(
        {
          mimeType: submission.mimeType,
          sizeBytes: submission.declaredSizeBytes,
          checksumSha256: input.checksumSha256 ?? submission.checksumSha256,
        },
        sealed,
    );
    if (leaseUntil <= new Date()) {
      throw m03Conflict('VOICE_SEAL_LEASE_EXPIRED');
    }
    const commitResult = await this.commitSealedUpload(
      context,
      submission,
      input,
      session,
      sealedObjectKey,
      sourceETag,
      leaseToken,
      leaseUntil,
      sealed.contentLength,
    );
    if (commitResult === 'REPLAY') return;
    if (commitResult !== 'COMMITTED') {
      if (commitResult === 'ABORTED') throw resourceNotFound();
      throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    }
    await this.deleteStagingBestEffort(context, submission, session);
    await this.process(context, submission.id, session);
  }

  private async commitSealedUpload(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    input: VoiceUploadFinalizeRequest,
    session: AuthenticatedSession,
    sealedObjectKey: string,
    sourceETag: string,
    leaseToken: string,
    leaseUntil: Date,
    contentLength: number,
  ): Promise<'ABORTED' | 'COMMITTED' | 'CONFLICT' | 'REPLAY'> {
    return this.database.client.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.voiceSubmission.findFirst({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
        },
      });
      if (current === null) return 'CONFLICT';
      const replay =
        ['UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(current.status) &&
        current.objectKey === sealedObjectKey &&
        current.objectDeletionPendingAt === null &&
        current.objectDeletedAt === null;
      if (
        !replay &&
        (
          current.status !== 'UPLOAD_PENDING' ||
          current.version !== input.expectedVersion ||
          current.objectKey !== submission.uploadObjectKey ||
          current.uploadObjectKey !== submission.uploadObjectKey ||
          current.sealCandidateObjectKey !== sealedObjectKey ||
          current.sealCandidateSourceETag !== sourceETag ||
          current.sealLeaseToken !== leaseToken ||
          current.sealLeaseUntil?.getTime() !== leaseUntil.getTime()
        )
      ) return 'CONFLICT';

      const reasonCode =
        await this.currentSubmissionGuardReason(tx, context, current, session, now) ??
        (!replay && (current.uploadAuthorizedUntil === null || current.uploadAuthorizedUntil <= now)
          ? 'VOICE_UPLOAD_AUTHORIZATION_EXPIRED'
          : null) ??
        (!replay && leaseUntil <= now ? 'VOICE_SEAL_LEASE_EXPIRED' : null);
      if (reasonCode !== null) {
        const aborted = await tx.voiceSubmission.updateMany({
          where: {
            id: current.id,
            version: current.version,
            status: current.status,
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
            ...(replay
              ? { objectKey: sealedObjectKey }
              : {
                  objectKey: current.objectKey,
                  sealCandidateObjectKey: sealedObjectKey,
                  sealCandidateSourceETag: sourceETag,
                  sealLeaseToken: leaseToken,
                  sealLeaseUntil: leaseUntil,
                }),
          },
          data: {
            status: 'CANCELLED',
            failureCode: reasonCode,
            objectDeletionPendingAt: current.objectDeletionPendingAt ?? now,
            version: { increment: 1 },
          },
        });
        if (aborted.count !== 1) return 'CONFLICT';
        await this.audit.record({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'VOICE_SUBMISSION.SEAL_ABORT',
          outcome: 'DENIED',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: current.id,
          reasonCode,
          correlationId: context.correlationId,
          metadata: { source: 'm03-seal-guard' },
        }, tx);
        return 'ABORTED';
      }
      if (replay) return 'REPLAY';

      const changed = await tx.voiceSubmission.updateMany({
        where: {
          id: current.id,
          version: current.version,
          status: 'UPLOAD_PENDING',
          objectKey: current.objectKey,
          uploadObjectKey: current.uploadObjectKey,
          sealCandidateObjectKey: sealedObjectKey,
          sealCandidateSourceETag: sourceETag,
          sealLeaseToken: leaseToken,
          sealLeaseUntil: leaseUntil,
          objectDeletionPendingAt: null,
          objectDeletedAt: null,
        },
        data: {
          objectKey: sealedObjectKey,
          sealCandidateObjectKey: null,
          sealCandidateSourceETag: null,
          sealLeaseToken: null,
          sealLeaseUntil: null,
          status: 'UPLOADED',
          actualSizeBytes: contentLength,
          checksumSha256: input.checksumSha256 ?? submission.checksumSha256,
          uploadedAt: now,
          version: { increment: 1 },
        },
      });
      return changed.count === 1 ? 'COMMITTED' : 'CONFLICT';
    }, { isolationLevel: 'Serializable' });
  }

  private async cancelForSubject(
    context: M03FacilityContext,
    submissionId: string,
    input: VoiceSubmissionCancelRequest,
    session: AuthenticatedSession,
    subject: UploadIntentSubject,
  ) {
    let submission = await this.database.client.voiceSubmission.findFirst({
      where: {
        id: submissionId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: subject.elderId,
        submittedByUserId: session.userId,
        purpose: subject.purpose,
        workOrderId: subject.workOrderId,
      },
    });
    if (submission === null) throw resourceNotFound();
    if (submission.status !== 'CANCELLED') {
      if (
        submission.version !== input.expectedVersion ||
        !['UPLOAD_PENDING', 'UPLOADED', 'PROCESSING'].includes(submission.status)
      ) {
        throw m03Conflict('VOICE_SUBMISSION_CANNOT_CANCEL');
      }
      const deletionRequestedAt = submission.objectDeletionPendingAt ?? new Date();
      const cancellingSubmission = submission;
      submission = await this.database.client.$transaction(async (tx) => {
        const changed = await tx.voiceSubmission.updateMany({
          where: {
            id: cancellingSubmission.id,
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            version: input.expectedVersion,
            status: { in: ['UPLOAD_PENDING', 'UPLOADED', 'PROCESSING'] },
            objectDeletedAt: null,
          },
          data: {
            status: 'CANCELLED',
            failureCode: input.reasonCode,
            objectDeletionPendingAt: deletionRequestedAt,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
        await this.audit.record({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'VOICE_SUBMISSION.CANCEL',
          outcome: 'SUCCESS',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: cancellingSubmission.id,
          reasonCode: input.reasonCode,
          correlationId: context.correlationId,
          metadata: { source: 'm03-api' },
        }, tx);
        return tx.voiceSubmission.findUniqueOrThrow({ where: { id: cancellingSubmission.id } });
      }, { isolationLevel: 'Serializable' });
    } else if (submission.objectDeletedAt === null && submission.objectDeletionPendingAt === null) {
      const deletionRequestedAt = new Date();
      const fencedSubmission = submission;
      submission = await this.database.client.$transaction(async (tx) => {
        const requested = await tx.voiceSubmission.updateMany({
          where: {
            id: fencedSubmission.id,
            version: fencedSubmission.version,
            status: 'CANCELLED',
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
          },
          data: {
            objectDeletionPendingAt: deletionRequestedAt,
            version: { increment: 1 },
          },
        });
        if (requested.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
        await this.audit.record({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'VOICE_SUBMISSION.DELETE_FENCE_CREATE',
          outcome: 'SUCCESS',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: fencedSubmission.id,
          reasonCode: 'CANCELLED_SUBMISSION_RECONCILIATION',
          correlationId: context.correlationId,
          metadata: { source: 'm03-api' },
        }, tx);
        return tx.voiceSubmission.findUniqueOrThrow({ where: { id: fencedSubmission.id } });
      }, { isolationLevel: 'Serializable' });
    }
    await this.tryDeleteObjectAndMark(context, submission, session);
    const updated = await this.database.client.voiceSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    return mapVoiceSubmission(updated);
  }

  private async tryDeleteObjectAndMark(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
  ): Promise<void> {
    if (submission.objectDeletedAt !== null) return;
    try {
      await this.storage.delete(submission.objectKey);
      if (
        submission.uploadObjectKey !== null &&
        submission.uploadObjectKey !== submission.objectKey
      ) {
        await this.storage.delete(submission.uploadObjectKey);
      }
      if (
        submission.sealCandidateObjectKey !== null &&
        submission.sealCandidateObjectKey !== submission.objectKey &&
        submission.sealCandidateObjectKey !== submission.uploadObjectKey
      ) {
        await this.storage.delete(submission.sealCandidateObjectKey);
      }
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_SUBMISSION.OBJECT_DELETE_ATTEMPT',
        outcome: 'SUCCESS',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: 'DELETION_FENCE_ACTIVE',
        correlationId: context.correlationId,
        metadata: { source: 'm03-api' },
      });
    } catch {
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_SUBMISSION.OBJECT_DELETE',
        outcome: 'FAILURE',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: 'OBJECT_DELETE_DEFERRED',
        correlationId: context.correlationId,
        metadata: { source: 'm03-api' },
      });
    }
  }

  private async deleteStagingBestEffort(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
  ): Promise<void> {
    if (submission.uploadObjectKey === null) return;
    try {
      await this.storage.delete(submission.uploadObjectKey);
    } catch {
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_SUBMISSION.STAGING_DELETE',
        outcome: 'FAILURE',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: 'STAGING_DELETE_DEFERRED',
        correlationId: context.correlationId,
        metadata: { source: 'm03-api' },
      });
    }
  }

  private async assertCaregiverCompletionAccess(
    context: M03FacilityContext,
    workOrderId: string,
    session: AuthenticatedSession,
  ): Promise<UploadIntentSubject> {
    const subject = await this.database.client.$transaction(async (tx) =>
      this.activeCaregiverCompletionSubject(tx, context, workOrderId, session, new Date()),
    { isolationLevel: 'Serializable' });
    if (subject === null) throw resourceNotFound();
    await this.elderAccess.assert(context, subject.elderId, session, 'CAREGIVER_SUMMARY');
    return subject;
  }

  private async caregiverCompletionAccessStillActive(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    now: Date,
  ): Promise<boolean> {
    if (submission.workOrderId === null) return false;
    return (await this.activeCaregiverCompletionSubject(
      tx,
      context,
      submission.workOrderId,
      session,
      now,
      submission.elderId,
    )) !== null;
  }

  private async elderRequestAccessStillActive(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    now: Date,
  ): Promise<boolean> {
    if (
      submission.purpose !== 'ELDER_REQUEST' ||
      submission.workOrderId !== null ||
      submission.submittedByUserId !== session.userId
    ) {
      return false;
    }
    return hasActiveElderOwnedAccess(
      tx,
      context,
      submission.elderId,
      session.userId,
      now,
      M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    );
  }

  private async activeCaregiverCompletionSubject(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    workOrderId: string,
    session: AuthenticatedSession,
    now: Date,
    expectedElderId?: string,
  ): Promise<UploadIntentSubject | null> {
    const [staff, caregiverRole] = await Promise.all([
      tx.staffProfile.findFirst({
        where: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          userId: session.userId,
          status: 'ACTIVE',
          endedAt: null,
        },
        select: {
          id: true,
          teamMemberships: {
            where: {
              activeFrom: { lte: now },
              OR: [{ activeUntil: null }, { activeUntil: { gt: now } }],
            },
            select: { teamId: true },
          },
        },
      }),
      tx.userRole.findFirst({
        where: activeCaregiverRoleWhere(
          context,
          session.userId,
          now,
          M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
        ),
        select: {
          id: true,
          dataScopes: {
            where: activeCaregiverDataScopeWhere(context, now),
            select: { kind: true, scopeKey: true, resourceType: true, resourceId: true },
          },
        },
      }),
    ]);
    if (staff === null || caregiverRole === null) return null;
    const workOrder = await tx.workOrder.findFirst({
      where: {
        id: workOrderId,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        ...(expectedElderId === undefined ? {} : { elderId: expectedElderId }),
        status: 'IN_PROGRESS',
        elder: {
          status: 'ACTIVE',
          stays: { some: { status: 'ACTIVE' } },
        },
      },
      select: {
        elderId: true,
        elder: {
          select: {
            stays: {
              where: { status: 'ACTIVE' },
              orderBy: { admittedAt: 'desc' },
              take: 1,
              select: { bed: { select: { room: { select: { floorId: true, zoneId: true } } } } },
            },
          },
        },
        assignments: {
          where: { status: 'CLAIMED', assigneeStaffProfileId: staff.id },
          select: { shiftAssignmentId: true, targetTeamId: true },
          take: 1,
        },
      },
    });
    const assignment = workOrder?.assignments[0];
    if (
      workOrder === null ||
      assignment === undefined ||
      assignment.shiftAssignmentId === null ||
      assignment.targetTeamId === null
    ) {
      return null;
    }
    if (!staff.teamMemberships.some((membership) => membership.teamId === assignment.targetTeamId)) {
      return null;
    }
    const residence = workOrder.elder.stays[0]?.bed.room;
    if (residence === undefined) return null;
    const [team, coveringShift] = await Promise.all([
      tx.team.findFirst({
        where: {
          id: assignment.targetTeamId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      tx.shiftAssignment.findFirst({
        where: {
          id: assignment.shiftAssignmentId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          staffProfileId: staff.id,
          status: { in: ['ASSIGNED', 'ACCEPTED'] },
          shift: {
            teamId: assignment.targetTeamId,
            startsAt: { lte: now },
            endsAt: { gt: now },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
          OR: [
            { elderAssignments: { some: { elderId: workOrder.elderId } } },
            { scopes: { some: { kind: 'FACILITY' } } },
            ...(residence === undefined
              ? []
              : [
                  { scopes: { some: { kind: 'FLOOR' as const, floorId: residence.floorId } } },
                  ...(residence.zoneId === null
                    ? []
                    : [{ scopes: { some: { kind: 'ZONE' as const, zoneId: residence.zoneId } } }]),
                ]),
          ],
        },
        select: { id: true },
      }),
    ]);
    if (
      team === null ||
      coveringShift === null ||
      !caregiverRoleHasCurrentScopeAccess(caregiverRole.dataScopes, {
        shiftAssignmentId: assignment.shiftAssignmentId,
        elderId: workOrder.elderId,
        floorId: residence.floorId,
        teamId: assignment.targetTeamId,
      })
    ) {
      return null;
    }
    return {
      elderId: workOrder.elderId,
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
    };
  }

  private async completionAggregate(
    context: M03FacilityContext,
    submissionId: string,
    subject: UploadIntentSubject,
    session: AuthenticatedSession,
  ) {
    if (subject.workOrderId === null) throw resourceNotFound();
    return this.database.client.$transaction(async (tx) => {
      const now = new Date();
      const currentSubject = await this.activeCaregiverCompletionSubject(
        tx,
        context,
        subject.workOrderId ?? '',
        session,
        now,
        subject.elderId,
      );
      if (currentSubject === null) throw resourceNotFound();
      const submission = await tx.voiceSubmission.findFirst({
        where: {
          id: submissionId,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: currentSubject.elderId,
          submittedByUserId: session.userId,
          purpose: 'WORK_ORDER_COMPLETION',
          workOrderId: currentSubject.workOrderId,
          status: { not: 'CANCELLED' },
          objectDeletionPendingAt: null,
          objectDeletedAt: null,
          retentionUntil: { gt: now },
        },
        include: { transcript: true },
      });
      if (submission === null) throw resourceNotFound();
      const transcript = submission.transcript;
      const completionDraft = submission.status === 'COMPLETED' && transcript?.text
        ? {
            workOrderId: currentSubject.workOrderId,
            voiceSubmissionId: submission.id,
            noteText: completionDraftText(transcript.text),
            aiDisclosure: 'AI_DRAFT_REQUIRES_CAREGIVER_REVIEW' as const,
            requiresCaregiverReview: true as const,
          }
        : null;
      return {
        submission: mapVoiceSubmission(submission),
        transcript: transcript === null ? null : mapTranscriptMetadata(transcript),
        completionDraft,
      };
    }, { isolationLevel: 'Serializable' });
  }

  private async process(context: M03FacilityContext, submissionId: string, session: AuthenticatedSession): Promise<void> {
    const submission = await this.database.client.voiceSubmission.findFirst({
      where: { id: submissionId, organizationId: context.organizationId, facilityId: context.facilityId },
    });
    if (submission === null) throw resourceNotFound();
    if (submission.status === 'COMPLETED') return;
    if (submission.status === 'FAILED') {
      await this.ensureFailedElderFallback(context, submission, session);
      return;
    }
    if (!['UPLOADED', 'PROCESSING'].includes(submission.status)) {
      throw m03Conflict('VOICE_SUBMISSION_NOT_READY');
    }
    if (submission.objectDeletionPendingAt !== null || submission.objectDeletedAt !== null) {
      throw resourceNotFound();
    }
    if (!this.storage.isSealedObjectKey(
      submission.objectKey,
      context.organizationId,
      context.facilityId,
      submission.elderId,
      submission.id,
    )) throw resourceNotFound();
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    const processingAllowed = await this.database.client.$transaction(async (tx) => {
      const current = await tx.voiceSubmission.findFirst({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
        },
      });
      if (current === null) throw resourceNotFound();
      if (current.status === 'PROCESSING') {
        if (current.updatedAt > staleBefore) return false;
        const takeover = await tx.voiceSubmission.updateMany({
          where: {
            id: current.id,
            version: current.version,
            status: 'PROCESSING',
            updatedAt: { lte: staleBefore },
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
          },
          data: { version: { increment: 1 } },
        });
        if (takeover.count !== 1) return false;
      } else if (current.status === 'UPLOADED') {
        const processing = await tx.voiceSubmission.updateMany({
          where: {
            id: current.id,
            version: current.version,
            status: 'UPLOADED',
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
          },
          data: { status: 'PROCESSING', version: { increment: 1 } },
        });
        if (processing.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      } else {
        return false;
      }
      return (await this.guardSensitivePersistence(tx, context, current, session)) !== null;
    }, { isolationLevel: 'Serializable' });
    if (!processingAllowed) return;

    const providerContext = {
      correlationId: context.correlationId,
      provider: DETERMINISTIC_FAKE_PROVIDER.provider,
      model: DETERMINISTIC_FAKE_PROVIDER.transcriptionModel,
      promptVersion: DETERMINISTIC_FAKE_PROVIDER.promptVersion,
      schemaVersion: DETERMINISTIC_FAKE_PROVIDER.schemaVersion,
    };
    let transcriptResult;
    try {
      transcriptResult = await this.transcription.transcribe({
        objectKey: submission.objectKey,
        mimeType: submission.mimeType,
        ...(submission.fixtureKey === null ? {} : { fixtureKey: submission.fixtureKey }),
      }, providerContext);
    } catch (error) {
      try {
        await this.failTranscription(context, submission, session, failureCode(error));
      } catch (persistenceError) {
        await this.releaseProcessingAfterPersistenceFailure(context, submission).catch(() => undefined);
        throw persistenceError;
      }
      return;
    }

    if (!(await this.confirmProcessingMayContinue(context, submission, session))) return;

    if (submission.purpose === 'WORK_ORDER_COMPLETION') {
      await this.completeVoiceDraft(context, submission, session, transcriptResult);
      return;
    }

    let analysisResult;
    try {
      analysisResult = await this.analysis.generate<NeedAnalysisOutput>({
        instructionKey: 'need.analysis.v1',
        input: { fixtureKey: submission.fixtureKey, transcript: transcriptResult.text },
      }, { ...providerContext, model: DETERMINISTIC_FAKE_PROVIDER.analysisModel });
    } catch (error) {
      try {
        await this.failAnalysis(context, submission, session, transcriptResult, failureCode(error));
      } catch (persistenceError) {
        await this.releaseProcessingAfterPersistenceFailure(context, submission).catch(() => undefined);
        throw persistenceError;
      }
      return;
    }
    if (!(await this.confirmProcessingMayContinue(context, submission, session))) return;
    let output: NeedAnalysisOutput;
    let risk: ReturnType<typeof evaluateDeterministicNeedRisk>;
    let intents: ReturnType<typeof splitDeterministicNeedAnalysis>;
    try {
      output = needAnalysisOutputSchema.parse(analysisResult.output);
      risk = evaluateDeterministicNeedRisk(output);
      intents = splitDeterministicNeedAnalysis(output);
    } catch {
      try {
        await this.failAnalysis(
          context,
          submission,
          session,
          transcriptResult,
          'AI_OUTPUT_SCHEMA_INVALID',
        );
      } catch (persistenceError) {
        await this.releaseProcessingAfterPersistenceFailure(context, submission).catch(() => undefined);
        throw persistenceError;
      }
      return;
    }
    const explicitRiskIndex = intents.findIndex(
      (intent) => intent.category === 'HEALTH_CONCERN' || intent.category === 'EMERGENCY_CONCERN',
    );
    const riskBearingIndex = risk.requiresHumanReview
      ? explicitRiskIndex >= 0
        ? explicitRiskIndex
        : 0
      : -1;
    const completedAt = new Date();
    await this.database.client.$transaction(async (tx) => {
      const current = await this.guardSensitivePersistence(tx, context, submission, session);
      if (current === null) return;
      const transcript = await tx.transcript.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          voiceSubmissionId: submission.id,
          status: 'COMPLETED',
          text: transcriptResult.text,
          confidence: transcriptResult.confidence ?? null,
          durationMs: transcriptResult.durationMs ?? null,
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.transcriptionModel,
          providerVersion: '1.0',
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt,
        },
      });
      const analysis = await tx.aIAnalysis.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          transcriptId: transcript.id,
          status: 'COMPLETED',
          output,
          confidence: analysisResult.confidence ?? null,
          evidence: [...analysisResult.evidence],
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.analysisModel,
          promptVersion: DETERMINISTIC_FAKE_PROVIDER.promptVersion,
          schemaVersion: DETERMINISTIC_FAKE_PROVIDER.schemaVersion,
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt,
        },
      });
      const createdNeeds = [];
      for (const [index, intent] of intents.entries()) {
        const inheritsGlobalRisk = index === riskBearingIndex;
        const need = await tx.need.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            elderId: submission.elderId,
            voiceSubmissionId: submission.id,
            aiAnalysisId: analysis.id,
            source: 'VOICE',
            summary: intent.summary,
            category: intent.category,
            urgencySuggestion: intent.urgencySuggestion,
            priority: inheritsGlobalRisk ? risk.suggestedPriority : intent.urgencySuggestion,
            requiresHumanReview: inheritsGlobalRisk,
            safetyRuleCodes: inheritsGlobalRisk ? [...risk.matchedRuleCodes] : [],
            status: inheritsGlobalRisk ? 'REVIEW_REQUIRED' : 'DRAFT',
            idempotencyKey: `${submission.id}:need:${index}`,
            correlationId: context.correlationId,
          },
        });
        createdNeeds.push(need);
        await this.needs.recordNeedCreated(tx, context, session, need, `${submission.id}:${index}`);
      }
      const primary =
        (riskBearingIndex >= 0 ? createdNeeds[riskBearingIndex] : undefined) ??
        createdNeeds.find(
          (need) => need.category === 'HEALTH_CONCERN' || need.category === 'EMERGENCY_CONCERN',
        ) ??
        createdNeeds[0];
      if (primary === undefined) throw new Error('Validated AI output produced no needs');
      for (const related of createdNeeds.filter((need) => need.id !== primary.id)) {
        await tx.needLink.create({
          data: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            sourceNeedId: primary.id,
            targetNeedId: related.id,
            kind: 'SPLIT_SIBLING',
            correlationId: context.correlationId,
          },
        });
      }
      if (createdNeeds.length > 1) {
        await this.mutations.record(tx, context, session, {
          action: 'NEED.SPLIT',
          eventType: 'NEED.SPLIT',
          aggregateType: 'NEED',
          aggregateId: primary.id,
          aggregateVersion: primary.version,
          resourceType: 'NEED',
          payload: { needId: primary.id, linkedNeedCount: createdNeeds.length - 1 },
        });
      }
      await this.needs.createInitialWorkOrder(tx, context, session, primary, `voice-submission:${submission.id}`);
      const changed = await tx.voiceSubmission.updateMany({
        where: { id: submission.id, version: current.version, status: 'PROCESSING' },
        data: { status: 'COMPLETED', completedAt, failureCode: null, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    }, { isolationLevel: 'Serializable' });
  }

  private async completeVoiceDraft(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    transcriptResult: { text: string; confidence?: number; durationMs?: number },
  ): Promise<void> {
    const completedAt = new Date();
    await this.database.client.$transaction(async (tx) => {
      const current = await this.guardSensitivePersistence(tx, context, submission, session);
      if (current === null) return;
      await tx.transcript.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          voiceSubmissionId: submission.id,
          status: 'COMPLETED',
          text: completionDraftText(transcriptResult.text),
          confidence: transcriptResult.confidence ?? null,
          durationMs: transcriptResult.durationMs ?? null,
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.transcriptionModel,
          providerVersion: '1.0',
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt,
        },
      });
      const changed = await tx.voiceSubmission.updateMany({
        where: { id: submission.id, version: current.version, status: 'PROCESSING' },
        data: { status: 'COMPLETED', completedAt, failureCode: null, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_COMPLETION.DRAFT_CREATE',
        outcome: 'SUCCESS',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: 'AI_DRAFT_REQUIRES_CAREGIVER_REVIEW',
        correlationId: context.correlationId,
        metadata: { source: 'm03-fake-ai' },
      }, tx);
    }, { isolationLevel: 'Serializable' });
  }

  private async failTranscription(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    code: string,
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      const current = await this.guardSensitivePersistence(tx, context, submission, session);
      if (current === null) return false;
      await tx.transcript.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          voiceSubmissionId: submission.id,
          status: 'FAILED',
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.transcriptionModel,
          providerVersion: '1.0',
          failureCode: code,
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt: new Date(),
        },
      });
      const changed = await tx.voiceSubmission.updateMany({
        where: { id: submission.id, version: current.version, status: 'PROCESSING' },
        data: { status: 'FAILED', failureCode: code, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      if (submission.purpose === 'ELDER_REQUEST') {
        await this.needs.createElderOwnedManualInTransaction(
          tx,
          context,
          {
            elderId: submission.elderId,
            summary: '语音未能自动整理，请工作人员联系长者并人工确认需求。',
            category: 'OTHER',
            priority: 'PRIORITY',
            requiresHumanReview: true,
            reasonCode: 'TRANSCRIPTION_MANUAL_FALLBACK',
            idempotencyKey: `${submission.id}:manual-fallback`,
          },
          session,
          M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
        );
      }
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_TRANSCRIPTION.FAIL',
        outcome: 'FAILURE',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: code,
        correlationId: context.correlationId,
        metadata: { source: 'm03-fake-ai' },
      }, tx);
      return true;
    }, { isolationLevel: 'Serializable' });
  }

  private async failAnalysis(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    transcriptResult: { text: string; confidence?: number; durationMs?: number },
    code: string,
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      const current = await this.guardSensitivePersistence(tx, context, submission, session);
      if (current === null) return false;
      const transcript = await tx.transcript.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          voiceSubmissionId: submission.id,
          status: 'COMPLETED',
          text: transcriptResult.text,
          confidence: transcriptResult.confidence ?? null,
          durationMs: transcriptResult.durationMs ?? null,
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.transcriptionModel,
          providerVersion: '1.0',
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt: new Date(),
        },
      });
      await tx.aIAnalysis.create({
        data: {
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          transcriptId: transcript.id,
          status: 'FAILED',
          evidence: [],
          provider: DETERMINISTIC_FAKE_PROVIDER.provider,
          model: DETERMINISTIC_FAKE_PROVIDER.analysisModel,
          promptVersion: DETERMINISTIC_FAKE_PROVIDER.promptVersion,
          schemaVersion: DETERMINISTIC_FAKE_PROVIDER.schemaVersion,
          failureCode: code,
          retentionUntil: current.retentionUntil,
          correlationId: context.correlationId,
          completedAt: new Date(),
        },
      });
      const changed = await tx.voiceSubmission.updateMany({
        where: { id: submission.id, version: current.version, status: 'PROCESSING' },
        data: { status: 'FAILED', failureCode: code, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
      await this.needs.createElderOwnedManualInTransaction(
        tx,
        context,
        {
          elderId: submission.elderId,
          summary: '语音未能自动整理，请工作人员联系长者并人工确认需求。',
          category: 'OTHER',
          priority: 'PRIORITY',
          requiresHumanReview: true,
          reasonCode: 'ANALYSIS_MANUAL_FALLBACK',
          idempotencyKey: `${submission.id}:manual-fallback`,
        },
        session,
        M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
      );
      await this.audit.record({
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        actorUserId: session.userId,
        actorType: 'USER',
        action: 'VOICE_ANALYSIS.FAIL',
        outcome: 'FAILURE',
        resourceType: 'VOICE_SUBMISSION',
        resourceId: submission.id,
        reasonCode: code,
        correlationId: context.correlationId,
        metadata: { source: 'm03-fake-ai' },
      }, tx);
      return true;
    }, { isolationLevel: 'Serializable' });
  }

  private async confirmProcessingMayContinue(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      return (await this.guardSensitivePersistence(tx, context, submission, session)) !== null;
    }, { isolationLevel: 'Serializable' });
  }

  private async ensureFailedElderFallback(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
  ): Promise<void> {
    if (submission.purpose !== 'ELDER_REQUEST') return;
    await this.database.client.$transaction(async (tx) => {
      const now = new Date();
      const current = await tx.voiceSubmission.findFirst({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          submittedByUserId: session.userId,
          purpose: 'ELDER_REQUEST',
          status: 'FAILED',
        },
        include: { transcript: { select: { status: true } } },
      });
      if (current === null) return;
      const reasonCode = await this.currentSubmissionGuardReason(
        tx,
        context,
        current,
        session,
        now,
      );
      if (reasonCode !== null) {
        const cancelled = await tx.voiceSubmission.updateMany({
          where: {
            id: current.id,
            version: current.version,
            status: 'FAILED',
            objectDeletionPendingAt: null,
            objectDeletedAt: null,
          },
          data: {
            status: 'CANCELLED',
            failureCode: reasonCode,
            objectDeletionPendingAt: now,
            version: { increment: 1 },
          },
        });
        if (cancelled.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
        await this.audit.record({
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          actorUserId: session.userId,
          actorType: 'USER',
          action: 'VOICE_SUBMISSION.PROCESS_ABORT',
          outcome: 'DENIED',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: current.id,
          reasonCode,
          correlationId: context.correlationId,
          metadata: { source: 'm03-failed-fallback-guard' },
        }, tx);
        return;
      }
      await this.needs.createElderOwnedManualInTransaction(
        tx,
        context,
        {
          elderId: current.elderId,
          summary: '语音未能自动整理，请工作人员联系长者并人工确认需求。',
          category: 'OTHER',
          priority: 'PRIORITY',
          requiresHumanReview: true,
          reasonCode: current.transcript?.status === 'FAILED'
            ? 'TRANSCRIPTION_MANUAL_FALLBACK'
            : 'ANALYSIS_MANUAL_FALLBACK',
          idempotencyKey: `${current.id}:manual-fallback`,
        },
        session,
        M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
      );
    }, { isolationLevel: 'Serializable' });
  }

  private async releaseProcessingAfterPersistenceFailure(
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
  ): Promise<void> {
    await this.database.client.$transaction(async (tx) => {
      const current = await tx.voiceSubmission.findFirst({
        where: {
          id: submission.id,
          organizationId: context.organizationId,
          facilityId: context.facilityId,
          elderId: submission.elderId,
          status: 'PROCESSING',
          transcript: { is: null },
          needs: { none: {} },
        },
      });
      if (current === null) return;
      await tx.voiceSubmission.updateMany({
        where: {
          id: current.id,
          version: current.version,
          status: 'PROCESSING',
          transcript: { is: null },
          needs: { none: {} },
        },
        data: {
          status: 'UPLOADED',
          failureCode: null,
          version: { increment: 1 },
        },
      });
    }, { isolationLevel: 'Serializable' });
  }

  private async currentSubmissionGuardReason(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    current: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
    now: Date,
  ): Promise<string | null> {
    const consentRecords = await tx.consentRecord.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: current.elderId,
        purpose: { in: ['VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS'] },
        supersededAt: null,
        effectiveAt: { lte: now },
      },
      orderBy: [{ purpose: 'asc' }, { consentVersion: 'desc' }],
    });
    const elderAccessActive =
      current.purpose !== 'ELDER_REQUEST' ||
      await this.elderRequestAccessStillActive(tx, context, current, session, now);
    const caregiverAccessActive =
      current.purpose !== 'WORK_ORDER_COMPLETION' ||
      await this.caregiverCompletionAccessStillActive(tx, context, current, session, now);
    return (
      (!elderAccessActive ? 'ELDER_ACCESS_REVOKED' : null) ??
      (!caregiverAccessActive ? 'CAREGIVER_ACCESS_REVOKED' : null) ??
      voiceConsentFailureCode(consentRecords, now) ??
      (current.objectDeletionPendingAt !== null
        ? 'VOICE_OBJECT_DELETION_PENDING'
        : current.objectDeletedAt !== null
          ? 'VOICE_OBJECT_DELETED'
          : current.retentionUntil <= now
            ? 'VOICE_RETENTION_EXPIRED'
            : null)
    );
  }

  private async guardSensitivePersistence(
    tx: Prisma.TransactionClient,
    context: M03FacilityContext,
    submission: Prisma.VoiceSubmissionGetPayload<Record<string, never>>,
    session: AuthenticatedSession,
  ): Promise<Prisma.VoiceSubmissionGetPayload<Record<string, never>> | null> {
    const now = new Date();
    const current = await tx.voiceSubmission.findFirst({
      where: {
        id: submission.id,
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId: submission.elderId,
      },
    });
    if (current === null) throw resourceNotFound();
    if (current.status === 'CANCELLED') return null;
    if (current.status !== 'PROCESSING') {
      throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    }

    const reasonCode = await this.currentSubmissionGuardReason(
      tx,
      context,
      current,
      session,
      now,
    );
    if (reasonCode === null) return current;

    const changed = await tx.voiceSubmission.updateMany({
      where: {
        id: current.id,
        version: current.version,
        status: 'PROCESSING',
      },
      data: {
        status: 'CANCELLED',
        failureCode: reasonCode,
        objectDeletionPendingAt: current.objectDeletionPendingAt ?? now,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw m03Conflict('VOICE_SUBMISSION_VERSION_CONFLICT');
    await this.audit.record({
      organizationId: context.organizationId,
      facilityId: context.facilityId,
      actorUserId: session.userId,
      actorType: 'USER',
      action: 'VOICE_SUBMISSION.PROCESS_ABORT',
      outcome: 'DENIED',
      resourceType: 'VOICE_SUBMISSION',
      resourceId: current.id,
      reasonCode,
      correlationId: context.correlationId,
      metadata: {
        source: reasonCode.startsWith('CONSENT_')
          ? 'm03-consent-guard'
          : 'm03-current-access-guard',
      },
    }, tx);
    return null;
  }

  private async aggregate(context: M03FacilityContext, submissionId: string, elderId: string) {
    const now = new Date();
    const submission = await this.database.client.voiceSubmission.findFirst({
      where: { id: submissionId, organizationId: context.organizationId, facilityId: context.facilityId, elderId },
      include: {
        elder: {
          select: {
            consentRecords: {
              where: {
                purpose: { in: ['VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS'] },
                supersededAt: null,
              },
              orderBy: [{ purpose: 'asc' }, { consentVersion: 'desc' }],
              select: {
                purpose: true,
                decision: true,
                consentVersion: true,
                effectiveAt: true,
                expiresAt: true,
              },
            },
          },
        },
        transcript: { include: { analysis: true } },
        needs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (submission === null) throw resourceNotFound();
    const analysisConsentActive =
      voiceConsentFailureCode(submission.elder.consentRecords, now) === null;
    const primaryNeedIds = submission.needs.map((need) => need.id);
    const workOrder = primaryNeedIds.length === 0
      ? null
      : await this.database.client.workOrder.findFirst({
          where: {
            organizationId: context.organizationId,
            facilityId: context.facilityId,
            primaryNeedId: { in: primaryNeedIds },
          },
          include: WORK_ORDER_INCLUDE,
        });
    return {
      submission: mapVoiceSubmission(submission),
      ...(submission.transcript === null ? {} : { transcript: mapTranscriptMetadata(submission.transcript) }),
      ...(submission.transcript?.analysis === null ||
      submission.transcript?.analysis === undefined ||
      !analysisConsentActive ||
      submission.transcript.analysis.contentDeletedAt !== null ||
      submission.transcript.analysis.retentionUntil <= now
        ? {}
        : { analysis: mapAnalysis(submission.transcript.analysis) }),
      needs: submission.needs.map(mapNeed),
      workOrder: workOrder === null ? null : mapWorkOrder(workOrder),
    };
  }

  private async elderForSession(context: M03FacilityContext, session: AuthenticatedSession) {
    const elder = await this.database.client.elder.findFirst({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        portalUserId: session.userId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (elder === null) throw resourceNotFound();
    await this.elderAccess.assert(context, elder.id, session, 'BASIC');
    return elder;
  }

  private async assertVoiceConsents(context: M03FacilityContext, elderId: string): Promise<void> {
    const now = new Date();
    const records = await this.database.client.consentRecord.findMany({
      where: {
        organizationId: context.organizationId,
        facilityId: context.facilityId,
        elderId,
        purpose: { in: ['VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS'] },
        supersededAt: null,
        effectiveAt: { lte: now },
      },
      orderBy: [{ purpose: 'asc' }, { consentVersion: 'desc' }],
    });
    const reasonCode = voiceConsentFailureCode(records, now);
    if (reasonCode !== null) throw m03Conflict(reasonCode);
  }
}

function retentionUntil(): Date {
  return new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

function boundedSealLeaseUntil(uploadAuthorizedUntil: Date): Date {
  const leaseUntil = new Date(
    Math.min(uploadAuthorizedUntil.getTime(), Date.now() + SEAL_LEASE_MS),
  );
  if (leaseUntil <= new Date()) throw m03Conflict('VOICE_UPLOAD_AUTHORIZATION_EXPIRED');
  return leaseUntil;
}

function completionDraftText(transcript: string): string {
  const normalized = transcript.trim().replaceAll(/\s+/g, ' ');
  if (normalized.length === 0) throw new Error('Completion transcript cannot be empty');
  return normalized.slice(0, 2_000);
}

function failureCode(error: unknown): string {
  return error instanceof DeterministicFakeAIError ? error.code : 'FAKE_AI_PROCESSING_FAILED';
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}

function isM03ConflictCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly getResponse?: () => unknown; readonly response?: unknown };
  const response =
    typeof candidate.getResponse === 'function' ? candidate.getResponse() : candidate.response;
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    (response as { code?: unknown }).code === code
  );
}
