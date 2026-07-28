import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ServiceConfig } from '@eldercare/config';
import { Prisma, type PrismaClient } from '@eldercare/db';
import type { Logger } from '@eldercare/observability';

const DEFAULT_BATCH_SIZE = 50;
const CANDIDATE_SCAN_OVERSCAN_FACTOR = 4;
const MAX_CANDIDATE_SCAN_SIZE = 500;
const UPLOAD_AUTHORIZATION_CLOCK_GRACE_MS = 5_000;
const SEAL_COPY_SETTLE_GRACE_MS = 5_000;
const DELETION_FENCE_SETTLE_GRACE_MS = 5_000;
const DEFAULT_STAGING_SWEEP_LIMIT = 250;
const MANAGED_STAGING_PREFIX = 'voice/staging/';

export interface VoiceRetentionCandidate {
  readonly id: string;
  readonly version: number;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly elderId: string;
  readonly bucket: string;
  readonly objectKey: string;
  readonly uploadObjectKey: string | null;
  readonly uploadAuthorizedUntil: Date | null;
  readonly sealCandidateObjectKey: string | null;
  readonly sealCandidateSourceETag: string | null;
  readonly sealLeaseToken: string | null;
  readonly sealLeaseUntil: Date | null;
  readonly status: 'UPLOAD_PENDING' | 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly retentionUntil: Date;
  readonly objectDeletedAt: Date | null;
  readonly objectDeletionPendingAt: Date | null;
  readonly consentActive: boolean;
  readonly correlationId: string;
  readonly transcript: null | {
    readonly id: string;
    readonly retentionUntil: Date;
    readonly contentDeletedAt: Date | null;
    readonly analysis: null | {
      readonly id: string;
      readonly retentionUntil: Date;
      readonly contentDeletedAt: Date | null;
    };
  };
}

export interface VoiceRetentionCursor {
  readonly retentionUntil: Date;
  readonly id: string;
}

export interface VoiceDerivedContentPurgeResult {
  readonly transcriptContentDeleted: boolean;
  readonly analysisContentDeleted: boolean;
}

export interface VoiceRetentionRepository {
  findCandidates(
    now: Date,
    limit: number,
    after?: VoiceRetentionCursor | null,
  ): Promise<readonly VoiceRetentionCandidate[]>;
  findReferencedStagingObjectKeys(
    bucket: string,
    objectKeys: readonly string[],
  ): Promise<ReadonlySet<string>>;
  purgeDerivedContent(
    candidate: VoiceRetentionCandidate,
    deletedAt: Date,
  ): Promise<VoiceDerivedContentPurgeResult>;
  fenceObjectDeletion(
    candidate: VoiceRetentionCandidate,
    fencedAt: Date,
  ): Promise<VoiceRetentionCandidate | null>;
  clearUploadAuthorization(
    candidate: VoiceRetentionCandidate,
    clearedAt: Date,
  ): Promise<VoiceRetentionCandidate | null>;
  claimSealCandidateCleanup(
    candidate: VoiceRetentionCandidate,
    claimedAt: Date,
  ): Promise<VoiceRetentionCandidate | null>;
  clearSealCandidate(
    candidate: VoiceRetentionCandidate,
    clearedAt: Date,
  ): Promise<VoiceRetentionCandidate | null>;
  markObjectDeleted(candidate: VoiceRetentionCandidate, deletedAt: Date): Promise<boolean>;
  recordObjectDeleteFailure(candidate: VoiceRetentionCandidate, reasonCode: string, occurredAt: Date): Promise<void>;
}

export interface VoiceObjectDeletionStore {
  readonly bucketName: string;
  delete(objectKey: string): Promise<void>;
  sweepStaleStagingObjects(
    now: Date,
    limit: number,
    findReferencedKeys: (
      bucket: string,
      objectKeys: readonly string[],
    ) => Promise<ReadonlySet<string>>,
  ): Promise<{ readonly deleted: number; readonly failures: number }>;
}

export interface VoiceRetentionCleanupResult {
  readonly scanned: number;
  readonly transcriptContentsDeleted: number;
  readonly analysisContentsDeleted: number;
  readonly stagingObjectsDeleted: number;
  readonly uploadAuthorizationsCleared: number;
  readonly sealCandidatesDeleted: number;
  readonly objectsDeleted: number;
  readonly objectDeleteFailures: number;
  readonly staleStagingObjectsDeleted: number;
  readonly staleStagingDeleteFailures: number;
}

