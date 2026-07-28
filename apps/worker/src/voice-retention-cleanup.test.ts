import { readFile } from 'node:fs/promises';
import type { Prisma, PrismaClient } from '@eldercare/db';
import { describe, expect, it, vi } from 'vitest';
import {
  PrismaVoiceRetentionRepository,
  S3VoiceObjectDeletionStore,
  VoiceRetentionCleanup,
  type VoiceObjectDeletionStore,
  type VoiceRetentionCandidate,
  type VoiceRetentionCursor,
  type VoiceRetentionRepository,
} from './voice-retention-cleanup.js';

const now = new Date('2026-07-22T08:00:00.000Z');
const organizationId = '10000000-0000-4000-8000-000000000001';
const facilityId = '20000000-0000-4000-8000-000000000001';
const elderId = '30000000-0000-4000-8000-000000000001';
const submissionId = '40000000-0000-4000-8000-000000000001';
const sealedNonce = '70000000-0000-4000-8000-000000000001';

function candidate(overrides: Partial<VoiceRetentionCandidate> = {}): VoiceRetentionCandidate {
  return {
    id: submissionId,
    version: 1,
    organizationId,
    facilityId,
    elderId,
    bucket: 'eldercare-private',
    objectKey: `voice/sealed/${organizationId}/${facilityId}/${elderId}/${submissionId}/${sealedNonce}`,
    uploadObjectKey: null,
    uploadAuthorizedUntil: null,
    sealCandidateObjectKey: null,
    sealCandidateSourceETag: null,
    sealLeaseToken: null,
    sealLeaseUntil: null,
    status: 'COMPLETED',
    retentionUntil: new Date('2026-07-21T08:00:00.000Z'),
    objectDeletedAt: null,
    objectDeletionPendingAt: null,
    consentActive: true,
    correlationId: 'corr-retention-0001',
    transcript: {
      id: '50000000-0000-4000-8000-000000000001',
      retentionUntil: new Date('2026-07-21T08:00:00.000Z'),
      contentDeletedAt: null,
      analysis: {
        id: '60000000-0000-4000-8000-000000000001',
        retentionUntil: new Date('2026-07-21T08:00:00.000Z'),
        contentDeletedAt: null,
      },
    },
    ...overrides,
  };
}

class FakeRepository implements VoiceRetentionRepository {
  readonly transcriptPurges: string[] = [];
  readonly analysisPurges: string[] = [];
  readonly objectMarks: string[] = [];
  readonly failures: string[] = [];
  readonly uploadAuthorizationClears: string[] = [];
  readonly deletionFences: string[] = [];
  readonly sealCandidateClaims: string[] = [];
  readonly sealCandidateClears: string[] = [];
  readonly findCalls: Array<{
    readonly limit: number;
    readonly after: VoiceRetentionCursor | null;
  }> = [];
  suppressCandidates = false;
  failReferenceLookup = false;
  beforeClearUploadAuthorization: ((record: VoiceRetentionCandidate) => void) | null = null;

  constructor(readonly candidates: VoiceRetentionCandidate[]) {}

  async findCandidates(
    _now: Date,
    limit: number,
    after: VoiceRetentionCursor | null = null,
  ): Promise<readonly VoiceRetentionCandidate[]> {
    await Promise.resolve();
    this.findCalls.push({ limit, after });
    if (this.suppressCandidates) return [];
    return [...this.candidates]
      .sort((left, right) =>
        left.retentionUntil.getTime() - right.retentionUntil.getTime() ||
        left.id.localeCompare(right.id),
      )
      .filter((record) =>
        after === null ||
        record.retentionUntil > after.retentionUntil ||
        (
          record.retentionUntil.getTime() === after.retentionUntil.getTime() &&
          record.id > after.id
        ),
      )
      .slice(0, limit);
  }

