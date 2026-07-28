import { describe, expect, it, vi } from 'vitest';
import { HOT_WATER_DIZZINESS_ANALYSIS } from '@eldercare/ai';
import { M03_PERMISSIONS } from '@eldercare/authz';

import { VoiceWorkflowService } from './voice-workflow.service.js';

const organizationId = '10000000-0000-4000-8000-000000000001';
const facilityId = '20000000-0000-4000-8000-000000000001';
const elderId = '30000000-0000-4000-8000-000000000001';
const userId = '40000000-0000-4000-8000-000000000001';
const submissionId = '50000000-0000-4000-8000-000000000001';
const workOrderId = '51000000-0000-4000-8000-000000000001';
const staffProfileId = '63000000-0000-4000-8000-000000000001';
const shiftAssignmentId = '64000000-0000-4000-8000-000000000001';
const teamId = '65000000-0000-4000-8000-000000000001';
const checksumSha256 = 'a'.repeat(64);
const sealedNonce = '70000000-0000-4000-8000-000000000001';
const objectKey = `voice/sealed/${organizationId}/${facilityId}/${elderId}/${submissionId}/${sealedNonce}`;

interface ElderAccessRevocableHarness {
  revokeElderRole(): void;
  revokeElderPermission(): void;
  expireElderScope(): void;
  disableElderUser(): void;
  disableFacility(): void;
  disableOrganization(): void;
  unbindElderPortal(): void;
  dischargeElderStay(): void;
}

const ELDER_ACCESS_REVOCATIONS: ReadonlyArray<
  readonly [string, (harness: ElderAccessRevocableHarness) => void]
> = [
  ['the ELDER role is revoked', (harness) => harness.revokeElderRole()],
  ['voice submission permission is removed', (harness) => harness.revokeElderPermission()],
  ['the OWN_RECORD scope expires', (harness) => harness.expireElderScope()],
  ['the portal user is disabled', (harness) => harness.disableElderUser()],
  ['the target facility is disabled', (harness) => harness.disableFacility()],
  ['the target organization is disabled', (harness) => harness.disableOrganization()],
  ['the portal binding is removed', (harness) => harness.unbindElderPortal()],
  ['the active stay ends', (harness) => harness.dischargeElderStay()],
];

function activeCaregiverDataScopes(exactShift = true) {
  return [
    {
      kind: 'ACTIVE_SHIFT',
      scopeKey: `active-shift:${exactShift ? shiftAssignmentId : 'wrong-shift'}`,
      facilityId,
      resourceType: null,
      resourceId: null,
    },
    {
      kind: 'ASSIGNED_ELDER',
      scopeKey: `shift-elder:${shiftAssignmentId}:${elderId}`,
      facilityId,
      resourceType: 'ELDER',
      resourceId: elderId,
    },
  ];
}

function activeElderTransactionAccess() {
  return {
    facility: { findFirst: vi.fn().mockResolvedValue({ id: facilityId }) },
    elder: { findFirst: vi.fn().mockResolvedValue({ id: elderId }) },
    userRole: { findFirst: vi.fn().mockResolvedValue({ id: 'elder-role' }) },
  };
}

function completedDemo(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: submissionId,
    organizationId,
    facilityId,
    elderId,
    workOrderId: null,
    submittedByUserId: userId,
    purpose: 'ELDER_REQUEST',
    status: 'COMPLETED',
    bucket: 'eldercare-private',
    objectKey,
    uploadObjectKey: null,
    uploadAuthorizedUntil: null,
    sealCandidateObjectKey: null,
    sealCandidateSourceETag: null,
    sealLeaseToken: null,
    sealLeaseUntil: null,
    mimeType: 'audio/wav',
    declaredSizeBytes: 44,
    actualSizeBytes: 44,
    checksumSha256,
    fixtureKey: 'HOT_WATER_DIZZINESS_V1',
    failureCode: null,
    uploadedAt: new Date('2026-07-22T08:00:00.000Z'),
    completedAt: new Date('2026-07-22T08:00:01.000Z'),
    retentionUntil: new Date('2099-07-22T08:00:00.000Z'),
    objectDeletionPendingAt: null,
    objectDeletedAt: null,
    idempotencyKey: 'demo-idempotency-0001',
    correlationId: 'corr-demo-idempotency-0001',
    version: 3,
    createdAt: new Date('2026-07-22T08:00:00.000Z'),
    updatedAt: new Date('2026-07-22T08:00:01.000Z'),
    ...overrides,
  };
}

function harness() {
  const voiceSubmission = {
    findFirst: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  };
  const database = { client: { voiceSubmission } };
  const storage = {
    bucketName: 'eldercare-private',
    sealedObjectKey: vi.fn(() => objectKey),
    isSealedObjectKey: vi.fn(() => true),
    demoFixtureMetadata: vi.fn(() => ({
      mimeType: 'audio/wav' as const,
      sizeBytes: 44,
      checksumSha256,
    })),
    putDemoFixture: vi.fn().mockResolvedValue({ sizeBytes: 44, checksumSha256 }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const service = new VoiceWorkflowService(
    database as never,
    {} as never,
    storage as never,
    {} as never,
    {} as never,
    {} as never,
  );
  Reflect.set(service, 'elderForSession', vi.fn().mockResolvedValue({ id: elderId }));
  Reflect.set(service, 'assertVoiceConsents', vi.fn().mockResolvedValue(undefined));
  const aggregate = vi.fn().mockResolvedValue({ submission: { id: submissionId } });
  Reflect.set(service, 'aggregate', aggregate);
  return { service, voiceSubmission, storage, aggregate };
}

const context = { organizationId, facilityId, correlationId: 'corr-demo-request-0001' };
const session = { userId };
const input = {
  fixtureKey: 'HOT_WATER_DIZZINESS_V1' as const,
  idempotencyKey: 'demo-idempotency-0001',
};

describe('voice demo idempotency', () => {
  it('replays the winning record after a concurrent unique-key race', async () => {
    const { service, voiceSubmission, storage, aggregate } = harness();
    voiceSubmission.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedDemo());
    voiceSubmission.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.createDemo(context as never, input, session as never)).resolves.toEqual({
      submission: { id: submissionId },
    });
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(aggregate).toHaveBeenCalledWith(context, submissionId, elderId);
  });

  it('rejects an idempotency-key replay when the stored request fingerprint differs', async () => {
    const { service, voiceSubmission, aggregate } = harness();
    voiceSubmission.findFirst.mockResolvedValue(completedDemo({ fixtureKey: 'ANALYSIS_FAILURE_V1' }));

    await expect(service.createDemo(context as never, input, session as never)).rejects.toMatchObject({
      status: 409,
    });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('hides an idempotency record bound to another actor', async () => {
    const { service, voiceSubmission, aggregate } = harness();
    voiceSubmission.findFirst.mockResolvedValue(
      completedDemo({ submittedByUserId: '40000000-0000-4000-8000-000000000002' }),
    );

    await expect(service.createDemo(context as never, input, session as never)).rejects.toMatchObject({
      status: 404,
    });
    expect(aggregate).not.toHaveBeenCalled();
  });
});

describe('elder human-help routing', () => {
  it('uses the elder-owned need transaction instead of broad administrator scope', async () => {
    const createElderOwnedManual = vi.fn().mockResolvedValue({ id: 'need-id' });
    const createManual = vi.fn();
    const service = new VoiceWorkflowService(
      {} as never,
      {} as never,
      {} as never,
      { createElderOwnedManual, createManual } as never,
      {} as never,
      {} as never,
    );
    Reflect.set(service, 'elderForSession', vi.fn().mockResolvedValue({ id: elderId }));

    await expect(service.requestHumanHelp(
      context as never,
      {
        reasonCode: 'ELDER_REQUESTED_HUMAN',
        idempotencyKey: 'human-help-idempotency-0001',
      },
      session as never,
    )).resolves.toMatchObject({ humanReviewRequired: true, workOrder: null });

    expect(createElderOwnedManual).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        elderId,
        reasonCode: 'ELDER_REQUESTED_HUMAN',
      }),
      session,
      M03_PERMISSIONS.NEED_CREATE,
    );
    expect(createManual).not.toHaveBeenCalled();
  });
});