export class VoiceRetentionCleanup {
  private running = false;
  private candidateCursor: VoiceRetentionCursor | null = null;

  constructor(
    private readonly repository: VoiceRetentionRepository,
    private readonly storage: VoiceObjectDeletionStore,
    private readonly logger: Pick<Logger, 'info' | 'warn'>,
  ) {}

  async runOnce(now = new Date(), limit = DEFAULT_BATCH_SIZE): Promise<VoiceRetentionCleanupResult> {
    if (this.running) {
      return {
        scanned: 0,
        transcriptContentsDeleted: 0,
        analysisContentsDeleted: 0,
        stagingObjectsDeleted: 0,
        uploadAuthorizationsCleared: 0,
        sealCandidatesDeleted: 0,
        objectsDeleted: 0,
        objectDeleteFailures: 0,
        staleStagingObjectsDeleted: 0,
        staleStagingDeleteFailures: 0,
      };
    }
    this.running = true;
    try {
      const candidateWindow = await this.findCandidateWindow(now, limit);
      const { candidates } = candidateWindow;
      let transcriptContentsDeleted = 0;
      let analysisContentsDeleted = 0;
      let stagingObjectsDeleted = 0;
      let uploadAuthorizationsCleared = 0;
      let sealCandidatesDeleted = 0;
      let objectsDeleted = 0;
      let objectDeleteFailures = 0;

      for (const snapshot of candidates) {
        try {
          let candidate = snapshot;
          const deletionRequired =
            candidate.status === 'CANCELLED' ||
            !candidate.consentActive ||
            candidate.retentionUntil <= now ||
            candidate.objectDeletionPendingAt !== null;
          if (deletionRequired && candidate.objectDeletionPendingAt === null) {
            const fenced = await this.repository.fenceObjectDeletion(candidate, now);
            if (fenced === null) continue;
            candidate = fenced;
          }
          const deleteImmediately = candidate.objectDeletionPendingAt !== null;
          const transcriptDue =
            candidate.transcript !== null &&
            candidate.transcript.contentDeletedAt === null &&
            (deleteImmediately || candidate.transcript.retentionUntil <= now);
          const analysisDue =
            candidate.transcript?.analysis !== null &&
            candidate.transcript?.analysis !== undefined &&
            candidate.transcript.analysis.contentDeletedAt === null &&
            (deleteImmediately || candidate.transcript.analysis.retentionUntil <= now);
          if (transcriptDue || analysisDue) {
            const purged = await this.repository.purgeDerivedContent(candidate, now);
            if (purged.transcriptContentDeleted) transcriptContentsDeleted += 1;
            if (purged.analysisContentDeleted) analysisContentsDeleted += 1;
          }

          const deletedKeys = new Set<string>();
          const deleteManagedObject = async (
            objectKey: string,
            failureCode: string,
            countAsStaging = false,
          ): Promise<boolean> => {
            if (deletedKeys.has(objectKey)) return true;
            try {
              await this.storage.delete(objectKey);
              deletedKeys.add(objectKey);
              if (countAsStaging) stagingObjectsDeleted += 1;
              return true;
            } catch {
              objectDeleteFailures += 1;
              await this.repository.recordObjectDeleteFailure(candidate, failureCode, now);
              return false;
            }
          };

          const uploadAuthorizationCanSettle =
            candidate.uploadAuthorizedUntil === null ||
            candidate.uploadAuthorizedUntil.getTime() + UPLOAD_AUTHORIZATION_CLOCK_GRACE_MS <=
              now.getTime();
          const stagingCleanupRequired =
            candidate.uploadObjectKey !== null &&
            (candidate.status !== 'UPLOAD_PENDING' ||
              deleteImmediately ||
              candidate.retentionUntil <= now ||
              uploadAuthorizationCanSettle);
          if (stagingCleanupRequired && candidate.uploadObjectKey !== null) {
            const expectedUploadKey = managedStagingObjectKey(candidate);
            if (
              candidate.bucket !== this.storage.bucketName ||
              candidate.uploadObjectKey !== expectedUploadKey
            ) {
              objectDeleteFailures += 1;
              await this.repository.recordObjectDeleteFailure(
                candidate,
                'STAGING_OBJECT_KEY_SCOPE_MISMATCH',
                now,
              );
            } else {
              const stagingDeleted = await deleteManagedObject(
                candidate.uploadObjectKey,
                'STAGING_OBJECT_DELETE_FAILED',
                true,
              );
              if (
                stagingDeleted &&
                uploadAuthorizationCanSettle &&
                candidate.uploadAuthorizedUntil !== null
              ) {
                const cleared = await this.repository.clearUploadAuthorization(candidate, now);
                if (cleared === null) continue;
                candidate = cleared;
                uploadAuthorizationsCleared += 1;
              }
            }
          }

          const sealCandidateCleanupRequired =
            candidate.sealCandidateObjectKey !== null &&
            candidate.objectDeletionPendingAt !== null;
          if (sealCandidateCleanupRequired && candidate.sealCandidateObjectKey !== null) {
            if (
              candidate.bucket !== this.storage.bucketName ||
              !isManagedSealedObjectKey(candidate, candidate.sealCandidateObjectKey)
            ) {
              objectDeleteFailures += 1;
              await this.repository.recordObjectDeleteFailure(
                candidate,
                'SEAL_CANDIDATE_KEY_SCOPE_MISMATCH',
                now,
              );
            } else {
              const candidateDeleted = await deleteManagedObject(
                candidate.sealCandidateObjectKey,
                'SEAL_CANDIDATE_DELETE_FAILED',
              );
              const sealLeaseCanSettle =
                candidate.sealLeaseUntil !== null &&
                candidate.sealLeaseUntil.getTime() + SEAL_COPY_SETTLE_GRACE_MS <= now.getTime();
              if (candidateDeleted && sealLeaseCanSettle) {
                const claimed = await this.repository.claimSealCandidateCleanup(candidate, now);
                if (claimed !== null && claimed.sealCandidateObjectKey !== null) {
                  candidate = claimed;
                  deletedKeys.delete(claimed.sealCandidateObjectKey);
                  const finalCandidateDelete = await deleteManagedObject(
                    claimed.sealCandidateObjectKey,
                    'SEAL_CANDIDATE_FINAL_DELETE_FAILED',
                  );
                  if (finalCandidateDelete) {
                    const cleared = await this.repository.clearSealCandidate(candidate, now);
                    if (cleared !== null) {
                      candidate = cleared;
                      sealCandidatesDeleted += 1;
                    }
                  }
                }
              }
            }
          }

          if (candidate.objectDeletedAt !== null || candidate.objectDeletionPendingAt === null) continue;

          if (
            candidate.bucket !== this.storage.bucketName ||
            !isManagedAuthoritativeObjectKey(candidate)
          ) {
            objectDeleteFailures += 1;
            await this.repository.recordObjectDeleteFailure(candidate, 'OBJECT_KEY_SCOPE_MISMATCH', now);
            continue;
          }
          const authoritativeDeleted = await deleteManagedObject(
            candidate.objectKey,
            'OBJECT_STORAGE_DELETE_FAILED',
          );
          const deletionFenceSettled =
            candidate.objectDeletionPendingAt.getTime() + DELETION_FENCE_SETTLE_GRACE_MS <=
            now.getTime();
          if (
            authoritativeDeleted &&
            deletionFenceSettled &&
            candidate.uploadObjectKey === null &&
            candidate.uploadAuthorizedUntil === null &&
            candidate.sealCandidateObjectKey === null &&
            candidate.sealCandidateSourceETag === null &&
            candidate.sealLeaseToken === null &&
            candidate.sealLeaseUntil === null &&
            await this.repository.markObjectDeleted(candidate, now)
          ) {
            objectsDeleted += 1;
          }
        } catch {
          // Keep this candidate eligible for a later idempotent retry, but do
          // not let an unexpected repository/storage failure block the rest
          // of the bounded keyset window. The aggregate warning below is
          // deliberately free of resource identifiers and object keys.
          objectDeleteFailures += 1;
        }
      }

      let staleStagingObjectsDeleted = 0;
      let staleStagingDeleteFailures = 0;
      try {
        const sweep = await this.storage.sweepStaleStagingObjects(
          now,
          DEFAULT_STAGING_SWEEP_LIMIT,
          (bucket, objectKeys) =>
            this.repository.findReferencedStagingObjectKeys(bucket, objectKeys),
        );
        staleStagingObjectsDeleted = sweep.deleted;
        staleStagingDeleteFailures = sweep.failures;
      } catch {
        staleStagingDeleteFailures = 1;
      }

      this.candidateCursor = candidateWindow.nextCursor;
      const result = {
        scanned: candidates.length,
        transcriptContentsDeleted,
        analysisContentsDeleted,
        stagingObjectsDeleted,
        uploadAuthorizationsCleared,
        sealCandidatesDeleted,
        objectsDeleted,
        objectDeleteFailures,
        staleStagingObjectsDeleted,
        staleStagingDeleteFailures,
      };
      this.logger.info('Voice retention cleanup completed', result);
      if (objectDeleteFailures > 0) {
        this.logger.warn('Voice retention cleanup deferred object deletion', {
          failureCount: objectDeleteFailures,
          reasonCode: 'OBJECT_DELETE_DEFERRED',
        });
      }
      if (staleStagingDeleteFailures > 0) {
        this.logger.warn('Voice staging orphan sweep deferred object deletion', {
          failureCount: staleStagingDeleteFailures,
          reasonCode: 'STAGING_ORPHAN_SWEEP_DEFERRED',
        });
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async findCandidateWindow(
    now: Date,
    requestedBatchSize: number,
  ): Promise<{
    readonly candidates: readonly VoiceRetentionCandidate[];
    readonly nextCursor: VoiceRetentionCursor | null;
  }> {
    const batchSize = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.trunc(requestedBatchSize))
      : DEFAULT_BATCH_SIZE;
    const scanLimit = Math.min(
      MAX_CANDIDATE_SCAN_SIZE,
      batchSize * CANDIDATE_SCAN_OVERSCAN_FACTOR,
    );
    const startingCursor = this.candidateCursor;
    let candidates = await this.repository.findCandidates(now, scanLimit, startingCursor);

    // The keyset cursor is intentionally process-local: it prevents stable,
    // permanently failing object deletions from monopolizing every fixed
    // batch without adding mutable retry metadata to sensitive business rows.
    // Once the current keyspace is exhausted, wrap and retry from the oldest
    // eligible row in the same run. A failed query throws before the cursor is
    // advanced, so cleanup remains fail-closed.
    if (candidates.length === 0 && startingCursor !== null) {
      candidates = await this.repository.findCandidates(now, scanLimit, null);
    }

    const lastCandidate = candidates.at(-1);
    return {
      candidates,
      nextCursor: lastCandidate === undefined
        ? null
        : {
          retentionUntil: lastCandidate.retentionUntil,
          id: lastCandidate.id,
        },
    };
  }
}

export class PrismaVoiceRetentionRepository implements VoiceRetentionRepository {
  constructor(private readonly database: PrismaClient) {}

  async findReferencedStagingObjectKeys(
    bucket: string,
    objectKeys: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (objectKeys.length === 0) return new Set();
    const records = await this.database.voiceSubmission.findMany({
      where: { bucket, uploadObjectKey: { in: [...objectKeys] } },
      select: { uploadObjectKey: true },
    });
    return new Set(
      records.flatMap((record) =>
        record.uploadObjectKey === null ? [] : [record.uploadObjectKey],
      ),
    );
  }

  async findCandidates(
    now: Date,
    limit: number,
    after: VoiceRetentionCursor | null = null,
  ): Promise<readonly VoiceRetentionCandidate[]> {
    const activeConsent = {
      decision: 'GRANTED' as const,
      supersededAt: null,
      effectiveAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const eligibility: Prisma.VoiceSubmissionWhereInput = {
      OR: [
        { objectDeletedAt: null, objectDeletionPendingAt: { not: null } },
        { objectDeletedAt: null, status: 'CANCELLED' },
        { objectDeletedAt: null, retentionUntil: { lte: now } },
        {
          status: 'CANCELLED',
          transcript: {
            is: {
              OR: [
                { contentDeletedAt: null },
                { analysis: { is: { contentDeletedAt: null } } },
              ],
            },
          },
        },
        { transcript: { is: { contentDeletedAt: null, retentionUntil: { lte: now } } } },
        {
          transcript: {
            is: {
              analysis: { is: { contentDeletedAt: null, retentionUntil: { lte: now } } },
            },
          },
        },
        {
          AND: [
            {
              OR: [
                { objectDeletedAt: null },
                {
                  transcript: {
                    is: {
                      OR: [
                        { contentDeletedAt: null },
                        { analysis: { is: { contentDeletedAt: null } } },
                      ],
                    },
                  },
                },
              ],
            },
            {
              OR: [
                {
                  elder: {
                    consentRecords: {
                      none: { purpose: 'VOICE_CAPTURE', ...activeConsent },
                    },
                  },
                },
                {
                  elder: {
                    consentRecords: {
                      none: { purpose: 'TRANSCRIPTION_AI_ANALYSIS', ...activeConsent },
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          uploadObjectKey: { not: null },
          OR: [
            { status: { not: 'UPLOAD_PENDING' } },
            { uploadAuthorizedUntil: null },
            { uploadAuthorizedUntil: { lte: now } },
          ],
        },
        {
          sealCandidateObjectKey: { not: null },
          OR: [
            { status: { not: 'UPLOAD_PENDING' } },
            { uploadAuthorizedUntil: null },
            { uploadAuthorizedUntil: { lte: now } },
          ],
        },
      ],
    };
    const records = await this.database.voiceSubmission.findMany({
      where: after === null
        ? eligibility
        : {
            AND: [
              eligibility,
              {
                OR: [
                  { retentionUntil: { gt: after.retentionUntil } },
                  {
                    retentionUntil: after.retentionUntil,
                    id: { gt: after.id },
                  },
                ],
              },
            ],
          },
      select: {
        id: true,
        version: true,
        organizationId: true,
        facilityId: true,
        elderId: true,
        bucket: true,
        objectKey: true,
        uploadObjectKey: true,
        uploadAuthorizedUntil: true,
        sealCandidateObjectKey: true,
        sealCandidateSourceETag: true,
        sealLeaseToken: true,
        sealLeaseUntil: true,
        status: true,
        retentionUntil: true,
        objectDeletedAt: true,
        objectDeletionPendingAt: true,
        correlationId: true,
        elder: {
          select: {
            consentRecords: {
              where: {
                purpose: { in: ['VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS'] },
                supersededAt: null,
                effectiveAt: { lte: now },
              },
              select: { purpose: true, decision: true, expiresAt: true },
            },
          },
        },
        transcript: {
          select: {
            id: true,
            retentionUntil: true,
            contentDeletedAt: true,
            analysis: {
              select: { id: true, retentionUntil: true, contentDeletedAt: true },
            },
          },
        },
      },
      orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(limit, 500)),
    });
    return records.map(({ elder, ...record }) => {
      const activePurposes = new Set(
        elder.consentRecords
          .filter(
            (consent) =>
              consent.decision === 'GRANTED' &&
              (consent.expiresAt === null || consent.expiresAt > now),
          )
          .map((consent) => consent.purpose),
      );
      return {
        ...record,
        consentActive:
          activePurposes.has('VOICE_CAPTURE') &&
          activePurposes.has('TRANSCRIPTION_AI_ANALYSIS'),
      };
    });
  }

  async purgeDerivedContent(
    candidate: VoiceRetentionCandidate,
    deletedAt: Date,
  ): Promise<VoiceDerivedContentPurgeResult> {
    const transcript = candidate.transcript;
    if (transcript === null) {
      return { transcriptContentDeleted: false, analysisContentDeleted: false };
    }
    const transcriptId = transcript.id;
    return this.database.$transaction(async (transaction) => {
      const reasonCode = retentionReasonCode(candidate);
      let transcriptContentDeleted = false;
      let analysisContentDeleted = false;

      if (
        transcript.contentDeletedAt === null &&
        (!candidate.consentActive ||
          candidate.status === 'CANCELLED' ||
          transcript.retentionUntil <= deletedAt)
      ) {
        const changed = await transaction.transcript.updateMany({
          where: { id: transcriptId, contentDeletedAt: null },
          data: { text: null, contentDeletedAt: deletedAt, version: { increment: 1 } },
        });
        transcriptContentDeleted = changed.count === 1;
        if (transcriptContentDeleted) {
          await transaction.auditEvent.create({
            data: systemAudit(candidate, {
              action: 'VOICE_RETENTION.TRANSCRIPT_CONTENT_DELETE',
              outcome: 'SUCCESS',
              reasonCode,
              resourceType: 'TRANSCRIPT',
              resourceId: transcriptId,
              occurredAt: deletedAt,
            }),
          });
        }
      }

      const analysis = transcript.analysis;
      if (
        analysis !== null &&
        analysis.contentDeletedAt === null &&
        (!candidate.consentActive ||
          candidate.status === 'CANCELLED' ||
          analysis.retentionUntil <= deletedAt)
      ) {
        const changed = await transaction.aIAnalysis.updateMany({
          where: { id: analysis.id, contentDeletedAt: null },
          data: {
            output: Prisma.DbNull,
            evidence: [],
            contentDeletedAt: deletedAt,
            version: { increment: 1 },
          },
        });
        analysisContentDeleted = changed.count === 1;
        if (analysisContentDeleted) {
          await transaction.auditEvent.create({
            data: systemAudit(candidate, {
              action: 'VOICE_RETENTION.AI_ANALYSIS_CONTENT_DELETE',
              outcome: 'SUCCESS',
              reasonCode,
              resourceType: 'AI_ANALYSIS',
              resourceId: analysis.id,
              occurredAt: deletedAt,
            }),
          });
        }
      }

      return { transcriptContentDeleted, analysisContentDeleted };
    });
  }

  async fenceObjectDeletion(
    candidate: VoiceRetentionCandidate,
    fencedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    if (candidate.objectDeletionPendingAt !== null) return candidate;
    const cancelUnfinished =
      candidate.status === 'UPLOAD_PENDING' ||
      candidate.status === 'UPLOADED' ||
      candidate.status === 'PROCESSING';
    const reasonCode = retentionReasonCode(candidate);
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.voiceSubmission.updateMany({
        where: retentionCandidateCas(candidate),
        data: {
          objectDeletionPendingAt: fencedAt,
          ...(cancelUnfinished
            ? {
                status: 'CANCELLED' as const,
                failureCode: reasonCode,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) return null;
      await transaction.auditEvent.create({
        data: systemAudit(candidate, {
          action: 'VOICE_RETENTION.OBJECT_DELETE_FENCE',
          outcome: 'SUCCESS',
          reasonCode,
          resourceType: 'VOICE_SUBMISSION',
          resourceId: candidate.id,
          occurredAt: fencedAt,
        }),
      });
      return {
        ...candidate,
        status: cancelUnfinished ? 'CANCELLED' : candidate.status,
        objectDeletionPendingAt: fencedAt,
        version: candidate.version + 1,
      };
    });
  }

  async markObjectDeleted(candidate: VoiceRetentionCandidate, deletedAt: Date): Promise<boolean> {
    if (
      candidate.objectDeletionPendingAt === null ||
      candidate.uploadObjectKey !== null ||
      candidate.uploadAuthorizedUntil !== null ||
      candidate.sealCandidateObjectKey !== null ||
      candidate.sealCandidateSourceETag !== null ||
      candidate.sealLeaseToken !== null ||
      candidate.sealLeaseUntil !== null ||
      candidate.objectDeletionPendingAt.getTime() + DELETION_FENCE_SETTLE_GRACE_MS >
        deletedAt.getTime()
    ) return false;
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.voiceSubmission.updateMany({
        where: retentionCandidateCas(candidate),
        data: { objectDeletedAt: deletedAt, version: { increment: 1 } },
      });
      if (changed.count === 0) return false;
      await transaction.auditEvent.create({
        data: systemAudit(candidate, {
          action: 'VOICE_RETENTION.OBJECT_DELETE',
          outcome: 'SUCCESS',
          reasonCode: retentionReasonCode(candidate),
          resourceType: 'VOICE_SUBMISSION',
          resourceId: candidate.id,
          occurredAt: deletedAt,
        }),
      });
      return true;
    });
  }

  async clearUploadAuthorization(
    candidate: VoiceRetentionCandidate,
    clearedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    if (
      candidate.uploadObjectKey === null ||
      candidate.uploadAuthorizedUntil === null ||
      candidate.uploadAuthorizedUntil.getTime() + UPLOAD_AUTHORIZATION_CLOCK_GRACE_MS >
        clearedAt.getTime()
    ) return null;
    const cancelExpiredPending = candidate.status === 'UPLOAD_PENDING';
    const deletionPendingAt = cancelExpiredPending
      ? candidate.objectDeletionPendingAt ?? clearedAt
      : candidate.objectDeletionPendingAt;
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.voiceSubmission.updateMany({
        where: retentionCandidateCas(candidate),
        data: {
          uploadObjectKey: null,
          uploadAuthorizedUntil: null,
          ...(cancelExpiredPending
            ? {
                status: 'CANCELLED' as const,
                failureCode: 'UPLOAD_AUTHORIZATION_EXPIRED',
                objectDeletionPendingAt: deletionPendingAt,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) return null;
      await transaction.auditEvent.create({
        data: systemAudit(candidate, {
          action: 'VOICE_RETENTION.STAGING_AUTHORIZATION_CLEAR',
          outcome: 'SUCCESS',
          reasonCode: 'UPLOAD_AUTHORIZATION_EXPIRED',
          resourceType: 'VOICE_SUBMISSION',
          resourceId: candidate.id,
          occurredAt: clearedAt,
        }),
      });
      return {
        ...candidate,
        status: cancelExpiredPending ? 'CANCELLED' : candidate.status,
        uploadObjectKey: null,
        uploadAuthorizedUntil: null,
        objectDeletionPendingAt: deletionPendingAt,
        version: candidate.version + 1,
      };
    });
  }

  async claimSealCandidateCleanup(
    candidate: VoiceRetentionCandidate,
    claimedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    if (
      candidate.sealCandidateObjectKey === null ||
      candidate.sealCandidateSourceETag === null ||
      candidate.sealLeaseToken === null ||
      candidate.sealLeaseUntil === null ||
      candidate.sealLeaseUntil.getTime() + SEAL_COPY_SETTLE_GRACE_MS > claimedAt.getTime()
    ) return null;
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.voiceSubmission.updateMany({
        where: retentionCandidateCas(candidate),
        data: { version: { increment: 1 } },
      });
      if (changed.count === 0) return null;
      await transaction.auditEvent.create({
        data: systemAudit(candidate, {
          action: 'VOICE_RETENTION.SEAL_CANDIDATE_DELETE_CLAIM',
          outcome: 'SUCCESS',
          reasonCode: retentionReasonCode(candidate),
          resourceType: 'VOICE_SUBMISSION',
          resourceId: candidate.id,
          occurredAt: claimedAt,
        }),
      });
      return { ...candidate, version: candidate.version + 1 };
    });
  }

  async clearSealCandidate(
    candidate: VoiceRetentionCandidate,
    clearedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    if (
      candidate.sealCandidateObjectKey === null ||
      candidate.sealCandidateSourceETag === null ||
      candidate.sealLeaseToken === null ||
      candidate.sealLeaseUntil === null
    ) return null;
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.voiceSubmission.updateMany({
        where: retentionCandidateCas(candidate),
        data: {
          sealCandidateObjectKey: null,
          sealCandidateSourceETag: null,
          sealLeaseToken: null,
          sealLeaseUntil: null,
          version: { increment: 1 },
        },
      });
      if (changed.count === 0) return null;
      await transaction.auditEvent.create({
        data: systemAudit(candidate, {
          action: 'VOICE_RETENTION.SEAL_CANDIDATE_DELETE',
          outcome: 'SUCCESS',
          reasonCode: retentionReasonCode(candidate),
          resourceType: 'VOICE_SUBMISSION',
          resourceId: candidate.id,
          occurredAt: clearedAt,
        }),
      });
      return {
        ...candidate,
        sealCandidateObjectKey: null,
        sealCandidateSourceETag: null,
        sealLeaseToken: null,
        sealLeaseUntil: null,
        version: candidate.version + 1,
      };
    });
  }

  async recordObjectDeleteFailure(
    candidate: VoiceRetentionCandidate,
    reasonCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.database.auditEvent.create({
      data: systemAudit(candidate, {
        action: 'VOICE_RETENTION.OBJECT_DELETE',
        outcome: 'FAILURE',
        reasonCode,
        resourceType: 'VOICE_SUBMISSION',
        resourceId: candidate.id,
        occurredAt,
      }),
    });
  }
}

export class S3VoiceObjectDeletionStore implements VoiceObjectDeletionStore {
  readonly bucketName: string;
  private readonly client: S3Client;
  private readonly stagingSweepMinAgeMs: number;
  private stagingSweepContinuationToken: string | undefined;

  constructor(config: Pick<ServiceConfig,
    | 'minioEndpoint'
    | 'minioAccessKey'
    | 'minioSecretKey'
    | 'minioBucket'
    | 'voiceStagingSweepMinAgeSeconds'
  >) {
    this.bucketName = config.minioBucket;
    this.stagingSweepMinAgeMs = config.voiceStagingSweepMinAgeSeconds * 1_000;
    this.client = new S3Client({
      endpoint: config.minioEndpoint,
      forcePathStyle: true,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.minioAccessKey,
        secretAccessKey: config.minioSecretKey,
      },
    });
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: objectKey }));
  }

  async sweepStaleStagingObjects(
    now: Date,
    limit: number,
    findReferencedKeys: (
      bucket: string,
      objectKeys: readonly string[],
    ) => Promise<ReadonlySet<string>>,
  ): Promise<{ readonly deleted: number; readonly failures: number }> {
    let page: ListObjectsV2CommandOutput;
    try {
      page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: MANAGED_STAGING_PREFIX,
        ContinuationToken: this.stagingSweepContinuationToken,
        MaxKeys: Math.max(1, Math.min(limit, 1_000)),
      }));
    } catch (error) {
      // A continuation token can become invalid after concurrent lifecycle
      // deletion. Restart from the prefix on the next run instead of wedging.
      this.stagingSweepContinuationToken = undefined;
      throw error;
    }
    this.stagingSweepContinuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
    const staleBefore = now.getTime() - this.stagingSweepMinAgeMs;
    const staleObjectKeys = (page.Contents ?? []).flatMap((object) =>
      object.Key !== undefined &&
      object.Key.startsWith(MANAGED_STAGING_PREFIX) &&
      object.LastModified !== undefined &&
      object.LastModified.getTime() <= staleBefore
        ? [object.Key]
        : [],
    );
    // Fail closed: if the database protection lookup fails, no object is
    // deleted. A key is orphaned only after no row in this bucket references it.
    const referencedKeys = await findReferencedKeys(this.bucketName, staleObjectKeys);
    let deleted = 0;
    let failures = 0;
    for (const objectKey of staleObjectKeys) {
      if (referencedKeys.has(objectKey)) continue;
      try {
        await this.delete(objectKey);
        deleted += 1;
      } catch {
        failures += 1;
      }
    }
    return { deleted, failures };
  }
}