  async findReferencedStagingObjectKeys(
    bucket: string,
    objectKeys: readonly string[],
  ): Promise<ReadonlySet<string>> {
    await Promise.resolve();
    if (this.failReferenceLookup) throw new Error('synthetic reference lookup failure');
    const candidates = new Set(objectKeys);
    return new Set(
      this.candidates.flatMap((record) =>
        record.bucket === bucket &&
        record.uploadObjectKey !== null &&
        candidates.has(record.uploadObjectKey)
          ? [record.uploadObjectKey]
          : [],
      ),
    );
  }

  async purgeDerivedContent(record: VoiceRetentionCandidate, deletedAt: Date) {
    await Promise.resolve();
    this.transcriptPurges.push(record.id);
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (index < 0 || current?.transcript === null || current?.transcript === undefined) {
      return { transcriptContentDeleted: false, analysisContentDeleted: false };
    }
    const transcriptContentDeleted =
      current.transcript.contentDeletedAt === null &&
      (!current.consentActive ||
        current.status === 'CANCELLED' ||
        current.transcript.retentionUntil <= deletedAt);
    const analysisContentDeleted =
      current.transcript.analysis !== null &&
      current.transcript.analysis.contentDeletedAt === null &&
      (!current.consentActive ||
        current.status === 'CANCELLED' ||
        current.transcript.analysis.retentionUntil <= deletedAt);
    if (analysisContentDeleted) this.analysisPurges.push(record.id);
    this.candidates[index] = {
      ...current,
      transcript: {
        ...current.transcript,
        contentDeletedAt: transcriptContentDeleted ? deletedAt : current.transcript.contentDeletedAt,
        analysis:
          current.transcript.analysis === null
            ? null
            : {
                ...current.transcript.analysis,
                contentDeletedAt: analysisContentDeleted
                  ? deletedAt
                  : current.transcript.analysis.contentDeletedAt,
              },
      },
    };
    return { transcriptContentDeleted, analysisContentDeleted };
  }

  async markObjectDeleted(record: VoiceRetentionCandidate, deletedAt: Date): Promise<boolean> {
    await Promise.resolve();
    this.objectMarks.push(record.id);
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (
      index < 0 ||
      current === undefined ||
      current.version !== record.version ||
      current.objectDeletionPendingAt === null ||
      current.uploadObjectKey !== null ||
      current.uploadAuthorizedUntil !== null ||
      current.sealCandidateObjectKey !== null
    ) return false;
    this.candidates[index] = {
      ...current,
      objectDeletedAt: deletedAt,
      version: current.version + 1,
    };
    return true;
  }

  async fenceObjectDeletion(
    record: VoiceRetentionCandidate,
    fencedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    await Promise.resolve();
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (index < 0 || current === undefined || current.version !== record.version) return null;
    if (current.objectDeletionPendingAt !== null) return current;
    const cancelUnfinished = ['UPLOAD_PENDING', 'UPLOADED', 'PROCESSING'].includes(current.status);
    const updated: VoiceRetentionCandidate = {
      ...current,
      status: cancelUnfinished ? 'CANCELLED' : current.status,
      objectDeletionPendingAt: fencedAt,
      version: current.version + 1,
    };
    this.deletionFences.push(record.id);
    this.candidates[index] = updated;
    return updated;
  }

  async clearUploadAuthorization(
    record: VoiceRetentionCandidate,
    clearedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    await Promise.resolve();
    this.beforeClearUploadAuthorization?.(record);
    this.beforeClearUploadAuthorization = null;
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (
      index < 0 ||
      current === undefined ||
      current.version !== record.version ||
      current.uploadObjectKey === null ||
      current.uploadAuthorizedUntil === null ||
      current.uploadAuthorizedUntil.getTime() + 5_000 > clearedAt.getTime()
    ) return null;
    this.uploadAuthorizationClears.push(record.id);
    const updated: VoiceRetentionCandidate = {
      ...current,
      uploadObjectKey: null,
      uploadAuthorizedUntil: null,
      version: current.version + 1,
      ...(current.status === 'UPLOAD_PENDING'
        ? {
            status: 'CANCELLED' as const,
            objectDeletionPendingAt: current.objectDeletionPendingAt ?? clearedAt,
          }
        : {}),
    };
    this.candidates[index] = updated;
    return updated;
  }