describe('voice consent revalidation', () => {
  it('refuses an audio read URL after consent is withdrawn and never signs storage access', async () => {
    const record = completedDemo();
    const createReadUrl = vi.fn();
    const service = new VoiceWorkflowService(
      { client: { voiceSubmission: { findFirst: vi.fn().mockResolvedValue(record) } } } as never,
      {} as never,
      { createReadUrl, isSealedObjectKey: vi.fn(() => true) } as never,
      {} as never,
      {} as never,
      { record: vi.fn() } as never,
    );
    Reflect.set(
      service,
      'assertVoiceConsents',
      vi.fn().mockRejectedValue(new Error('CONSENT_WITHDRAWN')),
    );

    await expect(
      service.createAudioReadUrl(context as never, submissionId, session as never),
    ).rejects.toThrow('CONSENT_WITHDRAWN');
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it('aborts atomically when consent is withdrawn while the analysis provider is running', async () => {
    let current: Omit<ReturnType<typeof completedDemo>, 'failureCode' | 'status' | 'version'> & {
      failureCode: string | null;
      status: string;
      version: number;
    } = completedDemo({
      status: 'UPLOADED',
      completedAt: null,
      failureCode: null,
      version: 1,
    });
    let consentActive = true;
    const transcriptCreate = vi.fn();
    const analysisCreate = vi.fn();
    const needCreate = vi.fn();
    const workOrderCreate = vi.fn();
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const activeConsents = () => [
      {
        purpose: 'VOICE_CAPTURE',
        decision: consentActive ? 'GRANTED' : 'WITHDRAWN',
        consentVersion: consentActive ? 1 : 2,
        expiresAt: null,
      },
      {
        purpose: 'TRANSCRIPTION_AI_ANALYSIS',
        decision: consentActive ? 'GRANTED' : 'WITHDRAWN',
        consentVersion: consentActive ? 1 : 2,
        expiresAt: null,
      },
    ];
    const voiceUpdateMany = vi.fn((input: { data: { status?: string; failureCode?: string } }) => {
      current = {
        ...current,
        ...(input.data.status === undefined ? {} : { status: input.data.status }),
        ...(input.data.failureCode === undefined ? {} : { failureCode: input.data.failureCode }),
        version: current.version + 1,
      };
      return Promise.resolve({ count: 1 });
    });
    const transaction = {
      ...activeElderTransactionAccess(),
      voiceSubmission: {
        findFirst: vi.fn(() => Promise.resolve(current)),
        updateMany: voiceUpdateMany,
      },
      consentRecord: { findMany: vi.fn(() => Promise.resolve(activeConsents())) },
      transcript: { create: transcriptCreate },
      aIAnalysis: { create: analysisCreate },
      need: { create: needCreate },
      needLink: { create: vi.fn() },
    };
    const database = {
      client: {
        voiceSubmission: {
          findFirst: vi.fn(() => Promise.resolve(current)),
          updateMany: voiceUpdateMany,
        },
        $transaction: vi.fn(
          (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
        ),
      },
    };
    const analysisStarted = deferred<void>();
    const analysisResult = deferred<{
      output: typeof HOT_WATER_DIZZINESS_ANALYSIS;
      confidence: number;
      evidence: string[];
    }>();
    const needs = {
      recordNeedCreated: vi.fn(),
      createInitialWorkOrder: workOrderCreate,
      createManual: vi.fn(),
      createElderOwnedManualInTransaction: vi.fn(),
    };
    const service = new VoiceWorkflowService(
      database as never,
      {} as never,
      { isSealedObjectKey: vi.fn(() => true) } as never,
      needs as never,
      { record: vi.fn() } as never,
      { record: auditRecord } as never,
    );
    Reflect.set(service, 'transcription', {
      transcribe: vi.fn().mockResolvedValue({
        text: 'sensitive transcript that must never be persisted',
        confidence: 0.98,
        durationMs: 3_200,
      }),
    });
    Reflect.set(service, 'analysis', {
      generate: vi.fn(() => {
        analysisStarted.resolve();
        return analysisResult.promise;
      }),
    });
    const process = Reflect.get(service, 'process') as (
      processContext: typeof context,
      id: string,
      processSession: typeof session,
    ) => Promise<void>;

    const processing = process.call(service, context, submissionId, session);
    await analysisStarted.promise;
    consentActive = false;
    analysisResult.resolve({
      output: HOT_WATER_DIZZINESS_ANALYSIS,
      confidence: 0.96,
      evidence: ['sensitive evidence'],
    });
    await processing;

    expect(current.status).toBe('CANCELLED');
    expect(current.failureCode).toBe('CONSENT_WITHDRAWN');
    expect(transcriptCreate).not.toHaveBeenCalled();
    expect(analysisCreate).not.toHaveBeenCalled();
    expect(needCreate).not.toHaveBeenCalled();
    expect(needs.recordNeedCreated).not.toHaveBeenCalled();
    expect(workOrderCreate).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VOICE_SUBMISSION.PROCESS_ABORT',
        outcome: 'DENIED',
        reasonCode: 'CONSENT_WITHDRAWN',
      }),
      transaction,
    );
  });

  it('refuses transcript content after consent is withdrawn', async () => {
    const transcript = {
      id: '60000000-0000-4000-8000-000000000001',
      elderId,
    };
    const auditRecord = vi.fn();
    const service = new VoiceWorkflowService(
      { client: { transcript: { findFirst: vi.fn().mockResolvedValue(transcript) } } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { record: auditRecord } as never,
    );
    Reflect.set(
      service,
      'assertVoiceConsents',
      vi.fn().mockRejectedValue(new Error('CONSENT_WITHDRAWN')),
    );

    await expect(
      service.getTranscriptPrivate(context as never, submissionId, session as never),
    ).rejects.toThrow('CONSENT_WITHDRAWN');
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('checks current elder consent before caregiver completion upload and finalize paths', async () => {
    const service = new VoiceWorkflowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const subject = { elderId, purpose: 'WORK_ORDER_COMPLETION', workOrderId: submissionId };
    Reflect.set(service, 'assertCaregiverCompletionAccess', vi.fn().mockResolvedValue(subject));
    Reflect.set(
      service,
      'assertVoiceConsents',
      vi.fn().mockRejectedValue(new Error('CONSENT_WITHDRAWN')),
    );
    const createUploadIntentForSubject = vi.fn();
    const finalizeForSubject = vi.fn();
    Reflect.set(service, 'createUploadIntentForSubject', createUploadIntentForSubject);
    Reflect.set(service, 'finalizeForSubject', finalizeForSubject);

    await expect(
      service.createCaregiverCompletionUploadIntent(
        context as never,
        submissionId,
        {
          mimeType: 'audio/webm',
          sizeBytes: 64,
          idempotencyKey: 'care-completion-consent-0001',
        },
        session as never,
      ),
    ).rejects.toThrow('CONSENT_WITHDRAWN');
    await expect(
      service.finalizeCaregiverCompletion(
        context as never,
        submissionId,
        '60000000-0000-4000-8000-000000000001',
        { expectedVersion: 1 },
        session as never,
      ),
    ).rejects.toThrow('CONSENT_WITHDRAWN');
    expect(createUploadIntentForSubject).not.toHaveBeenCalled();
    expect(finalizeForSubject).not.toHaveBeenCalled();
  });
});

describe('staging to sealed finalization', () => {
  it('grants one exclusive ETag-bound copy lease and treats progressed retries as accepted', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const sealedKey = objectKey;
    let stagingETag = '"etag-v1"';
    let state: Omit<
      ReturnType<typeof completedDemo>,
      | 'completedAt'
      | 'objectKey'
      | 'sealCandidateObjectKey'
      | 'sealCandidateSourceETag'
      | 'sealLeaseToken'
      | 'sealLeaseUntil'
      | 'status'
      | 'uploadedAt'
      | 'version'
    > & {
      completedAt: Date | null;
      objectKey: string;
      sealCandidateObjectKey: string | null;
      sealCandidateSourceETag: string | null;
      sealLeaseToken: string | null;
      sealLeaseUntil: Date | null;
      status: string;
      uploadedAt: Date | null;
      version: number;
    } = completedDemo({
      status: 'UPLOAD_PENDING',
      objectKey: stagingKey,
      uploadObjectKey: stagingKey,
      uploadAuthorizedUntil: new Date('2099-07-22T08:05:00.000Z'),
      sealCandidateObjectKey: null,
      sealCandidateSourceETag: null,
      sealLeaseToken: null,
      sealLeaseUntil: null,
      uploadedAt: null,
      completedAt: null,
      version: 1,
    });
    const copyStarted = deferred<void>();
    const copyResult = deferred<{
      contentLength: number;
      contentType: string;
      checksumSha256: string;
      eTag: string;
    }>();
    const updateMany = vi.fn((request: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (request.data.status === 'UPLOADED') {
        if (
          state.status !== 'UPLOAD_PENDING' ||
          request.where?.['sealLeaseToken'] !== state.sealLeaseToken ||
          request.where?.['sealLeaseUntil'] !== state.sealLeaseUntil
        ) return Promise.resolve({ count: 0 });
        state = {
          ...state,
          objectKey: request.data.objectKey as string,
          sealCandidateObjectKey: null,
          sealCandidateSourceETag: null,
          sealLeaseToken: null,
          sealLeaseUntil: null,
          status: 'UPLOADED',
          version: state.version + 1,
        };
        return Promise.resolve({ count: 1 });
      }
      if (
        request.data.sealLeaseToken !== undefined &&
        request.data.sealCandidateObjectKey === undefined
      ) {
        if (
          state.status !== 'UPLOAD_PENDING' ||
          request.where?.['sealLeaseToken'] !== state.sealLeaseToken ||
          request.where?.['sealLeaseUntil'] !== state.sealLeaseUntil
        ) return Promise.resolve({ count: 0 });
        state = {
          ...state,
          sealLeaseToken: request.data.sealLeaseToken as string,
          sealLeaseUntil: request.data.sealLeaseUntil as Date,
        };
        return Promise.resolve({ count: 1 });
      }
      if (request.data.sealCandidateObjectKey !== undefined) {
        if (state.status !== 'UPLOAD_PENDING' || state.sealCandidateObjectKey !== null) {
          return Promise.resolve({ count: 0 });
        }
        state = {
          ...state,
          sealCandidateObjectKey: request.data.sealCandidateObjectKey as string,
          sealCandidateSourceETag: request.data.sealCandidateSourceETag as string,
          sealLeaseToken: request.data.sealLeaseToken as string,
          sealLeaseUntil: request.data.sealLeaseUntil as Date,
        };
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    });
    const storage = {
      bucketName: 'eldercare-private',
      stagingObjectKey: vi.fn(() => stagingKey),
      sealedObjectKey: vi.fn(() => sealedKey),
      isStagingObjectKey: vi.fn((key: string) => key === stagingKey),
      isSealedObjectKey: vi.fn((key: string) => key === sealedKey),
      inspect: vi.fn(() => Promise.resolve({
        contentLength: 44,
        contentType: 'audio/wav',
        checksumSha256,
        eTag: stagingETag,
      })),
      assertUploadedObject: vi.fn(),
      copyToSealed: vi.fn((_source: string, _destination: string, sourceETag: string) => {
        copyStarted.resolve();
        expect(sourceETag).toBe('"etag-v1"');
        return copyResult.promise;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const database = {
      client: {
        voiceSubmission: {
          findFirst: vi.fn(() => Promise.resolve({ ...state })),
          findUnique: vi.fn(() => Promise.resolve({ ...state })),
          updateMany,
        },
        $transaction: vi.fn((callback: (client: {
          voiceSubmission: {
            findFirst: () => Promise<typeof state>;
            updateMany: typeof updateMany;
          };
          consentRecord: { findMany: () => Promise<unknown[]> };
          facility: { findFirst: () => Promise<{ id: string }> };
          elder: { findFirst: () => Promise<{ id: string }> };
          userRole: { findFirst: () => Promise<{ id: string }> };
        }) => Promise<unknown>) => callback({
          ...activeElderTransactionAccess(),
          voiceSubmission: {
            findFirst: () => Promise.resolve({ ...state }),
            updateMany,
          },
          consentRecord: {
            findMany: () => Promise.resolve([
              {
                purpose: 'VOICE_CAPTURE',
                decision: 'GRANTED',
                consentVersion: 1,
                expiresAt: null,
              },
              {
                purpose: 'TRANSCRIPTION_AI_ANALYSIS',
                decision: 'GRANTED',
                consentVersion: 1,
                expiresAt: null,
              },
            ]),
          },
        })),
      },
    };
    const service = new VoiceWorkflowService(
      database as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const process = vi.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'process', process);
    const finalize = Reflect.get(service, 'finalizeForSubject') as (
      finalizeContext: typeof context,
      id: string,
      finalizeInput: { expectedVersion: number; checksumSha256?: string },
      finalizeSession: typeof session,
      subject: { elderId: string; purpose: 'ELDER_REQUEST'; workOrderId: null },
    ) => Promise<void>;
    const subject = { elderId, purpose: 'ELDER_REQUEST' as const, workOrderId: null };

    const first = finalize.call(
      service,
      context,
      submissionId,
      { expectedVersion: 1, checksumSha256 },
      session,
      subject,
    );
    await copyStarted.promise;
    stagingETag = '"etag-v2"';
    await expect(
      finalize.call(
        service,
        context,
        submissionId,
        { expectedVersion: 1, checksumSha256 },
        session,
        subject,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(storage.inspect).toHaveBeenCalledOnce();
    expect(storage.copyToSealed).toHaveBeenCalledOnce();

    copyResult.resolve({
      contentLength: 44,
      contentType: 'audio/wav',
      checksumSha256,
      eTag: '"sealed-etag-v1"',
    });
    await first;
    expect(state).toMatchObject({
      status: 'UPLOADED',
      objectKey: sealedKey,
      sealCandidateObjectKey: null,
      sealCandidateSourceETag: null,
      sealLeaseToken: null,
      sealLeaseUntil: null,
      version: 2,
    });
    expect(process).toHaveBeenCalledOnce();

    state = { ...state, status: 'PROCESSING', version: 3 };
    await expect(
      finalize.call(
        service,
        context,
        submissionId,
        { expectedVersion: 1, checksumSha256 },
        session,
        subject,
      ),
    ).resolves.toBeUndefined();
    expect(storage.copyToSealed).toHaveBeenCalledOnce();

    state = {
      ...state,
      status: 'UPLOAD_PENDING',
      objectKey: stagingKey,
      sealCandidateObjectKey: null,
      sealCandidateSourceETag: null,
      sealLeaseToken: null,
      sealLeaseUntil: null,
      uploadedAt: null,
      completedAt: null,
      version: 1,
    };
    storage.copyToSealed.mockReset();
    storage.delete.mockClear();
    process.mockClear();
    const lateOwnerStarted = deferred<void>();
    const lateOwnerResult = deferred<{
      contentLength: number;
      contentType: string;
      checksumSha256: string;
      eTag: string;
    }>();
    storage.copyToSealed
      .mockImplementationOnce(() => {
        lateOwnerStarted.resolve();
        return lateOwnerResult.promise;
      })
      .mockResolvedValueOnce({
        contentLength: 44,
        contentType: 'audio/wav',
        checksumSha256,
        eTag: '"sealed-etag-v2"',
      });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T08:00:00.000Z'));
    try {
      const staleOwner = finalize.call(
        service,
        context,
        submissionId,
        { expectedVersion: 1, checksumSha256 },
        session,
        subject,
      );
      await lateOwnerStarted.promise;
      vi.advanceTimersByTime(31_000);

      await expect(
        finalize.call(
          service,
          context,
          submissionId,
          { expectedVersion: 1, checksumSha256 },
          session,
          subject,
        ),
      ).resolves.toBeUndefined();
      expect(state).toMatchObject({ status: 'UPLOADED', objectKey: sealedKey, version: 2 });

      lateOwnerResult.resolve({
        contentLength: 44,
        contentType: 'audio/wav',
        checksumSha256,
        eTag: '"late-owner-etag"',
      });
      await expect(staleOwner).rejects.toMatchObject({ status: 409 });
      expect(storage.delete).not.toHaveBeenCalledWith(sealedKey);
      expect(state).toMatchObject({ status: 'UPLOADED', objectKey: sealedKey, version: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels and fences a sealed copy when the caregiver role is revoked in flight', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const sealedKey = objectKey;
    let caregiverRoleActive = true;
    let state: Omit<
      ReturnType<typeof completedDemo>,
      | 'failureCode'
      | 'objectDeletionPendingAt'
      | 'sealCandidateObjectKey'
      | 'sealCandidateSourceETag'
      | 'sealLeaseToken'
      | 'sealLeaseUntil'
    > & {
      failureCode: string | null;
      objectDeletionPendingAt: Date | null;
      sealCandidateObjectKey: string | null;
      sealCandidateSourceETag: string | null;
      sealLeaseToken: string | null;
      sealLeaseUntil: Date | null;
    } = completedDemo({
      status: 'UPLOAD_PENDING',
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      objectKey: stagingKey,
      uploadObjectKey: stagingKey,
      uploadAuthorizedUntil: new Date('2099-07-22T08:05:00.000Z'),
      sealCandidateObjectKey: null,
      sealCandidateSourceETag: null,
      sealLeaseToken: null,
      sealLeaseUntil: null,
      uploadedAt: null,
      completedAt: null,
      failureCode: null,
      version: 1,
    });
    const copyStarted = deferred<void>();
    const copyResult = deferred<{
      contentLength: number;
      contentType: string;
      checksumSha256: string;
      eTag: string;
    }>();
    const updateMany = vi.fn((request: { data: Record<string, unknown> }) => {
      if (request.data.sealCandidateObjectKey !== undefined) {
        state = {
          ...state,
          sealCandidateObjectKey: request.data.sealCandidateObjectKey as string,
          sealCandidateSourceETag: request.data.sealCandidateSourceETag as string,
          sealLeaseToken: request.data.sealLeaseToken as string,
          sealLeaseUntil: request.data.sealLeaseUntil as Date,
        };
        return Promise.resolve({ count: 1 });
      }
      if (request.data.status === 'CANCELLED') {
        state = {
          ...state,
          status: 'CANCELLED',
          failureCode: request.data.failureCode as string,
          objectDeletionPendingAt: request.data.objectDeletionPendingAt as Date,
          version: state.version + 1,
        };
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    });
    const transaction = {
      voiceSubmission: {
        findFirst: vi.fn(() => Promise.resolve({ ...state })),
        updateMany,
      },
      consentRecord: {
        findMany: vi.fn(() => Promise.resolve([
          { purpose: 'VOICE_CAPTURE', decision: 'GRANTED', consentVersion: 1, expiresAt: null },
          {
            purpose: 'TRANSCRIPTION_AI_ANALYSIS',
            decision: 'GRANTED',
            consentVersion: 1,
            expiresAt: null,
          },
        ])),
      },
      staffProfile: {
        findFirst: vi.fn(() => Promise.resolve({
          id: staffProfileId,
          teamMemberships: [{ teamId }],
        })),
      },
      userRole: {
        findFirst: vi.fn(() => Promise.resolve(caregiverRoleActive
          ? { id: 'caregiver-role', dataScopes: activeCaregiverDataScopes() }
          : null)),
      },
      workOrder: {
        findFirst: vi.fn(() => Promise.resolve({
          elderId,
          elder: {
            stays: [{ bed: { room: { floorId: 'floor-1', zoneId: 'zone-1' } } }],
          },
          assignments: [{ shiftAssignmentId, targetTeamId: teamId }],
        })),
      },
      team: { findFirst: vi.fn(() => Promise.resolve({ id: teamId })) },
      shiftAssignment: {
        findFirst: vi.fn(() => Promise.resolve({ id: shiftAssignmentId })),
      },
    };
    const database = {
      client: {
        voiceSubmission: {
          findFirst: vi.fn(() => Promise.resolve({ ...state })),
          findUnique: vi.fn(() => Promise.resolve({ ...state })),
          updateMany,
        },
        $transaction: vi.fn(
          (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
        ),
      },
    };
    const storage = {
      isStagingObjectKey: vi.fn((key: string) => key === stagingKey),
      isSealedObjectKey: vi.fn((key: string) => key === sealedKey),
      inspect: vi.fn(() => Promise.resolve({
        contentLength: 44,
        contentType: 'audio/wav',
        checksumSha256,
        eTag: '"staging-etag"',
      })),
      assertUploadedObject: vi.fn(),
      sealedObjectKey: vi.fn(() => sealedKey),
      copyToSealed: vi.fn(() => {
        copyStarted.resolve();
        return copyResult.promise;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const service = new VoiceWorkflowService(
      database as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      { record: auditRecord } as never,
    );
    const process = vi.fn().mockResolvedValue(undefined);
    Reflect.set(service, 'process', process);
    const finalize = Reflect.get(service, 'finalizeForSubject') as (
      finalizeContext: typeof context,
      id: string,
      finalizeInput: { expectedVersion: number; checksumSha256?: string },
      finalizeSession: typeof session,
      subject: { elderId: string; purpose: 'WORK_ORDER_COMPLETION'; workOrderId: string },
    ) => Promise<void>;

    const finalizing = finalize.call(
      service,
      context,
      submissionId,
      { expectedVersion: 1, checksumSha256 },
      session,
      { elderId, purpose: 'WORK_ORDER_COMPLETION', workOrderId },
    );
    await copyStarted.promise;
    caregiverRoleActive = false;
    copyResult.resolve({
      contentLength: 44,
      contentType: 'audio/wav',
      checksumSha256,
      eTag: '"sealed-etag"',
    });

    await expect(finalizing).rejects.toMatchObject({ status: 404 });
    expect(state).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
    expect(state.objectDeletionPendingAt).toBeInstanceOf(Date);
    expect(process).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalledWith(sealedKey);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VOICE_SUBMISSION.SEAL_ABORT',
        reasonCode: 'CAREGIVER_ACCESS_REVOKED',
      }),
      transaction,
    );
  });
});

describe('elder request current authorization', () => {
  it('queries the active portal binding, stay, ELDER role, exact permission and current OWN_RECORD scope', async () => {
    const now = new Date('2026-07-22T08:00:00.000Z');
    const facilityFindFirst = vi.fn().mockResolvedValue({ id: facilityId });
    const elderFindFirst = vi.fn().mockResolvedValue({ id: elderId });
    const userRoleFindFirst = vi.fn().mockResolvedValue({ id: 'elder-role' });
    const service = new VoiceWorkflowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const accessStillActive = Reflect.get(service, 'elderRequestAccessStillActive') as (
      tx: unknown,
      accessContext: typeof context,
      submission: ReturnType<typeof completedDemo>,
      accessSession: typeof session,
      checkedAt: Date,
    ) => Promise<boolean>;

    await expect(accessStillActive.call(service, {
      facility: { findFirst: facilityFindFirst },
      elder: { findFirst: elderFindFirst },
      userRole: { findFirst: userRoleFindFirst },
    }, context, completedDemo({ status: 'PROCESSING' }), session, now)).resolves.toBe(true);

    expect(facilityFindFirst).toHaveBeenCalledWith({
      where: {
        id: facilityId,
        organizationId,
        status: 'ACTIVE',
        organization: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    expect(elderFindFirst).toHaveBeenCalledWith({
      where: {
        id: elderId,
        organizationId,
        facilityId,
        portalUserId: userId,
        status: 'ACTIVE',
        stays: {
          some: {
            organizationId,
            facilityId,
            status: 'ACTIVE',
            admittedAt: { lte: now },
            OR: [{ dischargedAt: null }, { dischargedAt: { gt: now } }],
          },
        },
      },
      select: { id: true },
    });
    expect(userRoleFindFirst).toHaveBeenCalledWith({
      where: {
        userId,
        organizationId,
        user: { status: 'ACTIVE' },
        organization: { status: 'ACTIVE' },
        activeFrom: { lte: now },
        revokedAt: null,
        role: {
          code: 'ELDER',
          rolePermissions: {
            some: { permission: { code: 'voice_submission.create' } },
          },
        },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            dataScopes: {
              some: {
                organizationId,
                kind: 'OWN_RECORD',
                validFrom: { lte: now },
                AND: [
                  { OR: [{ facilityId: null }, { facilityId }] },
                  { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
                ],
              },
            },
          },
        ],
      },
      select: { id: true },
    });
  });

  it.each(ELDER_ACCESS_REVOCATIONS)(
    'aborts the ETag-bound sealed commit when %s and keeps retries side-effect safe',
    async (_caseName, revokeAccess) => {
      const harness = sealedCommitHarness();
      const committing = harness.commit();
      await harness.authorizationStarted;
      revokeAccess(harness);
      harness.releaseAuthorization();

      await expect(committing).resolves.toBe('ABORTED');
      expect(harness.current()).toMatchObject({
        status: 'CANCELLED',
        failureCode: 'ELDER_ACCESS_REVOKED',
        version: 2,
      });
      expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
      expect(harness.auditRecord).toHaveBeenCalledOnce();
      expect(harness.auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOICE_SUBMISSION.SEAL_ABORT',
          outcome: 'DENIED',
          reasonCode: 'ELDER_ACCESS_REVOKED',
          metadata: { source: 'm03-seal-guard' },
        }),
        expect.anything(),
      );
      for (const write of harness.sensitiveWrites) expect(write).not.toHaveBeenCalled();
      expect(harness.database.client.$transaction).toHaveBeenNthCalledWith(
        1,
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );

      await expect(harness.commit()).resolves.toBe('CONFLICT');
      expect(harness.current()).toMatchObject({ status: 'CANCELLED', version: 2 });
      expect(harness.updateMany).toHaveBeenCalledOnce();
      expect(harness.auditRecord).toHaveBeenCalledOnce();
      for (const write of harness.sensitiveWrites) expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(ELDER_ACCESS_REVOCATIONS)(
    'reauthorizes an already sealed replay when %s',
    async (_caseName, revokeAccess) => {
      const harness = sealedCommitHarness('UPLOADED');
      const replaying = harness.commit();
      await harness.authorizationStarted;
      revokeAccess(harness);
      harness.releaseAuthorization();

      await expect(replaying).resolves.toBe('ABORTED');
      expect(harness.current()).toMatchObject({
        status: 'CANCELLED',
        failureCode: 'ELDER_ACCESS_REVOKED',
      });
      expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
      expect(harness.auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOICE_SUBMISSION.SEAL_ABORT',
          outcome: 'DENIED',
        }),
        expect.anything(),
      );
    },
  );

  it.each(ELDER_ACCESS_REVOCATIONS)(
    'returns no upload capability when %s after presigning',
    async (_caseName, revokeAccess) => {
      const harness = uploadAuthorizationHarness();
      const authorizing = harness.authorize();
      await harness.authorizationStarted;
      revokeAccess(harness);
      harness.releaseAuthorization();

      await expect(authorizing).rejects.toMatchObject({ status: 404 });
      expect(harness.createUpload).toHaveBeenCalledOnce();
      expect(harness.current()).toMatchObject({
        status: 'CANCELLED',
        failureCode: 'ELDER_ACCESS_REVOKED',
        uploadAuthorizedUntil: null,
      });
      expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
      expect(harness.auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOICE_SUBMISSION.UPLOAD_AUTHORIZATION_ABORT',
          outcome: 'DENIED',
          reasonCode: 'ELDER_ACCESS_REVOKED',
        }),
        expect.anything(),
      );
    },
  );

  it.each(ELDER_ACCESS_REVOCATIONS)(
    'fails closed before either provider runs when %s',
    async (_caseName, revokeAccess) => {
      const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS);
      revokeAccess(harness);

      await harness.process();

      expect(harness.transcribe).not.toHaveBeenCalled();
      expect(harness.current()).toMatchObject({
        status: 'CANCELLED',
        failureCode: 'ELDER_ACCESS_REVOKED',
      });
      expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
      expect(harness.transcriptCreate).not.toHaveBeenCalled();
      expect(harness.analysisCreate).not.toHaveBeenCalled();
      expect(harness.createdNeeds).toHaveLength(0);
      expect(harness.needLinkCreate).not.toHaveBeenCalled();
      expect(harness.needs.recordNeedCreated).not.toHaveBeenCalled();
      expect(harness.needs.createInitialWorkOrder).not.toHaveBeenCalled();
      expect(harness.needs.createManual).not.toHaveBeenCalled();
      expect(harness.mutationRecord).not.toHaveBeenCalled();
      expect(harness.auditRecord).toHaveBeenCalledOnce();
      expect(harness.auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOICE_SUBMISSION.PROCESS_ABORT',
          outcome: 'DENIED',
          reasonCode: 'ELDER_ACCESS_REVOKED',
          metadata: { source: 'm03-current-access-guard' },
        }),
        harness.transaction,
      );
      expect(harness.database.client.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
    },
  );

  it.each(ELDER_ACCESS_REVOCATIONS)(
    'discards held provider output when %s',
    async (_caseName, revokeAccess) => {
      const analysisStarted = deferred<void>();
      const analysisResult = deferred<{
        output: typeof HOT_WATER_DIZZINESS_ANALYSIS;
        confidence: number;
        evidence: string[];
      }>();
      const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
        analysisGenerate: () => {
          analysisStarted.resolve();
          return analysisResult.promise;
        },
      });

      const processing = harness.process();
      await analysisStarted.promise;
      revokeAccess(harness);
      analysisResult.resolve({
        output: HOT_WATER_DIZZINESS_ANALYSIS,
        confidence: 0.96,
        evidence: ['provider evidence that must not persist'],
      });
      await processing;

      expect(harness.transcribe).toHaveBeenCalledOnce();
      expect(harness.current()).toMatchObject({
        status: 'CANCELLED',
        failureCode: 'ELDER_ACCESS_REVOKED',
      });
      expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
      expect(harness.transcriptCreate).not.toHaveBeenCalled();
      expect(harness.analysisCreate).not.toHaveBeenCalled();
      expect(harness.createdNeeds).toHaveLength(0);
      expect(harness.needLinkCreate).not.toHaveBeenCalled();
      expect(harness.needs.recordNeedCreated).not.toHaveBeenCalled();
      expect(harness.needs.createInitialWorkOrder).not.toHaveBeenCalled();
      expect(harness.needs.createManual).not.toHaveBeenCalled();
      expect(harness.mutationRecord).not.toHaveBeenCalled();
      expect(harness.auditRecord).toHaveBeenCalledOnce();
      expect(harness.auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'VOICE_SUBMISSION.PROCESS_ABORT',
          outcome: 'DENIED',
          reasonCode: 'ELDER_ACCESS_REVOKED',
          metadata: { source: 'm03-current-access-guard' },
        }),
        harness.transaction,
      );
    },
  );
});

describe('caregiver completion authorization', () => {
  it('validates the claimed assignment shift even when the general elder-access lookup finds another overlap first', async () => {
    const shiftAssignmentFindFirst = vi.fn().mockResolvedValue({ id: shiftAssignmentId });
    const elderAccessAssert = vi.fn().mockResolvedValue({
      shiftAssignmentId: '64000000-0000-4000-8000-000000000099',
    });
    const transaction = {
      staffProfile: {
        findFirst: vi.fn().mockResolvedValue({
          id: staffProfileId,
          teamMemberships: [{ teamId }],
        }),
      },
      userRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'caregiver-role',
          dataScopes: activeCaregiverDataScopes(),
        }),
      },
      workOrder: {
        findFirst: vi.fn().mockResolvedValue({
          elderId,
          elder: {
            stays: [{ bed: { room: { floorId: 'floor-1', zoneId: 'zone-1' } } }],
          },
          assignments: [{ shiftAssignmentId, targetTeamId: teamId }],
        }),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: teamId }) },
      shiftAssignment: { findFirst: shiftAssignmentFindFirst },
    };
    const service = new VoiceWorkflowService(
      {
        client: {
          $transaction: vi.fn(
            (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
          ),
        },
      } as never,
      { assert: elderAccessAssert } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const assertAccess = Reflect.get(service, 'assertCaregiverCompletionAccess') as (
      accessContext: typeof context,
      id: string,
      accessSession: typeof session,
    ) => Promise<unknown>;

    await expect(
      assertAccess.call(service, context, workOrderId, session),
    ).resolves.toEqual({
      elderId,
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
    });
    expect(elderAccessAssert).toHaveBeenCalledOnce();
    const shiftLookup: unknown = shiftAssignmentFindFirst.mock.calls[0]?.[0];
    expect(shiftLookup).toMatchObject({
      where: { id: shiftAssignmentId, shift: { teamId } },
    });
  });

  it.each([
    { caseName: 'target-team membership ended', memberships: [] as Array<{ teamId: string }>, team: { id: teamId } },
    { caseName: 'target team is inactive', memberships: [{ teamId }], team: null },
  ])('rejects completion upload intent when $caseName', async ({ memberships, team }) => {
    const transaction = {
      staffProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: staffProfileId, teamMemberships: memberships }),
      },
      userRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'caregiver-role',
          dataScopes: activeCaregiverDataScopes(),
        }),
      },
      workOrder: {
        findFirst: vi.fn().mockResolvedValue({
          elderId,
          elder: {
            stays: [{ bed: { room: { floorId: 'floor-1', zoneId: 'zone-1' } } }],
          },
          assignments: [{ shiftAssignmentId, targetTeamId: teamId }],
        }),
      },
      team: { findFirst: vi.fn().mockResolvedValue(team) },
      shiftAssignment: { findFirst: vi.fn().mockResolvedValue({ id: shiftAssignmentId }) },
    };
    const service = new VoiceWorkflowService(
      {
        client: {
          $transaction: vi.fn(
            (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
          ),
        },
      } as never,
      { assert: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const createUploadIntentForSubject = vi.fn();
    Reflect.set(service, 'createUploadIntentForSubject', createUploadIntentForSubject);
    Reflect.set(service, 'assertVoiceConsents', vi.fn().mockResolvedValue(undefined));

    await expect(
      service.createCaregiverCompletionUploadIntent(
        context,
        workOrderId,
        {
          mimeType: 'audio/wav',
          sizeBytes: 44,
          idempotencyKey: `invalid-completion-access-${memberships.length}-${team === null}`,
        },
        session as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(createUploadIntentForSubject).not.toHaveBeenCalled();
  });

  it.each(['membership ends', 'elder is discharged'] as const)(
    'rechecks access after a progressed finalize when %s and withholds the completed draft',
    async (accessChange) => {
    let membershipActive = true;
    let elderActive = true;
    const aggregateSubmissionFindFirst = vi.fn().mockResolvedValue(completedDemo({
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      transcript: {
        id: '66000000-0000-4000-8000-000000000001',
        text: 'private completion draft',
      },
    }));
    const transaction = {
      staffProfile: {
        findFirst: vi.fn(() => Promise.resolve({
          id: staffProfileId,
          teamMemberships: membershipActive ? [{ teamId }] : [],
        })),
      },
      userRole: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'caregiver-role',
          dataScopes: activeCaregiverDataScopes(),
        }),
      },
      workOrder: {
        findFirst: vi.fn(() => Promise.resolve(elderActive
          ? {
              elderId,
              elder: {
                stays: [{ bed: { room: { floorId: 'floor-1', zoneId: 'zone-1' } } }],
              },
              assignments: [{ shiftAssignmentId, targetTeamId: teamId }],
            }
          : null)),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: teamId }) },
      shiftAssignment: { findFirst: vi.fn().mockResolvedValue({ id: shiftAssignmentId }) },
      voiceSubmission: { findFirst: aggregateSubmissionFindFirst },
    };
    const service = new VoiceWorkflowService(
      {
        client: {
          $transaction: vi.fn(
            (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
          ),
        },
      } as never,
      { assert: vi.fn().mockResolvedValue({}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    Reflect.set(service, 'assertVoiceConsents', vi.fn().mockResolvedValue(undefined));
    Reflect.set(service, 'finalizeForSubject', vi.fn(() => {
      if (accessChange === 'membership ends') membershipActive = false;
      else elderActive = false;
      return Promise.resolve();
    }));

    await expect(
      service.finalizeCaregiverCompletion(
        context,
        workOrderId,
        submissionId,
        { expectedVersion: 3 },
        session as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(aggregateSubmissionFindFirst).not.toHaveBeenCalled();
    },
  );
});

describe('voice processing safety fences', () => {
  it('attaches global emergency risk to the primary need even when all sub-intents are daily living', async () => {
    const maliciousButSchemaValidOutput = {
      summary: 'Requests water while reporting chest pain.',
      categories: ['DAILY_LIVING', 'HEALTH_CONCERN'],
      urgencySuggestion: 'ROUTINE',
      reportedConcerns: ['chest pain'],
      safetyFlags: ['CHEST_PAIN'],
      emotionObservation: null,
      followUpQuestions: ['Is breathing difficult?'],
      requiresHumanReview: false,
      subIntents: [
        {
          category: 'DAILY_LIVING',
          summary: 'Provide warm water.',
          urgencySuggestion: 'ROUTINE',
        },
      ],
    } as const;
    const harness = processingHarness(maliciousButSchemaValidOutput);

    await harness.process();

    expect(harness.createdNeeds).toHaveLength(1);
    expect(harness.createdNeeds[0]).toMatchObject({
      category: 'DAILY_LIVING',
      priority: 'IMMEDIATE_REVIEW',
      requiresHumanReview: true,
      status: 'REVIEW_REQUIRED',
      safetyRuleCodes: ['EMERGENCY_CONCERN_REQUIRES_DETERMINISTIC_REVIEW'],
    });
    expect(harness.needs.createInitialWorkOrder).toHaveBeenCalledWith(
      expect.anything(),
      context,
      session,
      expect.objectContaining({ priority: 'IMMEDIATE_REVIEW', status: 'REVIEW_REQUIRED' }),
      `voice-submission:${submissionId}`,
    );
    expect(harness.current().status).toBe('COMPLETED');
  });

  it('routes schema-invalid provider output through failed analysis and manual fallback', async () => {
    const harness = processingHarness({
      summary: 'Invalid split output',
      categories: ['DAILY_LIVING'],
      urgencySuggestion: 'ROUTINE',
      reportedConcerns: [],
      safetyFlags: [],
      emotionObservation: null,
      followUpQuestions: [],
      requiresHumanReview: false,
      subIntents: [
        {
          category: 'HEALTH_CONCERN',
          summary: 'Category is absent from the parent categories.',
          urgencySuggestion: 'PRIORITY',
        },
      ],
    });

    await harness.process();

    expect(harness.current()).toMatchObject({
      status: 'FAILED',
      failureCode: 'AI_OUTPUT_SCHEMA_INVALID',
    });
    const failedAnalysisCreate: unknown = harness.analysisCreate.mock.calls[0]?.[0];
    expect(failedAnalysisCreate).toMatchObject({
      data: {
        status: 'FAILED',
        failureCode: 'AI_OUTPUT_SCHEMA_INVALID',
      },
    });
    expect(harness.createdNeeds).toHaveLength(1);
    expect(harness.createdNeeds[0]).toMatchObject({
      source: 'MANUAL',
      status: 'REVIEW_REQUIRED',
      elderId,
      idempotencyKey: `${submissionId}:manual-fallback`,
    });
    expect(harness.needs.createElderOwnedManualInTransaction).toHaveBeenCalledWith(
      harness.transaction,
      context,
      expect.objectContaining({ reasonCode: 'ANALYSIS_MANUAL_FALLBACK' }),
      session,
      M03_PERMISSIONS.VOICE_SUBMISSION_CREATE,
    );
    expect(harness.needs.createManual).not.toHaveBeenCalled();
  });

  it('takes over a stale PROCESSING submission and converges instead of remaining wedged', async () => {
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS);
    harness.makeProcessingStale();

    await harness.process();

    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.current()).toMatchObject({ status: 'COMPLETED' });
    expect(harness.createdNeeds).not.toHaveLength(0);
  });

  it('checks withdrawn consent in the PROCESSING claim transaction before calling a provider', async () => {
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, { consentActive: false });

    await harness.process();

    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CONSENT_WITHDRAWN',
    });
    expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
  });

  it('rechecks caregiver assignment and shift in the claim transaction before transcription', async () => {
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      caregiverAccessActive: false,
    });

    await harness.process();

    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
  });

  it('drops a completion draft when caregiver access is revoked while transcription is running', async () => {
    const transcriptionStarted = deferred<void>();
    const transcriptionResult = deferred<{
      text: string;
      confidence: number;
      durationMs: number;
    }>();
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      caregiverAccessActive: true,
      transcribe: () => {
        transcriptionStarted.resolve();
        return transcriptionResult.promise;
      },
    });

    const processing = harness.process();
    await transcriptionStarted.promise;
    harness.revokeCaregiverAccess();
    transcriptionResult.resolve({ text: 'late completion draft', confidence: 0.95, durationMs: 900 });
    await processing;

    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
    expect(harness.transcriptCreate).not.toHaveBeenCalled();
  });

  it('cancels and fences completion voice when the caregiver role is revoked during transcription', async () => {
    const transcriptionStarted = deferred<void>();
    const transcriptionResult = deferred<{
      text: string;
      confidence: number;
      durationMs: number;
    }>();
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      transcribe: () => {
        transcriptionStarted.resolve();
        return transcriptionResult.promise;
      },
    });

    const processing = harness.process();
    await transcriptionStarted.promise;
    harness.revokeCaregiverRole();
    transcriptionResult.resolve({ text: 'must not persist', confidence: 0.95, durationMs: 900 });
    await processing;

    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
    expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
    expect(harness.transcriptCreate).not.toHaveBeenCalled();
    expect(harness.analysisCreate).not.toHaveBeenCalled();
    expect(harness.createdNeeds).toHaveLength(0);
  });

  it.each([
    ['caregiver user is disabled', (harness: ReturnType<typeof processingHarness>) => harness.disableCaregiverUser()],
    ['caregiver scopes expire', (harness: ReturnType<typeof processingHarness>) => harness.expireCaregiverScopes()],
    ['only a wrong active shift scope remains', (harness: ReturnType<typeof processingHarness>) => harness.replaceWithWrongCaregiverScopes()],
  ])('cancels and fences held completion voice when %s', async (_caseName, revokeAccess) => {
    const transcriptionStarted = deferred<void>();
    const transcriptionResult = deferred<{
      text: string;
      confidence: number;
      durationMs: number;
    }>();
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      transcribe: () => {
        transcriptionStarted.resolve();
        return transcriptionResult.promise;
      },
    });

    const processing = harness.process();
    await transcriptionStarted.promise;
    revokeAccess(harness);
    transcriptionResult.resolve({ text: 'must not persist', confidence: 0.95, durationMs: 900 });
    await processing;

    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
    expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
    expect(harness.transcriptCreate).not.toHaveBeenCalled();
    expect(harness.analysisCreate).not.toHaveBeenCalled();
    expect(harness.createdNeeds).toHaveLength(0);
  });

  it('cancels and fences held completion voice when the elder is discharged', async () => {
    const transcriptionStarted = deferred<void>();
    const transcriptionResult = deferred<{
      text: string;
      confidence: number;
      durationMs: number;
    }>();
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      purpose: 'WORK_ORDER_COMPLETION',
      workOrderId,
      transcribe: () => {
        transcriptionStarted.resolve();
        return transcriptionResult.promise;
      },
    });

    const processing = harness.process();
    await transcriptionStarted.promise;
    harness.dischargeElder();
    transcriptionResult.resolve({ text: 'must not persist', confidence: 0.95, durationMs: 900 });
    await processing;

    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'CAREGIVER_ACCESS_REVOKED',
    });
    expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
    expect(harness.transcriptCreate).not.toHaveBeenCalled();
    expect(harness.analysisCreate).not.toHaveBeenCalled();
    expect(harness.createdNeeds).toHaveLength(0);
  });

  it('lets the submitter cancel PROCESSING and prevents a held provider result from persisting', async () => {
    const analysisStarted = deferred<void>();
    const analysisResult = deferred<{
      output: typeof HOT_WATER_DIZZINESS_ANALYSIS;
      confidence: number;
      evidence: string[];
    }>();
    const harness = processingHarness(HOT_WATER_DIZZINESS_ANALYSIS, {
      analysisGenerate: () => {
        analysisStarted.resolve();
        return analysisResult.promise;
      },
    });

    const processing = harness.process();
    await analysisStarted.promise;
    expect(harness.current()).toMatchObject({ status: 'PROCESSING', version: 2 });
    await harness.cancelProcessing();
    analysisResult.resolve({
      output: HOT_WATER_DIZZINESS_ANALYSIS,
      confidence: 0.96,
      evidence: ['late provider evidence'],
    });
    await processing;

    expect(harness.current()).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'SUBMITTER_CANCELLED',
    });
    expect(harness.current().objectDeletionPendingAt).toBeInstanceOf(Date);
    expect(harness.transcriptCreate).not.toHaveBeenCalled();
    expect(harness.analysisCreate).not.toHaveBeenCalled();
    expect(harness.createdNeeds).toHaveLength(0);
    expect(harness.storage.delete).toHaveBeenCalledWith(objectKey);
  });

  it('rolls back cancellation when the mandatory audit write fails', async () => {
    let current = completedDemo({
      status: 'UPLOADED',
      completedAt: null,
      failureCode: null,
      version: 1,
    });
    const storageDelete = vi.fn();
    const auditRecord = vi.fn().mockRejectedValue(new Error('AUDIT_WRITE_FAILED'));
    const transaction = {
      voiceSubmission: {
        updateMany: vi.fn((request: { data: Record<string, unknown> }) => {
          current = completedDemo({
            ...current,
            status: request.data.status,
            failureCode: request.data.failureCode,
            objectDeletionPendingAt: request.data.objectDeletionPendingAt,
            version: current.version + 1,
          });
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(current)),
      },
    };
    const database = {
      client: {
        voiceSubmission: { findFirst: vi.fn(() => Promise.resolve(current)) },
        $transaction: vi.fn(async (
          callback: (client: typeof transaction) => Promise<unknown>,
        ) => {
          const before = current;
          try {
            return await callback(transaction);
          } catch (error) {
            current = before;
            throw error;
          }
        }),
      },
    };
    const service = new VoiceWorkflowService(
      database as never,
      {} as never,
      { delete: storageDelete } as never,
      {} as never,
      {} as never,
      { record: auditRecord } as never,
    );
    const cancelForSubject = Reflect.get(service, 'cancelForSubject') as (
      cancelContext: typeof context,
      id: string,
      cancelInput: { expectedVersion: number; reasonCode: string },
      cancelSession: typeof session,
      subject: { elderId: string; purpose: 'ELDER_REQUEST'; workOrderId: null },
    ) => Promise<unknown>;

    await expect(
      cancelForSubject.call(
        service,
        context,
        submissionId,
        { expectedVersion: 1, reasonCode: 'SUBMITTER_CANCELLED' },
        session,
        { elderId, purpose: 'ELDER_REQUEST', workOrderId: null },
      ),
    ).rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(current).toMatchObject({
      status: 'UPLOADED',
      version: 1,
      objectDeletionPendingAt: null,
    });
    expect(storageDelete).not.toHaveBeenCalled();
  });
});