function managedStagingObjectKey(candidate: VoiceRetentionCandidate): string {
  return `voice/staging/${candidate.organizationId}/${candidate.facilityId}/${candidate.elderId}/${candidate.id}`;
}

function isManagedAuthoritativeObjectKey(candidate: VoiceRetentionCandidate): boolean {
  if (candidate.objectKey === managedStagingObjectKey(candidate)) return true;
  return isManagedSealedObjectKey(candidate, candidate.objectKey);
}

function isManagedSealedObjectKey(
  candidate: VoiceRetentionCandidate,
  objectKey: string,
): boolean {
  const prefix = `voice/sealed/${candidate.organizationId}/${candidate.facilityId}/${candidate.elderId}/${candidate.id}/`;
  const nonce = objectKey.startsWith(prefix)
    ? objectKey.slice(prefix.length)
    : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    nonce,
  );
}

function retentionCandidateCas(
  candidate: VoiceRetentionCandidate,
): Prisma.VoiceSubmissionWhereInput {
  return {
    id: candidate.id,
    organizationId: candidate.organizationId,
    facilityId: candidate.facilityId,
    version: candidate.version,
    status: candidate.status,
    objectKey: candidate.objectKey,
    uploadObjectKey: candidate.uploadObjectKey,
    uploadAuthorizedUntil: candidate.uploadAuthorizedUntil,
    sealCandidateObjectKey: candidate.sealCandidateObjectKey,
    sealCandidateSourceETag: candidate.sealCandidateSourceETag,
    sealLeaseToken: candidate.sealLeaseToken,
    sealLeaseUntil: candidate.sealLeaseUntil,
    objectDeletionPendingAt: candidate.objectDeletionPendingAt,
    objectDeletedAt: candidate.objectDeletedAt,
  };
}

function retentionReasonCode(candidate: VoiceRetentionCandidate): string {
  if (candidate.status === 'CANCELLED') return 'VOICE_SUBMISSION_CANCELLED';
  if (!candidate.consentActive) return 'VOICE_CONSENT_NOT_ACTIVE';
  return 'RETENTION_EXPIRED';
}

function systemAudit(
  candidate: VoiceRetentionCandidate,
  input: {
    readonly action: string;
    readonly outcome: 'FAILURE' | 'SUCCESS';
    readonly reasonCode: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly occurredAt: Date;
  },
): Prisma.AuditEventUncheckedCreateInput {
  return {
    organizationId: candidate.organizationId,
    facilityId: candidate.facilityId,
    actorType: 'SYSTEM',
    action: input.action,
    outcome: input.outcome,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    reasonCode: input.reasonCode,
    correlationId: candidate.correlationId,
    safeMetadata: { source: 'm03-retention-worker' },
    occurredAt: input.occurredAt,
  };
}