  async claimSealCandidateCleanup(
    record: VoiceRetentionCandidate,
    claimedAt: Date,
  ): Promise<VoiceRetentionCandidate | null> {
    await Promise.resolve();
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (
      index < 0 ||
      current === undefined ||
      current.version !== record.version ||
      current.sealCandidateObjectKey === null ||
      current.sealLeaseUntil === null ||
      current.sealLeaseUntil.getTime() + 5_000 > claimedAt.getTime()
    ) return null;
    const updated = { ...current, version: current.version + 1 };
    this.sealCandidateClaims.push(record.id);
    this.candidates[index] = updated;
    return updated;
  }

  async clearSealCandidate(
    record: VoiceRetentionCandidate,
  ): Promise<VoiceRetentionCandidate | null> {
    await Promise.resolve();
    const index = this.candidates.findIndex((candidateRecord) => candidateRecord.id === record.id);
    const current = this.candidates[index];
    if (
      index < 0 ||
      current === undefined ||
      current.version !== record.version ||
      current.sealCandidateObjectKey === null
    ) return null;
    this.sealCandidateClears.push(record.id);
    const updated: VoiceRetentionCandidate = {
      ...current,
      sealCandidateObjectKey: null,
      sealCandidateSourceETag: null,
      sealLeaseToken: null,
      sealLeaseUntil: null,
      version: current.version + 1,
    };
    this.candidates[index] = updated;
    return updated;
  }

  async recordObjectDeleteFailure(_record: VoiceRetentionCandidate, reasonCode: string): Promise<void> {
    await Promise.resolve();
    this.failures.push(reasonCode);
  }
}

class FakeStorage implements VoiceObjectDeletionStore {
  readonly bucketName = 'eldercare-private';
  readonly deleted: string[] = [];
  readonly existing = new Set<string>();
  readonly modifiedAt = new Map<string, Date>();
  readonly failKeys = new Set<string>();
  failNext = false;

  put(objectKey: string, lastModified = now): void {
    this.existing.add(objectKey);
    this.modifiedAt.set(objectKey, lastModified);
  }

  async delete(objectKey: string): Promise<void> {
    await Promise.resolve();
    if (this.failKeys.has(objectKey) || this.failNext) {
      this.failNext = false;
      throw new Error('synthetic storage failure');
    }
    this.deleted.push(objectKey);
    this.existing.delete(objectKey);
    this.modifiedAt.delete(objectKey);
  }