function processingHarness(
  analysisOutput: unknown,
  options: {
    readonly consentActive?: boolean;
    readonly purpose?: 'ELDER_REQUEST' | 'WORK_ORDER_COMPLETION';
    readonly workOrderId?: string | null;
    readonly caregiverAccessActive?: boolean;
    readonly transcribe?: () => Promise<{
      readonly text: string;
      readonly confidence: number;
      readonly durationMs: number;
    }>;
    readonly analysisGenerate?: () => Promise<{
      readonly output: unknown;
      readonly confidence: number;
      readonly evidence: readonly string[];
    }>;
  } = {},
) {
  let current: Omit<
    ReturnType<typeof completedDemo>,
    | 'completedAt'
    | 'failureCode'
    | 'objectDeletionPendingAt'
    | 'status'
    | 'version'
    | 'workOrderId'
  > & {
    completedAt: Date | null;
    failureCode: string | null;
    objectDeletionPendingAt: Date | null;
    status: string;
    version: number;
    workOrderId: string | null;
  } = completedDemo({
    status: 'UPLOADED',
    purpose: options.purpose ?? 'ELDER_REQUEST',
    workOrderId: options.workOrderId ?? null,
    completedAt: null,
    failureCode: null,
    version: 1,
  });
  const consentActive = options.consentActive ?? true;
  let caregiverAccessActive = options.caregiverAccessActive ?? true;
  let caregiverRoleActive = true;
  let caregiverUserActive = true;
  let caregiverScopesActive = true;
  let caregiverExactScopeActive = true;
  let elderActive = true;
  let elderRoleActive = true;
  let elderPermissionActive = true;
  let elderScopeActive = true;
  let elderUserActive = true;
  let facilityActive = true;
  let organizationActive = true;
  let elderBindingActive = true;
  let elderStayActive = true;
  const createdNeeds: Array<Record<string, unknown>> = [];
  let createdNeedSequence = 0;
  const voiceUpdateMany = vi.fn((request: {
    where?: { version?: number; status?: string | { in?: string[] } };
    data: Record<string, unknown>;
  }) => {
    const statusFilter = request.where?.status;
    const statusMatches =
      statusFilter === undefined ||
      statusFilter === current.status ||
      (typeof statusFilter === 'object' && statusFilter.in?.includes(current.status));
    if (
      !statusMatches ||
      (request.where?.version !== undefined && request.where.version !== current.version)
    ) return Promise.resolve({ count: 0 });
    const increment = (request.data.version as { increment?: number } | undefined)?.increment ?? 0;
    current = {
      ...current,
      ...(request.data.status === undefined ? {} : { status: request.data.status as string }),
      ...(request.data.failureCode === undefined
        ? {}
        : { failureCode: request.data.failureCode as string | null }),
      ...(request.data.objectDeletionPendingAt === undefined
        ? {}
        : { objectDeletionPendingAt: request.data.objectDeletionPendingAt as Date | null }),
      ...(request.data.completedAt === undefined
        ? {}
        : { completedAt: request.data.completedAt as Date | null }),
      version: current.version + increment,
    };
    return Promise.resolve({ count: 1 });
  });
  const transcriptCreate = vi.fn((request: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: '60000000-0000-4000-8000-000000000001', ...request.data }));
  const analysisCreate = vi.fn((request: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: '61000000-0000-4000-8000-000000000001', ...request.data }));
  const needLinkCreate = vi.fn().mockResolvedValue({});
  const mutationRecord = vi.fn().mockResolvedValue(undefined);
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const needCreate = vi.fn((request: { data: Record<string, unknown> }) => {
    const created = {
      id: `62000000-0000-4000-8000-${String(++createdNeedSequence).padStart(12, '0')}`,
      version: 1,
      ...request.data,
    };
    createdNeeds.push(created);
    return Promise.resolve(created);
  });
  const activeConsents = [
    {
      purpose: 'VOICE_CAPTURE',
      decision: consentActive ? 'GRANTED' : 'WITHDRAWN',
      consentVersion: consentActive ? 1 : 2,
      expiresAt: null,
    },
    {
      purpose: 'TRANSCRIPTION_AI_ANALYSIS',
      decision: consentActive ? 'GRANTED' : 'WITHDRAWN',
      consentVersion: consentActive ? 1 : 2,
      expiresAt: null,
    },
  ];
  const transaction = {
    voiceSubmission: {
      findFirst: vi.fn(() => Promise.resolve(current)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(current)),
      updateMany: voiceUpdateMany,
    },
    consentRecord: { findMany: vi.fn(() => Promise.resolve(activeConsents)) },
    transcript: { create: transcriptCreate },
    aIAnalysis: { create: analysisCreate },
    need: { create: needCreate },
    needLink: { create: needLinkCreate },
    facility: {
      findFirst: vi.fn(() => Promise.resolve(
        facilityActive && organizationActive ? { id: facilityId } : null,
      )),
    },
    elder: {
      findFirst: vi.fn(() => Promise.resolve(
        elderActive && elderBindingActive && elderStayActive ? { id: elderId } : null,
      )),
    },
    staffProfile: {
      findFirst: vi.fn(() =>
        Promise.resolve(
          !caregiverAccessActive
            ? null
            : { id: staffProfileId, teamMemberships: [{ teamId }] },
        )),
    },
    userRole: {
      findFirst: vi.fn(() => Promise.resolve(current.purpose === 'ELDER_REQUEST'
        ? elderRoleActive && elderPermissionActive && elderScopeActive && elderUserActive && organizationActive
          ? { id: 'elder-role' }
          : null
        : caregiverRoleActive && caregiverUserActive && caregiverScopesActive
          ? { id: 'caregiver-role', dataScopes: activeCaregiverDataScopes(caregiverExactScopeActive) }
          : null)),
    },
    workOrder: {
      findFirst: vi.fn(() => Promise.resolve(elderActive
        ? {
            elderId,
            elder: {
              stays: [{ bed: { room: { floorId: 'floor-1', zoneId: 'zone-1' } } }],
            },
            assignments: [{
              shiftAssignmentId,
              targetTeamId: teamId,
            }],
          }
        : null)),
    },
    team: {
      findFirst: vi.fn(() => Promise.resolve({ id: teamId })),
    },
    shiftAssignment: {
      findFirst: vi.fn(() => Promise.resolve({ id: shiftAssignmentId })),
    },
  };
  const database = {
    client: {
      voiceSubmission: {
        findFirst: vi.fn(() => Promise.resolve(current)),
        updateMany: voiceUpdateMany,
        findUnique: vi.fn(() => Promise.resolve(current)),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(current)),
      },
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
      ),
    },
  };
  const recordNeedCreated = vi.fn().mockResolvedValue(undefined);
  const createElderOwnedManualInTransaction = vi.fn(async (
    client: typeof transaction,
    _context: typeof context,
    input: {
      elderId: string;
      summary: string;
      category: string;
      priority: string;
      requiresHumanReview: boolean;
      reasonCode: string;
      idempotencyKey: string;
    },
    _session: typeof session,
  ) => {
    void _session;
    const need = await client.need.create({
      data: {
        organizationId,
        facilityId,
        elderId: input.elderId,
        source: 'MANUAL',
        summary: input.summary,
        category: input.category,
        urgencySuggestion: input.priority,
        priority: input.priority,
        requiresHumanReview: input.requiresHumanReview,
        safetyRuleCodes: [],
        status: 'REVIEW_REQUIRED',
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReasonCode: null,
        idempotencyKey: input.idempotencyKey,
        correlationId: context.correlationId,
      },
    });
    await recordNeedCreated(
      client,
      context,
      session,
      need,
      input.idempotencyKey,
      'manual-fallback-fingerprint',
    );
    return need;
  });
  const needs = {
    recordNeedCreated,
    createInitialWorkOrder: vi.fn().mockResolvedValue({}),
    createManual: vi.fn().mockResolvedValue({}),
    createElderOwnedManualInTransaction,
  };
  const transcribe = vi.fn(
    options.transcribe ??
      (() => Promise.resolve({
        text: 'provider transcript',
        confidence: 0.98,
        durationMs: 1_500,
      })),
  );
  const storage = {
    isSealedObjectKey: vi.fn(() => true),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const service = new VoiceWorkflowService(
    database as never,
    {} as never,
    storage as never,
    needs as never,
    { record: mutationRecord } as never,
    { record: auditRecord } as never,
  );
  Reflect.set(service, 'transcription', { transcribe });
  Reflect.set(service, 'analysis', {
    generate: vi.fn(
      options.analysisGenerate ??
        (() => Promise.resolve({
          output: analysisOutput,
          confidence: 0.91,
          evidence: ['provider evidence'],
        })),
    ),
  });
  const process = Reflect.get(service, 'process') as (
    processContext: typeof context,
    id: string,
    processSession: typeof session,
  ) => Promise<void>;
  return {
    process: () => process.call(service, context, submissionId, session),
    current: () => current,
    makeProcessingStale: () => {
      current = {
        ...current,
        status: 'PROCESSING',
        version: current.version + 1,
        updatedAt: new Date('2000-01-01T00:00:00.000Z'),
      };
    },
    createdNeeds,
    analysisCreate,
    transcriptCreate,
    transcribe,
    needs,
    storage,
    auditRecord,
    mutationRecord,
    needLinkCreate,
    transaction,
    database,
    revokeCaregiverAccess: () => {
      caregiverAccessActive = false;
    },
    revokeCaregiverRole: () => {
      caregiverRoleActive = false;
    },
    disableCaregiverUser: () => {
      caregiverUserActive = false;
    },
    expireCaregiverScopes: () => {
      caregiverScopesActive = false;
    },
    replaceWithWrongCaregiverScopes: () => {
      caregiverExactScopeActive = false;
    },
    dischargeElder: () => {
      elderActive = false;
    },
    revokeElderRole: () => {
      elderRoleActive = false;
    },
    revokeElderPermission: () => {
      elderPermissionActive = false;
    },
    expireElderScope: () => {
      elderScopeActive = false;
    },
    disableElderUser: () => {
      elderUserActive = false;
    },
    disableFacility: () => {
      facilityActive = false;
    },
    disableOrganization: () => {
      organizationActive = false;
    },
    unbindElderPortal: () => {
      elderBindingActive = false;
    },
    dischargeElderStay: () => {
      elderStayActive = false;
    },
    cancelProcessing: async () => {
      const cancelForSubject = Reflect.get(service, 'cancelForSubject') as (
        cancelContext: typeof context,
        id: string,
        cancelInput: { expectedVersion: number; reasonCode: string },
        cancelSession: typeof session,
        subject: { elderId: string; purpose: 'ELDER_REQUEST'; workOrderId: null },
      ) => Promise<unknown>;
      return cancelForSubject.call(
        service,
        context,
        submissionId,
        { expectedVersion: 2, reasonCode: 'SUBMITTER_CANCELLED' },
        session,
        { elderId, purpose: 'ELDER_REQUEST', workOrderId: null },
      );
    },
  };
}

function sealedCommitHarness(initialStatus: 'UPLOAD_PENDING' | 'UPLOADED' = 'UPLOAD_PENDING') {
  const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
  const sourceETag = '"staging-etag"';
  const leaseToken = '71000000-0000-4000-8000-000000000001';
  const leaseUntil = new Date('2099-07-22T08:04:00.000Z');
  let current: Omit<
    ReturnType<typeof completedDemo>,
    'failureCode' | 'objectDeletionPendingAt' | 'status' | 'version'
  > & {
    failureCode: string | null;
    objectDeletionPendingAt: Date | null;
    status: string;
    version: number;
  } = completedDemo({
    status: initialStatus,
    objectKey: initialStatus === 'UPLOADED' ? objectKey : stagingKey,
    uploadObjectKey: stagingKey,
    uploadAuthorizedUntil: new Date('2099-07-22T08:05:00.000Z'),
    sealCandidateObjectKey: initialStatus === 'UPLOADED' ? null : objectKey,
    sealCandidateSourceETag: initialStatus === 'UPLOADED' ? null : sourceETag,
    sealLeaseToken: initialStatus === 'UPLOADED' ? null : leaseToken,
    sealLeaseUntil: initialStatus === 'UPLOADED' ? null : leaseUntil,
    uploadedAt: initialStatus === 'UPLOADED' ? new Date('2026-07-22T08:00:00.000Z') : null,
    completedAt: null,
    failureCode: null,
    objectDeletionPendingAt: null,
    version: initialStatus === 'UPLOADED' ? 2 : 1,
  });
  let elderRoleActive = true;
  let elderPermissionActive = true;
  let elderScopeActive = true;
  let elderUserActive = true;
  let facilityActive = true;
  let organizationActive = true;
  let elderBindingActive = true;
  let elderStayActive = true;
  const authorizationStarted = deferred<void>();
  const authorizationRelease = deferred<void>();
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const transcriptCreate = vi.fn();
  const analysisCreate = vi.fn();
  const needCreate = vi.fn();
  const workOrderCreate = vi.fn();
  const timelineCreate = vi.fn();
  const outboxCreate = vi.fn();
  const updateMany = vi.fn((request: { data: Record<string, unknown> }) => {
    if (request.data.status !== 'CANCELLED' || current.status === 'CANCELLED') {
      return Promise.resolve({ count: 0 });
    }
    current = {
      ...current,
      status: 'CANCELLED',
      failureCode: request.data.failureCode as string,
      objectDeletionPendingAt: request.data.objectDeletionPendingAt as Date,
      version: current.version + 1,
    };
    return Promise.resolve({ count: 1 });
  });
  const transaction = {
    voiceSubmission: {
      findFirst: vi.fn(() => Promise.resolve({ ...current })),
      updateMany,
    },
    consentRecord: {
      findMany: vi.fn(() => Promise.resolve([
        { purpose: 'VOICE_CAPTURE', decision: 'GRANTED', consentVersion: 1, expiresAt: null },
        {
          purpose: 'TRANSCRIPTION_AI_ANALYSIS',
          decision: 'GRANTED',
          consentVersion: 1,
          expiresAt: null,
        },
      ])),
    },
    facility: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return facilityActive && organizationActive ? { id: facilityId } : null;
      }),
    },
    elder: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return elderBindingActive && elderStayActive ? { id: elderId } : null;
      }),
    },
    userRole: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return elderRoleActive &&
          elderPermissionActive &&
          elderScopeActive &&
          elderUserActive &&
          organizationActive
          ? { id: 'elder-role' }
          : null;
      }),
    },
    transcript: { create: transcriptCreate },
    aIAnalysis: { create: analysisCreate },
    need: { create: needCreate },
    workOrder: { create: workOrderCreate },
    elderTimelineEntry: { create: timelineCreate },
    outboxEvent: { create: outboxCreate },
  };
  const database = {
    client: {
      $transaction: vi.fn(
        (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
      ),
    },
  };
  const service = new VoiceWorkflowService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { record: auditRecord } as never,
  );
  const commitSealedUpload = Reflect.get(service, 'commitSealedUpload') as (
    commitContext: typeof context,
    submission: unknown,
    finalizeInput: { expectedVersion: number; checksumSha256?: string },
    commitSession: typeof session,
    sealedObjectKey: string,
    expectedSourceETag: string,
    expectedLeaseToken: string,
    expectedLeaseUntil: Date,
    contentLength: number,
  ) => Promise<'ABORTED' | 'COMMITTED' | 'CONFLICT' | 'REPLAY'>;
  return {
    commit: () => commitSealedUpload.call(
      service,
      context,
      current,
      { expectedVersion: 1, checksumSha256 },
      session,
      objectKey,
      sourceETag,
      leaseToken,
      leaseUntil,
      44,
    ),
    current: () => current,
    auditRecord,
    updateMany,
    database,
    authorizationStarted: authorizationStarted.promise,
    releaseAuthorization: () => authorizationRelease.resolve(),
    sensitiveWrites: [
      transcriptCreate,
      analysisCreate,
      needCreate,
      workOrderCreate,
      timelineCreate,
      outboxCreate,
    ],
    revokeElderRole: () => {
      elderRoleActive = false;
    },
    revokeElderPermission: () => {
      elderPermissionActive = false;
    },
    expireElderScope: () => {
      elderScopeActive = false;
    },
    disableElderUser: () => {
      elderUserActive = false;
    },
    disableFacility: () => {
      facilityActive = false;
    },
    disableOrganization: () => {
      organizationActive = false;
    },
    unbindElderPortal: () => {
      elderBindingActive = false;
    },
    dischargeElderStay: () => {
      elderStayActive = false;
    },
  };
}