  async sweepStaleStagingObjects(
    sweepAt: Date,
    limit: number,
    findReferencedKeys: (
      bucket: string,
      objectKeys: readonly string[],
    ) => Promise<ReadonlySet<string>>,
  ): Promise<{ readonly deleted: number; readonly failures: number }> {
    const staleBefore = sweepAt.getTime() - 900_000;
    const staleKeys = [...this.existing].slice(0, limit).filter((objectKey) => {
      const lastModified = this.modifiedAt.get(objectKey);
      return objectKey.startsWith('voice/staging/') &&
        lastModified !== undefined &&
        lastModified.getTime() <= staleBefore;
    });
    const referencedKeys = await findReferencedKeys(this.bucketName, staleKeys);
    let deleted = 0;
    let failures = 0;
    for (const objectKey of staleKeys) {
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

function loggerEntries() {
  const entries: unknown[] = [];
  return {
    entries,
    logger: {
      info: (_message: string, context?: unknown) => entries.push(context),
      warn: (_message: string, context?: unknown) => entries.push(context),
    },
  };
}

describe('voice retention cleanup', () => {
  it('advances a bounded keyset window so permanent oldest failures cannot starve a later consent purge', async () => {
    const deletionFencedAt = new Date('2026-07-20T08:00:00.000Z');
    const blockers = Array.from({ length: 8 }, (_, index) => {
      const id = `41000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return candidate({
        id,
        objectKey: `voice/sealed/${organizationId}/${facilityId}/${elderId}/${id}/${sealedNonce}`,
        retentionUntil: new Date(`2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`),
        objectDeletionPendingAt: deletionFencedAt,
        transcript: null,
      });
    });
    const revokedId = '42000000-0000-4000-8000-000000000001';
    const revokedObjectKey =
      `voice/sealed/${organizationId}/${facilityId}/${elderId}/${revokedId}/${sealedNonce}`;
    const revoked = candidate({
      id: revokedId,
      objectKey: revokedObjectKey,
      consentActive: false,
      retentionUntil: new Date('2026-08-22T08:00:00.000Z'),
      objectDeletionPendingAt: deletionFencedAt,
      transcript: {
        id: '52000000-0000-4000-8000-000000000001',
        retentionUntil: new Date('2026-08-22T08:00:00.000Z'),
        contentDeletedAt: null,
        analysis: {
          id: '62000000-0000-4000-8000-000000000001',
          retentionUntil: new Date('2026-08-22T08:00:00.000Z'),
          contentDeletedAt: null,
        },
      },
    });
    const repository = new FakeRepository([...blockers, revoked]);
    const storage = new FakeStorage();
    blockers.forEach((record) => storage.failKeys.add(record.objectKey));
    const logs = loggerEntries();
    const cleanup = new VoiceRetentionCleanup(repository, storage, logs.logger);

    await expect(cleanup.runOnce(now, 2)).resolves.toMatchObject({
      scanned: 8,
      transcriptContentsDeleted: 0,
      analysisContentsDeleted: 0,
      objectsDeleted: 0,
      objectDeleteFailures: 8,
    });
    expect(repository.transcriptPurges).not.toContain(revokedId);
    expect(repository.findCalls[0]).toEqual({ limit: 8, after: null });

    await expect(cleanup.runOnce(now, 2)).resolves.toMatchObject({
      scanned: 1,
      transcriptContentsDeleted: 1,
      analysisContentsDeleted: 1,
      objectsDeleted: 1,
      objectDeleteFailures: 0,
    });
    expect(repository.findCalls[1]).toEqual({
      limit: 8,
      after: {
        retentionUntil: blockers[7]?.retentionUntil,
        id: blockers[7]?.id,
      },
    });
    expect(repository.transcriptPurges).toContain(revokedId);
    expect(repository.analysisPurges).toContain(revokedId);
    expect(repository.objectMarks).toContain(revokedId);
    expect(storage.deleted).toContain(revokedObjectKey);
    expect(repository.candidates.find((record) => record.id === revokedId)).toMatchObject({
      objectDeletedAt: now,
      transcript: {
        contentDeletedAt: now,
        analysis: { contentDeletedAt: now },
      },
    });
    expect(JSON.stringify(logs.entries)).not.toContain(revokedId);
    expect(JSON.stringify(logs.entries)).not.toContain(revokedObjectKey);
  });

  it('applies the compound retention cursor at the Prisma query boundary', async () => {
    const findMany = vi
      .fn<(args: Prisma.VoiceSubmissionFindManyArgs) => Promise<never[]>>()
      .mockResolvedValue([]);
    const database = {
      voiceSubmission: { findMany },
    } as unknown as PrismaClient;
    const repository = new PrismaVoiceRetentionRepository(database);
    const cursor: VoiceRetentionCursor = {
      retentionUntil: new Date('2026-07-21T08:00:00.000Z'),
      id: submissionId,
    };

    await expect(repository.findCandidates(now, 37, cursor)).resolves.toEqual([]);
    const query = findMany.mock.calls[0]?.[0];
    expect(query?.orderBy).toEqual([{ retentionUntil: 'asc' }, { id: 'asc' }]);
    expect(query?.take).toBe(37);
    const clauses = Array.isArray(query?.where?.AND)
      ? query.where.AND
      : [];
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toHaveProperty('OR');
    expect(clauses[1]).toEqual({
      OR: [
        { retentionUntil: { gt: cursor.retentionUntil } },
        {
          retentionUntil: cursor.retentionUntil,
          id: { gt: cursor.id },
        },
      ],
    });
  });

  it('purges transcript and AI-derived content plus private audio while preserving safe operational logs', async () => {
    const repository = new FakeRepository([candidate()]);
    const storage = new FakeStorage();
    const logs = loggerEntries();
    const cleanup = new VoiceRetentionCleanup(repository, storage, logs.logger);

    await expect(cleanup.runOnce(now)).resolves.toEqual({
      scanned: 1,
      transcriptContentsDeleted: 1,
      analysisContentsDeleted: 1,
      stagingObjectsDeleted: 0,
      uploadAuthorizationsCleared: 0,
      sealCandidatesDeleted: 0,
      objectsDeleted: 0,
      objectDeleteFailures: 0,
      staleStagingObjectsDeleted: 0,
      staleStagingDeleteFailures: 0,
    });
    await expect(cleanup.runOnce(new Date(now.getTime() + 6_000))).resolves.toMatchObject({
      objectsDeleted: 1,
    });
    expect(repository.transcriptPurges).toEqual([submissionId]);
    expect(repository.analysisPurges).toEqual([submissionId]);
    expect(repository.objectMarks).toEqual([submissionId]);
    expect(storage.deleted).toEqual([candidate().objectKey, candidate().objectKey]);
    expect(JSON.stringify(logs.entries)).not.toContain(candidate().objectKey);
    expect(JSON.stringify(logs.entries)).not.toContain(submissionId);
    expect(JSON.stringify(logs.entries)).not.toContain(elderId);
  });

  it('sweeps a POST that lands after authoritative deletion without churning the completed DB row', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const sealCandidateKey = `voice/sealed/${organizationId}/${facilityId}/${elderId}/${submissionId}/71000000-0000-4000-8000-000000000001`;
    const authorizedUntil = new Date('2026-07-22T08:05:00.000Z');
    const record = candidate({
      status: 'CANCELLED',
      retentionUntil: new Date('2026-08-22T08:00:00.000Z'),
      uploadObjectKey: stagingKey,
      uploadAuthorizedUntil: authorizedUntil,
      sealCandidateObjectKey: sealCandidateKey,
      sealCandidateSourceETag: '"source-etag-v1"',
      sealLeaseToken: '72000000-0000-4000-8000-000000000001',
      sealLeaseUntil: new Date('2026-07-22T08:00:30.000Z'),
      transcript: null,
    });
    const repository = new FakeRepository([record]);
    const storage = new FakeStorage();
    storage.put(stagingKey);
    storage.put(sealCandidateKey);
    storage.put(record.objectKey);
    const cleanup = new VoiceRetentionCleanup(repository, storage, loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      stagingObjectsDeleted: 1,
      uploadAuthorizationsCleared: 0,
      sealCandidatesDeleted: 0,
      objectsDeleted: 0,
    });
    expect(storage.deleted).toEqual([stagingKey, sealCandidateKey, record.objectKey]);
    expect(repository.candidates[0]?.sealCandidateObjectKey).toBe(sealCandidateKey);
    expect(repository.candidates[0]?.objectDeletedAt).toBeNull();

    // A late copy and an old presigned POST can recreate both keys while their leases remain active.
    storage.put(sealCandidateKey);
    storage.put(stagingKey);
    storage.deleted.length = 0;
    const afterExpiry = new Date('2026-07-22T08:06:00.000Z');
    await expect(cleanup.runOnce(afterExpiry)).resolves.toMatchObject({
      stagingObjectsDeleted: 1,
      uploadAuthorizationsCleared: 1,
      sealCandidatesDeleted: 1,
      objectsDeleted: 1,
    });
    expect(storage.deleted).toEqual([
      stagingKey,
      sealCandidateKey,
      sealCandidateKey,
      record.objectKey,
    ]);
    expect(repository.uploadAuthorizationClears).toEqual([submissionId]);
    expect(repository.candidates[0]?.uploadObjectKey).toBeNull();
    expect(repository.candidates[0]?.uploadAuthorizedUntil).toBeNull();
    expect(repository.candidates[0]?.objectDeletedAt).toEqual(afterExpiry);
    expect(storage.existing.size).toBe(0);

    // The request was authorized before expiry but finishes only after the DB
    // row has cleared its key and marked known object deletion complete.
    const lateCompletion = new Date('2026-07-22T09:00:00.000Z');
    storage.put(stagingKey, lateCompletion);
    storage.deleted.length = 0;
    const versionAfterFinalMark = repository.candidates[0]?.version;
    repository.suppressCandidates = true;

    // The safety window is longer than every presigned authorization, so a
    // recently completed object is not raced by the orphan sweep.
    await expect(cleanup.runOnce(new Date('2026-07-22T09:14:00.000Z'))).resolves.toMatchObject({
      scanned: 0,
      stagingObjectsDeleted: 0,
      staleStagingObjectsDeleted: 0,
    });
    expect(storage.existing.has(stagingKey)).toBe(true);

    await expect(cleanup.runOnce(new Date('2026-07-22T09:16:00.000Z'))).resolves.toMatchObject({
      scanned: 0,
      stagingObjectsDeleted: 0,
      staleStagingObjectsDeleted: 1,
      staleStagingDeleteFailures: 0,
      uploadAuthorizationsCleared: 0,
      objectsDeleted: 0,
      objectDeleteFailures: 0,
    });
    expect(storage.deleted).toEqual([stagingKey]);
    expect(storage.existing.has(stagingKey)).toBe(false);
    expect(repository.candidates[0]).toMatchObject({
      uploadObjectKey: null,
      uploadAuthorizedUntil: null,
      objectDeletedAt: afterExpiry,
    });
    expect(repository.candidates[0]?.version).toBe(versionAfterFinalMark);
  });

  it('protects a stale staging object while any exact bucket key reference is still active', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const record = candidate({
      status: 'UPLOAD_PENDING',
      objectKey: stagingKey,
      uploadObjectKey: stagingKey,
      uploadAuthorizedUntil: new Date('2026-07-22T08:05:00.000Z'),
      retentionUntil: new Date('2026-07-23T08:00:00.000Z'),
      transcript: null,
    });
    const repository = new FakeRepository([record]);
    const storage = new FakeStorage();
    storage.put(stagingKey, new Date('2026-07-22T07:00:00.000Z'));
    const cleanup = new VoiceRetentionCleanup(repository, storage, loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      staleStagingObjectsDeleted: 0,
      staleStagingDeleteFailures: 0,
    });
    expect(storage.existing.has(stagingKey)).toBe(true);
    expect(storage.deleted).toEqual([]);
    expect(repository.candidates[0]?.version).toBe(record.version);
  });

  it('fails closed when staging orphan reference protection cannot be checked', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const repository = new FakeRepository([]);
    repository.failReferenceLookup = true;
    const storage = new FakeStorage();
    storage.put(stagingKey, new Date('2026-07-22T07:00:00.000Z'));
    const cleanup = new VoiceRetentionCleanup(repository, storage, loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      scanned: 0,
      staleStagingObjectsDeleted: 0,
      staleStagingDeleteFailures: 1,
    });
    expect(storage.existing.has(stagingKey)).toBe(true);
    expect(storage.deleted).toEqual([]);
  });

  it('can purge expired AI evidence independently while retaining transcript content until its deadline', async () => {
    const future = new Date('2026-07-23T08:00:00.000Z');
    const repository = new FakeRepository([
      candidate({
        retentionUntil: future,
        transcript: {
          id: '50000000-0000-4000-8000-000000000001',
          retentionUntil: future,
          contentDeletedAt: null,
          analysis: {
            id: '60000000-0000-4000-8000-000000000001',
            retentionUntil: new Date('2026-07-21T08:00:00.000Z'),
            contentDeletedAt: null,
          },
        },
      }),
    ]);
    const cleanup = new VoiceRetentionCleanup(repository, new FakeStorage(), loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      transcriptContentsDeleted: 0,
      analysisContentsDeleted: 1,
      objectsDeleted: 0,
    });
    expect(repository.candidates[0]?.transcript?.contentDeletedAt).toBeNull();
    expect(repository.candidates[0]?.transcript?.analysis?.contentDeletedAt).toEqual(now);
  });

  it('treats withdrawn or missing consent as immediate expiry for every sensitive artifact', async () => {
    const future = new Date('2026-08-22T08:00:00.000Z');
    const repository = new FakeRepository([
      candidate({
        consentActive: false,
        retentionUntil: future,
        transcript: {
          id: '50000000-0000-4000-8000-000000000001',
          retentionUntil: future,
          contentDeletedAt: null,
          analysis: {
            id: '60000000-0000-4000-8000-000000000001',
            retentionUntil: future,
            contentDeletedAt: null,
          },
        },
      }),
    ]);
    const storage = new FakeStorage();
    const cleanup = new VoiceRetentionCleanup(repository, storage, loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      transcriptContentsDeleted: 1,
      analysisContentsDeleted: 1,
      objectsDeleted: 0,
      objectDeleteFailures: 0,
    });
    await expect(cleanup.runOnce(new Date(now.getTime() + 6_000))).resolves.toMatchObject({
      objectsDeleted: 1,
    });
    expect(storage.deleted).toEqual([candidate().objectKey, candidate().objectKey]);
  });

  it('leaves a failed object deletion unmarked so the next run retries idempotently', async () => {
    const repository = new FakeRepository([candidate({ transcript: null })]);
    const storage = new FakeStorage();
    storage.failNext = true;
    const logs = loggerEntries();
    const cleanup = new VoiceRetentionCleanup(repository, storage, logs.logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({ objectDeleteFailures: 1, objectsDeleted: 0 });
    expect(repository.failures).toEqual(['OBJECT_STORAGE_DELETE_FAILED']);
    expect(repository.candidates[0]?.objectDeletedAt).toBeNull();

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({ objectDeleteFailures: 0, objectsDeleted: 0 });
    await expect(cleanup.runOnce(new Date(now.getTime() + 6_000))).resolves.toMatchObject({
      objectDeleteFailures: 0,
      objectsDeleted: 1,
    });
    expect(storage.deleted).toEqual([candidate().objectKey, candidate().objectKey]);
    expect(repository.candidates[0]?.objectDeletedAt).toEqual(new Date(now.getTime() + 6_000));
  });

  it('does not let a stale upload-expiry snapshot cancel or delete a finalized sealed object', async () => {
    const stagingKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const finalizedKey = candidate().objectKey;
    const pending = candidate({
      status: 'UPLOAD_PENDING',
      objectKey: stagingKey,
      uploadObjectKey: stagingKey,
      uploadAuthorizedUntil: new Date(now.getTime() - 10_000),
      sealCandidateObjectKey: finalizedKey,
      sealCandidateSourceETag: '"etag-v1"',
      sealLeaseToken: '72000000-0000-4000-8000-000000000002',
      sealLeaseUntil: new Date(now.getTime() - 10_000),
      retentionUntil: new Date(now.getTime() + 86_400_000),
      transcript: null,
    });
    const repository = new FakeRepository([pending]);
    repository.beforeClearUploadAuthorization = () => {
      const current = repository.candidates[0];
      if (current === undefined) return;
      repository.candidates[0] = {
        ...current,
        status: 'COMPLETED',
        objectKey: finalizedKey,
        sealCandidateObjectKey: null,
        sealCandidateSourceETag: null,
        sealLeaseToken: null,
        sealLeaseUntil: null,
        version: current.version + 1,
      };
    };
    const storage = new FakeStorage();
    storage.put(stagingKey);
    storage.put(finalizedKey);
    const cleanup = new VoiceRetentionCleanup(repository, storage, loggerEntries().logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      stagingObjectsDeleted: 1,
      uploadAuthorizationsCleared: 0,
      sealCandidatesDeleted: 0,
      objectsDeleted: 0,
    });
    expect(repository.candidates[0]).toMatchObject({
      status: 'COMPLETED',
      objectKey: finalizedKey,
      objectDeletedAt: null,
    });
    expect(storage.deleted).toEqual([stagingKey]);
    expect(storage.existing.has(finalizedKey)).toBe(true);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({
      uploadAuthorizationsCleared: 1,
      objectsDeleted: 0,
    });
    expect(repository.candidates[0]).toMatchObject({
      status: 'COMPLETED',
      uploadObjectKey: null,
      uploadAuthorizedUntil: null,
      objectDeletedAt: null,
    });
    expect(storage.existing.has(finalizedKey)).toBe(true);
  });

  it('configures an independent one-day object-store fallback for staging objects only', async () => {
    const lifecyclePath = new URL(
      '../../../infra/docker/minio/voice-lifecycle.json',
      import.meta.url,
    );
    const lifecycle = JSON.parse(await readFile(lifecyclePath, 'utf8')) as {
      Rules?: Array<{
        ID?: string;
        Status?: string;
        Filter?: { Prefix?: string };
        Expiration?: { Days?: number };
      }>;
    };

    expect(lifecycle.Rules).toEqual([
      {
        ID: 'expire-voice-staging-fallback',
        Status: 'Enabled',
        Filter: { Prefix: 'voice/staging/' },
        Expiration: { Days: 1 },
      },
    ]);
  });

  it('rotates S3 staging pages and deletes only objects older than the configured safety window', async () => {
    const storage = new S3VoiceObjectDeletionStore({
      minioEndpoint: 'http://127.0.0.1:9000',
      minioAccessKey: 'test-access',
      minioSecretKey: 'test-secret',
      minioBucket: 'eldercare-private',
      voiceStagingSweepMinAgeSeconds: 900,
    });
    const staleKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
    const freshKey = `voice/staging/${organizationId}/${facilityId}/${elderId}/41000000-0000-4000-8000-000000000001`;
    const send = vi.fn()
      .mockResolvedValueOnce({
        IsTruncated: true,
        NextContinuationToken: 'page-2',
        Contents: [
          { Key: staleKey, LastModified: new Date('2026-07-22T07:44:00.000Z') },
          { Key: freshKey, LastModified: new Date('2026-07-22T07:46:00.000Z') },
          { Key: candidate().objectKey, LastModified: new Date('2026-07-22T07:00:00.000Z') },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ IsTruncated: false, Contents: [] });
    Reflect.set(storage, 'client', { send });

    const findReferencedKeys = vi.fn().mockResolvedValue(new Set<string>());
    await expect(storage.sweepStaleStagingObjects(now, 250, findReferencedKeys)).resolves.toEqual({
      deleted: 1,
      failures: 0,
    });
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: { Bucket: 'eldercare-private', Prefix: 'voice/staging/', MaxKeys: 250 },
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      input: { Bucket: 'eldercare-private', Key: staleKey },
    });
    expect(findReferencedKeys).toHaveBeenCalledWith('eldercare-private', [staleKey]);

    await expect(storage.sweepStaleStagingObjects(now, 250, findReferencedKeys)).resolves.toEqual({
      deleted: 0,
      failures: 0,
    });
    expect(send.mock.calls[2]?.[0]).toMatchObject({
      input: { Prefix: 'voice/staging/', ContinuationToken: 'page-2' },
    });
  });

  it('never deletes a bucket key that is not bound to the candidate tenant path', async () => {
    const repository = new FakeRepository([
      candidate({ objectKey: 'voice/another-tenant/private-object' }),
    ]);
    const storage = new FakeStorage();
    const logs = loggerEntries();
    const cleanup = new VoiceRetentionCleanup(repository, storage, logs.logger);

    await expect(cleanup.runOnce(now)).resolves.toMatchObject({ objectDeleteFailures: 1, objectsDeleted: 0 });
    expect(storage.deleted).toEqual([]);
    expect(repository.failures).toEqual(['OBJECT_KEY_SCOPE_MISMATCH']);
  });
});