function uploadAuthorizationHarness() {
  const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
  let current: Omit<
    ReturnType<typeof completedDemo>,
    | 'failureCode'
    | 'objectDeletionPendingAt'
    | 'objectKey'
    | 'status'
    | 'uploadAuthorizedUntil'
    | 'uploadObjectKey'
    | 'version'
  > & {
    failureCode: string | null;
    objectDeletionPendingAt: Date | null;
    objectKey: string;
    status: string;
    uploadAuthorizedUntil: Date | null;
    uploadObjectKey: string | null;
    version: number;
  } = completedDemo({
    status: 'UPLOAD_PENDING',
    objectKey: stagingKey,
    uploadObjectKey: stagingKey,
    uploadAuthorizedUntil: null,
    sealCandidateObjectKey: null,
    sealCandidateSourceETag: null,
    sealLeaseToken: null,
    sealLeaseUntil: null,
    uploadedAt: null,
    completedAt: null,
    actualSizeBytes: null,
    failureCode: null,
    version: 1,
  });
  let elderRoleActive = true;
  let elderPermissionActive = true;
  let elderScopeActive = true;
  let elderUserActive = true;
  let facilityActive = true;
  let organizationActive = true;
  let elderBindingActive = true;
  let elderStayActive = true;
  const authorizationStarted = deferred<void>();
  const authorizationRelease = deferred<void>();
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const createUpload = vi.fn().mockResolvedValue({
    method: 'POST',
    url: 'http://minio.local/eldercare-private',
    fields: { key: stagingKey },
    expiresAt: '2099-07-22T08:05:00.000Z',
  });
  const updateMany = vi.fn((request: { data: Record<string, unknown> }) => {
    if (request.data.status === 'CANCELLED') {
      current = {
        ...current,
        status: 'CANCELLED',
        failureCode: request.data.failureCode as string,
        objectDeletionPendingAt: request.data.objectDeletionPendingAt as Date,
        uploadAuthorizedUntil: null,
        version: current.version + 1,
      };
      return Promise.resolve({ count: 1 });
    }
    if (request.data.uploadAuthorizedUntil instanceof Date) {
      current = { ...current, uploadAuthorizedUntil: request.data.uploadAuthorizedUntil };
      return Promise.resolve({ count: 1 });
    }
    return Promise.resolve({ count: 0 });
  });
  const transaction = {
    voiceSubmission: {
      findFirst: vi.fn(() => Promise.resolve({ ...current })),
      updateMany,
    },
    consentRecord: {
      findMany: vi.fn(() => Promise.resolve([
        { purpose: 'VOICE_CAPTURE', decision: 'GRANTED', consentVersion: 1, expiresAt: null },
        {
          purpose: 'TRANSCRIPTION_AI_ANALYSIS',
          decision: 'GRANTED',
          consentVersion: 1,
          expiresAt: null,
        },
      ])),
    },
    facility: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return facilityActive && organizationActive ? { id: facilityId } : null;
      }),
    },
    elder: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return elderBindingActive && elderStayActive ? { id: elderId } : null;
      }),
    },
    userRole: {
      findFirst: vi.fn(async () => {
        authorizationStarted.resolve();
        await authorizationRelease.promise;
        return elderRoleActive &&
          elderPermissionActive &&
          elderScopeActive &&
          elderUserActive &&
          organizationActive
          ? { id: 'elder-role' }
          : null;
      }),
    },
  };
  const service = new VoiceWorkflowService(
    {
      client: {
        $transaction: vi.fn(
          (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
        ),
      },
    } as never,
    {} as never,
    { createUpload } as never,
    {} as never,
    {} as never,
    { record: auditRecord } as never,
  );
  const authorizeStagingUpload = Reflect.get(service, 'authorizeStagingUpload') as (
    uploadContext: typeof context,
    record: typeof current,
    uploadSession: typeof session,
    subject: { elderId: string; purpose: 'ELDER_REQUEST'; workOrderId: null },
  ) => Promise<unknown>;
  return {
    authorize: () => authorizeStagingUpload.call(
      service,
      context,
      current,
      session,
      { elderId, purpose: 'ELDER_REQUEST', workOrderId: null },
    ),
    current: () => current,
    createUpload,
    auditRecord,
    authorizationStarted: authorizationStarted.promise,
    releaseAuthorization: () => authorizationRelease.resolve(),
    revokeElderRole: () => {
      elderRoleActive = false;
    },
    revokeElderPermission: () => {
      elderPermissionActive = false;
    },
    expireElderScope: () => {
      elderScopeActive = false;
    },
    disableElderUser: () => {
      elderUserActive = false;
    },
    disableFacility: () => {
      facilityActive = false;
    },
    disableOrganization: () => {
      organizationActive = false;
    },
    unbindElderPortal: () => {
      elderBindingActive = false;
    },
    dischargeElderStay: () => {
      elderStayActive = false;
    },
  };
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
