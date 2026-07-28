import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ServiceConfig } from '@eldercare/config';
import {
  caregiverCompletionVoiceResultSchema,
  elderVoiceDemoResponseSchema,
  familySummariesPageSchema,
  HIGH_RISK_COMPLETION_CHECKLIST_CODES,
  needSchema,
  needsPageSchema,
  ratingSchema,
  workOrderArrivalSchema,
  workOrderSchema,
  voiceUploadIntentSchema,
} from '@eldercare/contracts';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { configureHttpApplication } from '../../src/http-application.js';
import { ObjectStorageService } from '../../src/m03/object-storage.service.js';
import { SERVICE_CONFIG } from '../../src/tokens.js';

const ORIGIN = 'http://127.0.0.1:3001';
const DEMO_PASSWORD = 'LocalDemoOnly!2026';
const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';
const FACILITY_ID = '20000000-0000-4000-8000-000000000001';
type TestAgent = ReturnType<typeof request.agent>;

describe.sequential('M03 voice request and auditable work-order workflow', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let storage: ObjectStorageService;
  const previousRateLimitPrefix = process.env['AUTH_RATE_LIMIT_KEY_PREFIX'];
  const previousCorsOrigins = process.env['CORS_ORIGINS'];

  beforeAll(async () => {
    process.env['AUTH_RATE_LIMIT_KEY_PREFIX'] = `eldercare:m03-integration:${Date.now()}`;
    process.env['CORS_ORIGINS'] = ORIGIN;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureHttpApplication(app, app.get<ServiceConfig>(SERVICE_CONFIG));
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    storage = app.get(ObjectStorageService);
  });

  afterAll(async () => {
    await app?.close();
    restoreEnvironment('AUTH_RATE_LIMIT_KEY_PREFIX', previousRateLimitPrefix);
    restoreEnvironment('CORS_ORIGINS', previousCorsOrigins);
  });

  it('runs the deterministic voice-to-rating loop with atomic acceptance and private family projection', async () => {
    const idempotencyKey = `m03-main-${Date.now()}`;
    const elder = request.agent(server);
    const elderLogin = await login(elder, 'elder.demo');
    const elderCsrf = readCsrfToken(elderLogin);

    const demoResponse = await elder
      .post('/elder/voice-submissions/demo')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ fixtureKey: 'HOT_WATER_DIZZINESS_V1', idempotencyKey })
      .expect(200);
    const demo = elderVoiceDemoResponseSchema.parse(demoResponse.body);
    expect(demo.needs).toHaveLength(2);
    expect(demo.needs.map((need) => need.category)).toEqual(
      expect.arrayContaining(['DAILY_LIVING', 'HEALTH_CONCERN']),
    );
    const healthNeed = demo.needs.find((need) => need.category === 'HEALTH_CONCERN');
    expect(healthNeed?.priority).toBe('PRIORITY');
    expect(healthNeed?.requiresHumanReview).toBe(true);
    expect(healthNeed?.safetyRuleCodes).toContain('HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW');
    expect(demo.workOrder?.status).toBe('NEW');
    const initialWorkOrder = demo.workOrder;
    const workOrderId = initialWorkOrder?.id;
    if (initialWorkOrder === null || workOrderId === undefined || healthNeed === undefined) {
      throw new Error('Deterministic fixture was incomplete');
    }

    const repeated = await elder
      .post('/elder/voice-submissions/demo')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ fixtureKey: 'HOT_WATER_DIZZINESS_V1', idempotencyKey })
      .expect(200);
    expect(elderVoiceDemoResponseSchema.parse(repeated.body).submission.id).toBe(demo.submission.id);

    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const directorCsrf = readCsrfToken(directorLogin);
    const caregiverStaff = await database.client.staffProfile.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, user: { loginName: 'caregiver.demo' } },
      select: { id: true },
    });
    const needsResponse = await director
      .get(adminPath('needs'))
      .query({ page: 1, pageSize: 100, sort: 'createdAt', direction: 'desc' })
      .expect(200);
    const rawNeedsPage = bodyRecord(needsResponse);
    const needs = needsPageSchema.parse({
      ...rawNeedsPage,
      items: unknownArray(rawNeedsPage, 'items').map((need) => omitKeys(bodyRecord(need), ['elder'])),
    });
    expect(needs.items.some((need) => need.id === healthNeed.id)).toBe(true);

    const blockedBeforeReview = await director
      .post(adminPath(`work-orders/${workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        expectedVersion: initialWorkOrder.version,
        assigneeStaffProfileId: caregiverStaff.id,
        reasonCode: 'MUST_WAIT_FOR_HUMAN_REVIEW',
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(blockedBeforeReview).error).code).toBe('NEED_REVIEW_REQUIRED');

    const reviewedSummary = '人工复核：优先提供温水，并立即由工作人员查看当前状态。';
    const reviewedPriority = 'IMMEDIATE_REVIEW' as const;
    await director
      .post(adminPath(`needs/${healthNeed.id}/review`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        expectedVersion: healthNeed.version,
        decision: 'CONFIRM',
        summary: reviewedSummary,
        category: healthNeed.category,
        priority: reviewedPriority,
        reasonCode: 'SUPERVISOR_CONFIRMED_DETERMINISTIC_REVIEW',
      })
      .expect(200);
    const revisedWorkOrder = bodyRecord(await director
      .get(adminPath(`work-orders/${workOrderId}`))
      .expect(200));
    expect(revisedWorkOrder.summary).toBe(reviewedSummary);
    expect(revisedWorkOrder.priority).toBe(reviewedPriority);
    expect(new Date(String(revisedWorkOrder.dueAt)).getTime()).toBeLessThan(
      new Date(initialWorkOrder.dueAt).getTime(),
    );
    const revisedWorkOrderVersion = revisedWorkOrder.version;
    if (typeof revisedWorkOrderVersion !== 'number') throw new Error('Revised work-order version missing');
    expect(revisedWorkOrderVersion).toBe(initialWorkOrder.version + 1);
    await director
      .post(adminPath(`work-orders/${workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        expectedVersion: initialWorkOrder.version,
        assigneeStaffProfileId: caregiverStaff.id,
        reasonCode: 'STALE_PRE_REVIEW_DECISION',
      })
      .expect(409);

    const assignedResponse = await director
      .post(adminPath(`work-orders/${workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({
        expectedVersion: revisedWorkOrderVersion,
        assigneeStaffProfileId: caregiverStaff.id,
        reasonCode: 'SUPERVISOR_ASSIGNED_CAREGIVER',
      })
      .expect(200);
    expect(bodyRecord(assignedResponse).status).toBe('ASSIGNED');
    const offeredAssignment = await database.client.workOrderAssignment.findFirstOrThrow({
      where: { workOrderId, status: 'OFFERED' },
      select: { assigneeStaffProfileId: true, targetTeamId: true, shiftAssignmentId: true },
    });
    expect(offeredAssignment.assigneeStaffProfileId).toBe(caregiverStaff.id);
    expect(typeof offeredAssignment.targetTeamId).toBe('string');
    expect(typeof offeredAssignment.shiftAssignmentId).toBe('string');

    const caregiver = request.agent(server);
    const caregiverLogin = await login(caregiver, 'caregiver.demo');
    const caregiverCsrf = readCsrfToken(caregiverLogin);
    const caregiverList = await caregiver.get('/caregiver/work-orders').expect(200);
    const assigned = unknownArray(bodyRecord(caregiverList), 'items')
      .map(bodyRecord)
      .find((item) => item.id === workOrderId);
    expect(assigned?.status).toBe('ASSIGNED');
    expect(assigned?.summary).toBe(reviewedSummary);
    expect(assigned?.priority).toBe(reviewedPriority);
    const assignedVersion = assigned?.version;
    if (typeof assignedVersion !== 'number') throw new Error('Assigned work-order version missing');

    const acceptRequests = [1, 2].map(() =>
      caregiver
        .post(`/caregiver/work-orders/${workOrderId}/accept`)
        .set('Origin', ORIGIN)
        .set('x-csrf-token', caregiverCsrf)
        .send({ expectedVersion: assignedVersion, targetStatus: 'ACCEPTED', reasonCode: 'CAREGIVER_ACCEPTED' }),
    );
    const acceptResponses = await Promise.all(acceptRequests);
    expect(acceptResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    const acceptedBody: unknown = acceptResponses.find((response) => response.status === 200)?.body as unknown;
    const accepted = workOrderSchema.parse(stripMobileProjection(acceptedBody));
    expect(await database.client.workOrderAssignment.findFirstOrThrow({
      where: { workOrderId, status: 'CLAIMED' },
      select: { shiftAssignmentId: true },
    })).toEqual({ shiftAssignmentId: offeredAssignment.shiftAssignmentId });
    const acceptedRead = await caregiver.get(`/caregiver/work-orders/${workOrderId}`).expect(200);
    expect(bodyRecord(acceptedRead).status).toBe('ACCEPTED');

    const arrivedResponse = await caregiver
      .post(`/caregiver/work-orders/${workOrderId}/arrive`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({ expectedVersion: accepted.version, reasonCode: 'CAREGIVER_ARRIVED' })
      .expect(200);
    const arrival = workOrderArrivalSchema.parse(arrivedResponse.body);
    expect(arrival.workOrderId).toBe(workOrderId);
    expect(arrival.arrivedAt).toBeTruthy();

    const startedResponse = await caregiver
      .post(`/caregiver/work-orders/${workOrderId}/start`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({ expectedVersion: arrival.toVersion, targetStatus: 'IN_PROGRESS', reasonCode: 'CAREGIVER_STARTED' })
      .expect(200);
    const started = workOrderSchema.parse(stripMobileProjection(startedResponse.body));

    const completionWave = deterministicWaveBuffer();
    const completionChecksumSha256 = createHash('sha256').update(completionWave).digest('hex');
    const completionVoiceIntentResponse = await caregiver
      .post(`/caregiver/work-orders/${workOrderId}/voice-submissions/upload-intents`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        mimeType: 'audio/wav',
        sizeBytes: completionWave.byteLength,
        checksumSha256: completionChecksumSha256,
        fixtureKey: 'CARE_COMPLETION_V1',
        idempotencyKey: `${idempotencyKey}:completion-voice`,
      })
      .expect(200);
    const completionVoiceIntent = voiceUploadIntentSchema.parse(completionVoiceIntentResponse.body);
    await uploadPresignedPost(completionVoiceIntent.upload, completionWave);
    const completionVoiceResultResponse = await caregiver
      .post(
        `/caregiver/work-orders/${workOrderId}/voice-submissions/${completionVoiceIntent.submissionId}/finalize`,
      )
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: completionVoiceIntent.expectedVersion,
        checksumSha256: completionChecksumSha256,
      })
      .expect(200);
    const completionVoiceResult = caregiverCompletionVoiceResultSchema.parse(
      completionVoiceResultResponse.body,
    );
    expect(completionVoiceResult.submission.status).toBe('COMPLETED');
    expect(completionVoiceResult.completionDraft).toEqual(expect.objectContaining({
      requiresCaregiverReview: true,
      voiceSubmissionId: completionVoiceIntent.submissionId,
      workOrderId,
    }));
    if (completionVoiceResult.completionDraft === null) {
      throw new Error('Deterministic caregiver completion draft missing');
    }
    const persistedCompletionVoice = await database.client.voiceSubmission.findUniqueOrThrow({
      where: { id: completionVoiceIntent.submissionId },
      select: { fixtureKey: true, objectKey: true },
    });
    expect(persistedCompletionVoice.fixtureKey).toBe('CARE_COMPLETION_V1');
    expect(persistedCompletionVoice.objectKey).toMatch(/^voice\/sealed\//);

    const partialChecklistResponse = await caregiver
      .post(`/caregiver/work-orders/${workOrderId}/complete`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: started.version,
        noteSource: 'TEXT',
        noteText: 'partial checklist must not persist',
        reasonCode: 'CAREGIVER_COMPLETED',
        idempotencyKey: `${idempotencyKey}:partial-completion`,
        completionChecklist: [{
          code: HIGH_RISK_COMPLETION_CHECKLIST_CODES[0],
          confirmed: true,
        }],
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(partialChecklistResponse).error).code).toBe(
      'COMPLETION_CHECKLIST_INCOMPLETE',
    );
    expect(await database.client.workOrder.findUniqueOrThrow({
      where: { id: workOrderId },
      select: { status: true, version: true },
    })).toEqual({ status: 'IN_PROGRESS', version: started.version });
    expect(await database.client.serviceCompletion.count({ where: { workOrderId } })).toBe(0);
    expect(await database.client.familySummary.count({ where: { workOrderId } })).toBe(0);
    expect(await database.client.workOrderTransition.count({
      where: { workOrderId, toStatus: 'COMPLETED' },
    })).toBe(0);
    expect(await database.client.outboxEvent.count({
      where: { aggregateId: workOrderId, eventType: 'WORK_ORDER.COMPLETED' },
    })).toBe(0);

    const completionBody = {
      expectedVersion: started.version,
      noteSource: 'VOICE',
      noteText: completionVoiceResult.completionDraft.noteText,
      reasonCode: 'CAREGIVER_COMPLETED',
      idempotencyKey: `${idempotencyKey}:completion`,
      voiceSubmissionId: completionVoiceIntent.submissionId,
      completionChecklist: HIGH_RISK_COMPLETION_CHECKLIST_CODES.map((code) => ({
        code,
        confirmed: true as const,
      })),
    } as const;
    const completionResponses = await Promise.all([1, 2].map(() => caregiver
      .post(`/caregiver/work-orders/${workOrderId}/complete`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send(completionBody)));
    expect(completionResponses.map((response) => response.status)).toEqual([200, 200]);
    const completions = completionResponses.map((response) =>
      workOrderSchema.parse(stripMobileProjection(response.body)));
    expect(completions[1]?.id).toBe(completions[0]?.id);
    const completed = completions[0];
    if (completed === undefined) throw new Error('Completion response missing');
    expect(completed.status).toBe('COMPLETED');

    await caregiver
      .post(`/caregiver/work-orders/${workOrderId}/complete`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({ ...completionBody, noteText: 'changed completion content' })
      .expect(409);

    const directorUser = await database.client.user.findFirstOrThrow({
      where: { loginName: 'facility.director' },
      select: { id: true },
    });
    const lowRiskFixture = await createWorkOrderFixture(
      database,
      initialWorkOrder.elderId,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-low-risk-completion`,
      'IN_PROGRESS',
    );
    if (offeredAssignment.targetTeamId === null || offeredAssignment.shiftAssignmentId === null) {
      throw new Error('Claimed caregiver references missing');
    }
    await database.client.workOrderAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        workOrderId: lowRiskFixture.workOrderId,
        targetTeamId: offeredAssignment.targetTeamId,
        assigneeStaffProfileId: caregiverStaff.id,
        shiftAssignmentId: offeredAssignment.shiftAssignmentId,
        status: 'CLAIMED',
        assignedByUserId: directorUser.id,
        reasonCode: 'LOW_RISK_COMPLETION_FIXTURE',
        claimedAt: new Date(),
      },
    });
    await expect(database.client.serviceCompletion.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        elderId: initialWorkOrder.elderId,
        workOrderId: lowRiskFixture.workOrderId,
        submittedByStaffProfileId: caregiverStaff.id,
        noteSource: 'TEXT',
        noteText: 'Invalid partial database checklist.',
        confirmedAt: new Date(),
        completionChecklist: {
          schemaVersion: 1,
          required: true,
          riskReasons: ['SAFETY_RULE_PRESENT'],
          expectedCodes: [...HIGH_RISK_COMPLETION_CHECKLIST_CODES],
          confirmations: [],
        },
        checklistConfirmedAt: new Date(),
        correlationId: `m03-invalid-checklist-${Date.now()}`,
      },
    })).rejects.toBeDefined();
    const lowRiskWithChecklist = await caregiver
      .post(`/caregiver/work-orders/${lowRiskFixture.workOrderId}/complete`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: 5,
        noteSource: 'TEXT',
        noteText: 'Routine service complete.',
        reasonCode: 'CAREGIVER_COMPLETED',
        idempotencyKey: `${idempotencyKey}:low-risk-invalid`,
        completionChecklist: [],
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(lowRiskWithChecklist).error).code).toBe(
      'COMPLETION_CHECKLIST_NOT_ALLOWED',
    );
    expect(await database.client.serviceCompletion.count({
      where: { workOrderId: lowRiskFixture.workOrderId },
    })).toBe(0);
    await caregiver
      .post(`/caregiver/work-orders/${lowRiskFixture.workOrderId}/complete`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', caregiverCsrf)
      .send({
        expectedVersion: 5,
        noteSource: 'TEXT',
        noteText: 'Routine service complete.',
        reasonCode: 'CAREGIVER_COMPLETED',
        idempotencyKey: `${idempotencyKey}:low-risk-valid`,
      })
      .expect(200);
    expect(await database.client.serviceCompletion.findUniqueOrThrow({
      where: { workOrderId: lowRiskFixture.workOrderId },
      select: { completionChecklist: true, checklistConfirmedAt: true },
    })).toEqual({
      completionChecklist: {
        schemaVersion: 1,
        required: false,
        riskReasons: [],
        expectedCodes: [],
        confirmations: [],
      },
      checklistConfirmedAt: null,
    });

    const verifiedResponse = await elder
      .post(`/elder/work-orders/${workOrderId}/verify`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ expectedVersion: completed.version, targetStatus: 'VERIFIED', reasonCode: 'ELDER_CONFIRMED_COMPLETION' })
      .expect(200);
    const verified = workOrderSchema.parse(verifiedResponse.body);

    const ratingBody = {
      expectedWorkOrderVersion: verified.version,
      score: 5,
      requiresFollowUp: false,
      idempotencyKey: `${idempotencyKey}:rating`,
    } as const;
    const ratingResponses = await Promise.all([1, 2].map(() => elder
      .post(`/elder/work-orders/${workOrderId}/ratings`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send(ratingBody)));
    expect(ratingResponses.map((response) => response.status)).toEqual([200, 200]);
    const ratings = ratingResponses.map((response) => ratingSchema.parse(response.body));
    expect(ratings[0]?.score).toBe(5);
    expect(ratings[1]?.id).toBe(ratings[0]?.id);

    await elder
      .post(`/elder/work-orders/${workOrderId}/ratings`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ ...ratingBody, score: 4, comment: 'changed replay' })
      .expect(409);
    await elder
      .post(`/elder/work-orders/${workOrderId}/ratings`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ ...ratingBody, expectedWorkOrderVersion: verified.version + 1 })
      .expect(409);

    const closedResponse = await director
      .post(adminPath(`work-orders/${workOrderId}/close`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .send({ expectedVersion: verified.version, targetStatus: 'CLOSED', reasonCode: 'SUPERVISOR_CLOSED' })
      .expect(200);
    expect(bodyRecord(closedResponse).status).toBe('CLOSED');
    const ratingReplayAfterClose = await elder
      .post(`/elder/work-orders/${workOrderId}/ratings`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send(ratingBody)
      .expect(200);
    expect(ratingSchema.parse(ratingReplayAfterClose.body).id).toBe(ratings[0]?.id);

    const family = request.agent(server);
    await login(family, 'family.demo');
    const summariesResponse = await family.get('/family/summaries').expect(200);
    const summaries = familySummariesPageSchema.parse(summariesResponse.body);
    const summary = summaries.items.find((item) => item.workOrderId === workOrderId);
    expect(summary?.status).toBe('PUBLISHED');
    expect(JSON.stringify(summary)).not.toContain('头晕');
    expect(JSON.stringify(summary)).not.toContain('noteText');
    expect(JSON.stringify(summary)).not.toContain('completionChecklist');

    await family.get(adminPath(`voice-submissions/${demo.submission.id}/transcript`)).expect(404);
    await caregiver.get(adminPath(`voice-submissions/${demo.submission.id}/transcript`)).expect(404);

    const detail = bodyRecord(await director.get(adminPath(`work-orders/${workOrderId}`)).expect(200));
    const transitions = unknownArray(detail, 'transitions').map((transition) => bodyRecord(transition).toStatus);
    expect(transitions).toEqual([
      'NEW',
      'ASSIGNED',
      'ACCEPTED',
      'IN_PROGRESS',
      'COMPLETED',
      'VERIFIED',
      'CLOSED',
    ]);
    expect(unknownArray(detail, 'arrivals')).toHaveLength(1);
    expect(bodyRecord(detail.familySummary).status).toBe('PUBLISHED');
    const completion = bodyRecord(detail.completion);
    expect(completion.checklistConfirmedAt).toEqual(expect.any(String));
    expect(bodyRecord(completion.completionChecklist)).toMatchObject({
      schemaVersion: 1,
      required: true,
      expectedCodes: [...HIGH_RISK_COMPLETION_CHECKLIST_CODES],
    });

    const outboxTypes = await database.client.outboxEvent.findMany({
      where: { aggregateId: { in: [workOrderId, healthNeed.id] } },
      select: { eventType: true, correlationId: true, payload: true },
    });
    expect(outboxTypes.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'NEED.CREATED',
      'NEED.REVIEW_REQUIRED',
      'WORK_ORDER.CREATED',
      'WORK_ORDER.REVISED',
      'WORK_ORDER.ASSIGNED',
      'WORK_ORDER.ACCEPTED',
      'WORK_ORDER.ARRIVED',
      'WORK_ORDER.IN_PROGRESS',
      'WORK_ORDER.COMPLETED',
      'WORK_ORDER.VERIFIED',
      'WORK_ORDER.CLOSED',
    ]));
    expect(JSON.stringify(outboxTypes)).not.toContain('我想喝热水');
  });

  it('fails closed for invalid upload types and cross-facility admin enumeration', async () => {
    const elder = request.agent(server);
    const elderLogin = await login(elder, 'elder.demo');
    await elder
      .post('/elder/voice-submissions/upload-intents')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(elderLogin))
      .send({ purpose: 'ELDER_REQUEST', mimeType: 'application/javascript', sizeBytes: 20, idempotencyKey: `invalid-${Date.now()}` })
      .expect(400);

    const director = request.agent(server);
    await login(director, 'facility.director');
    await director
      .get(`/admin/organizations/${ORGANIZATION_ID}/facilities/20000000-0000-4000-8000-000000000002/work-orders`)
      .expect(404);
  });

  it('uses real MinIO staging, ETag-fenced sealing, and deletion fencing for uploaded audio', async () => {
    const elder = request.agent(server);
    const elderLogin = await login(elder, 'elder.demo');
    const elderCsrf = readCsrfToken(elderLogin);
    const wave = deterministicWaveBuffer();
    const checksumSha256 = createHash('sha256').update(wave).digest('hex');
    const intentResponse = await elder
      .post('/elder/voice-submissions/upload-intents')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({
        purpose: 'ELDER_REQUEST',
        mimeType: 'audio/wav',
        sizeBytes: wave.byteLength,
        checksumSha256,
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey: `real-staging-${Date.now()}-${nextFixtureSequence()}`,
      })
      .expect(200);
    const intent = voiceUploadIntentSchema.parse(intentResponse.body);
    await uploadPresignedPost(intent.upload, wave);

    const finalizedResponse = await elder
      .post(`/elder/voice-submissions/${intent.submissionId}/finalize`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ expectedVersion: intent.expectedVersion, checksumSha256 })
      .expect(200);
    const finalized = elderVoiceDemoResponseSchema.parse(finalizedResponse.body);
    expect(finalized.submission.status).toBe('COMPLETED');
    const persisted = await database.client.voiceSubmission.findUniqueOrThrow({
      where: { id: intent.submissionId },
      select: {
        objectKey: true,
        uploadObjectKey: true,
        uploadAuthorizedUntil: true,
        sealCandidateObjectKey: true,
        sealCandidateSourceETag: true,
        sealLeaseToken: true,
        sealLeaseUntil: true,
      },
    });
    expect(persisted.objectKey).toMatch(/^voice\/sealed\//);
    expect(persisted.uploadObjectKey).toMatch(/^voice\/staging\//);
    expect(persisted.uploadAuthorizedUntil).toBeInstanceOf(Date);
    expect(persisted.sealCandidateObjectKey).toBeNull();
    expect(persisted.sealCandidateSourceETag).toBeNull();
    expect(persisted.sealLeaseToken).toBeNull();
    expect(persisted.sealLeaseUntil).toBeNull();
    expect(await readStoredObject(storage, persisted.objectKey)).toEqual(wave);

    const overwrittenStaging = Buffer.from(wave);
    overwrittenStaging[overwrittenStaging.length - 1] = 0x7f;
    await uploadPresignedPost(intent.upload, overwrittenStaging);
    await elder
      .post(`/elder/voice-submissions/${intent.submissionId}/finalize`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ expectedVersion: intent.expectedVersion, checksumSha256 })
      .expect(200);
    expect(await readStoredObject(storage, persisted.objectKey)).toEqual(wave);
    if (persisted.uploadObjectKey === null) throw new Error('Staging key missing');
    expect(await readStoredObject(storage, persisted.uploadObjectKey)).toEqual(overwrittenStaging);
    await storage.delete(persisted.uploadObjectKey);

    const cancelIntentResponse = await elder
      .post('/elder/voice-submissions/upload-intents')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({
        purpose: 'ELDER_REQUEST',
        mimeType: 'audio/wav',
        sizeBytes: wave.byteLength,
        checksumSha256,
        idempotencyKey: `real-cancel-${Date.now()}-${nextFixtureSequence()}`,
      })
      .expect(200);
    const cancelIntent = voiceUploadIntentSchema.parse(cancelIntentResponse.body);
    await uploadPresignedPost(cancelIntent.upload, wave);
    await elder
      .post(`/elder/voice-submissions/${cancelIntent.submissionId}/cancel`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', elderCsrf)
      .send({ expectedVersion: cancelIntent.expectedVersion, reasonCode: 'SUBMITTER_CANCELLED' })
      .expect(200);
    const cancelled = await database.client.voiceSubmission.findUniqueOrThrow({
      where: { id: cancelIntent.submissionId },
      select: {
        status: true,
        uploadObjectKey: true,
        objectDeletionPendingAt: true,
        objectDeletedAt: true,
      },
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', objectDeletedAt: null });
    expect(cancelled.objectDeletionPendingAt).toBeInstanceOf(Date);
    if (cancelled.uploadObjectKey === null) throw new Error('Cancelled staging key missing');
    await expect(storage.inspect(cancelled.uploadObjectKey)).rejects.toBeDefined();

    // The old POST remains replayable until its TTL, so the durable fence must stay unmarked.
    await uploadPresignedPost(cancelIntent.upload, wave);
    await expect(storage.inspect(cancelled.uploadObjectKey)).resolves.toMatchObject({
      contentLength: wave.byteLength,
    });
    await storage.delete(cancelled.uploadObjectKey);
  });

  it('creates exactly one NEW work order for an idempotent manual need that needs no review', async () => {
    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const elder = await database.client.elder.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, recordNumber: 'QL-E001' },
      select: { id: true },
    });
    const idempotencyKey = `manual-no-review-${Date.now()}-${nextFixtureSequence()}`;
    const body = {
      elderId: elder.id,
      summary: '人工登记的常规生活协助需求。',
      category: 'DAILY_LIVING',
      priority: 'ROUTINE',
      requiresHumanReview: false,
      reasonCode: 'STAFF_CONFIRMED_MANUAL_NEED',
      idempotencyKey,
    } as const;
    const first = needSchema.parse((await director
      .post(adminPath('needs/manual'))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(directorLogin))
      .send(body)
      .expect(200)).body);
    const replay = needSchema.parse((await director
      .post(adminPath('needs/manual'))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(directorLogin))
      .send(body)
      .expect(200)).body);
    expect(replay.id).toBe(first.id);
    expect(first.status).toBe('CONFIRMED');
    const workOrders = await database.client.workOrder.findMany({
      where: { primaryNeedId: first.id },
      select: { id: true, status: true, version: true },
    });
    expect(workOrders).toHaveLength(1);
    const workOrder = workOrders[0];
    if (workOrder === undefined) throw new Error('Manual need work order missing');
    expect(workOrder).toMatchObject({ status: 'NEW', version: 1 });
    expect(await database.client.outboxEvent.count({
      where: { aggregateId: workOrder.id, eventType: 'WORK_ORDER.CREATED' },
    })).toBe(1);
  });

  it('filters caregiver list items through elder resource scope', async () => {
    const suffix = `${Date.now()}-${nextFixtureSequence()}`;
    const [caregiverStaff, directorUser, inaccessibleElder] = await Promise.all([
      database.client.staffProfile.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          user: { loginName: 'caregiver.demo' },
        },
        select: { id: true },
      }),
      database.client.user.findFirstOrThrow({ where: { loginName: 'facility.director' }, select: { id: true } }),
      database.client.elder.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          recordNumber: 'QL-E004',
        },
        select: { id: true, displayName: true },
      }),
    ]);
    const fixture = await createWorkOrderFixture(
      database,
      inaccessibleElder.id,
      directorUser.id,
      suffix,
      'ASSIGNED',
    );
    await database.client.workOrderAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        workOrderId: fixture.workOrderId,
        assigneeStaffProfileId: caregiverStaff.id,
        status: 'OFFERED',
        assignedByUserId: directorUser.id,
        reasonCode: 'TEST_DIRECT_OFFER_OUTSIDE_SCOPE',
      },
    });

    const caregiver = request.agent(server);
    await login(caregiver, 'caregiver.demo');
    const response = await caregiver.get('/caregiver/work-orders').expect(200);
    const body = bodyRecord(response);
    expect(unknownArray(body, 'items').map(bodyRecord).some((item) => item.id === fixture.workOrderId)).toBe(false);
    expect(JSON.stringify(body)).not.toContain(inaccessibleElder.displayName);
    expect(bodyRecord(body.pageInfo).total).toBe(unknownArray(body, 'items').length);
    await caregiver.get(`/caregiver/work-orders/${fixture.workOrderId}`).expect(404);
  });

  it('propagates a reviewer downgrade into admin and caregiver work-order projections', async () => {
    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const csrf = readCsrfToken(directorLogin);
    const [elder, directorUser, caregiverStaff] = await Promise.all([
      database.client.elder.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, recordNumber: 'QL-E001' },
        select: { id: true },
      }),
      database.client.user.findFirstOrThrow({ where: { loginName: 'facility.director' }, select: { id: true } }),
      database.client.staffProfile.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          user: { loginName: 'caregiver.demo' },
        },
        select: { id: true },
      }),
    ]);
    const fixture = await createWorkOrderFixture(
      database,
      elder.id,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-review-downgrade`,
    );
    const oldDueAt = new Date(Date.now() + 10 * 60 * 1000);
    await database.client.$transaction([
      database.client.need.update({
        where: { id: fixture.needId },
        data: {
          status: 'REVIEW_REQUIRED',
          requiresHumanReview: true,
          priority: 'IMMEDIATE_REVIEW',
          reviewedByUserId: null,
          reviewedAt: null,
          reviewReasonCode: null,
        },
      }),
      database.client.workOrder.update({
        where: { id: fixture.workOrderId },
        data: {
          priority: 'IMMEDIATE_REVIEW',
          dueAt: oldDueAt,
          version: { increment: 1 },
        },
      }),
    ]);
    const finalSummary = '人工复核：改为常规生活协助，无需立即处理。';
    await director
      .post(adminPath(`needs/${fixture.needId}/review`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        decision: 'CONFIRM',
        summary: finalSummary,
        category: 'DAILY_LIVING',
        priority: 'ROUTINE',
        reasonCode: 'HUMAN_REVIEW_DOWNGRADED',
      })
      .expect(200);
    const detail = bodyRecord(await director
      .get(adminPath(`work-orders/${fixture.workOrderId}`))
      .expect(200));
    expect(detail.summary).toBe(finalSummary);
    expect(detail.priority).toBe('ROUTINE');
    expect(new Date(String(detail.dueAt)).getTime()).toBeGreaterThan(oldDueAt.getTime());
    const revisedVersion = detail.version;
    if (typeof revisedVersion !== 'number') throw new Error('Downgraded work-order version missing');
    await director
      .post(adminPath(`work-orders/${fixture.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: revisedVersion,
        assigneeStaffProfileId: caregiverStaff.id,
        reasonCode: 'ASSIGN_AFTER_DOWNGRADE',
      })
      .expect(200);
    const caregiver = request.agent(server);
    await login(caregiver, 'caregiver.demo');
    const tasks = unknownArray(bodyRecord(await caregiver.get('/caregiver/work-orders').expect(200)), 'items')
      .map(bodyRecord);
    const projected = tasks.find((task) => task.id === fixture.workOrderId);
    expect(projected?.summary).toBe(finalSummary);
    expect(projected?.priority).toBe('ROUTINE');
  });

  it('binds explicit shift assignments to current staff and team references', async () => {
    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const csrf = readCsrfToken(directorLogin);
    const [elder, outOfScopeElder, directorUser, currentShift, expiredShift, otherStaff] = await Promise.all([
      database.client.elder.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, recordNumber: 'QL-E001' },
        select: { id: true },
      }),
      database.client.elder.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, recordNumber: 'QL-E004' },
        select: { id: true },
      }),
      database.client.user.findFirstOrThrow({ where: { loginName: 'facility.director' }, select: { id: true } }),
      database.client.shiftAssignment.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          staffProfile: { user: { loginName: 'caregiver.demo' } },
          shift: { code: 'SHIFT-CURRENT' },
        },
        select: { id: true, staffProfileId: true, shift: { select: { teamId: true } } },
      }),
      database.client.shiftAssignment.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          shift: { code: 'SHIFT-EXPIRED' },
        },
        select: { id: true, staffProfileId: true, shift: { select: { teamId: true } } },
      }),
      database.client.staffProfile.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          user: { loginName: 'caregiver.demo2' },
        },
        select: { id: true },
      }),
    ]);
    if (currentShift.shift.teamId === null || expiredShift.shift.teamId === null) {
      throw new Error('Assignment fixture team is missing');
    }
    const fixtures = await Promise.all(['team', 'mismatch', 'expired', 'valid'].map((label) =>
      createWorkOrderFixture(
        database,
        elder.id,
        directorUser.id,
        `${Date.now()}-${nextFixtureSequence()}-${label}`,
      )));
    const [teamOnly, mismatch, expired, valid] = fixtures;
    if (teamOnly === undefined || mismatch === undefined || expired === undefined || valid === undefined) {
      throw new Error('Work-order assignment fixtures are missing');
    }
    const [wrongScope, uncoveredTeam] = await Promise.all([
      createWorkOrderFixture(
        database,
        outOfScopeElder.id,
        directorUser.id,
        `${Date.now()}-${nextFixtureSequence()}-wrong-scope`,
      ),
      createWorkOrderFixture(
        database,
        outOfScopeElder.id,
        directorUser.id,
        `${Date.now()}-${nextFixtureSequence()}-uncovered-team`,
      ),
    ]);

    await director
      .post(adminPath(`work-orders/${teamOnly.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        shiftAssignmentId: currentShift.id,
        reasonCode: 'INVALID_TEAM_SHIFT_CAPTURE',
      })
      .expect(400);
    expect(await database.client.workOrder.findUniqueOrThrow({
      where: { id: teamOnly.workOrderId },
      select: { status: true, assignments: { select: { id: true } } },
    })).toEqual({ status: 'NEW', assignments: [] });

    await director
      .post(adminPath(`work-orders/${teamOnly.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        reasonCode: 'VALID_TEAM_OFFER',
      })
      .expect(200);
    expect(await database.client.workOrderAssignment.findFirstOrThrow({
      where: { workOrderId: teamOnly.workOrderId },
      select: { targetTeamId: true, assigneeStaffProfileId: true, shiftAssignmentId: true },
    })).toEqual({
      targetTeamId: currentShift.shift.teamId,
      assigneeStaffProfileId: null,
      shiftAssignmentId: null,
    });

    await director
      .post(adminPath(`work-orders/${mismatch.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        assigneeStaffProfileId: otherStaff.id,
        shiftAssignmentId: currentShift.id,
        reasonCode: 'MISMATCHED_SHIFT_STAFF',
      })
      .expect(404);

    await director
      .post(adminPath(`work-orders/${expired.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: expiredShift.shift.teamId,
        assigneeStaffProfileId: expiredShift.staffProfileId,
        shiftAssignmentId: expiredShift.id,
        reasonCode: 'EXPIRED_SHIFT',
      })
      .expect(404);

    await director
      .post(adminPath(`work-orders/${wrongScope.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        assigneeStaffProfileId: currentShift.staffProfileId,
        shiftAssignmentId: currentShift.id,
        reasonCode: 'WRONG_ELDER_SCOPE',
      })
      .expect(404);
    const wrongScopeStaffOnly = await director
      .post(adminPath(`work-orders/${wrongScope.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        assigneeStaffProfileId: currentShift.staffProfileId,
        reasonCode: 'STAFF_WITHOUT_ELDER_SCOPE',
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(wrongScopeStaffOnly).error).code)
      .toBe('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');

    const uncoveredTeamResponse = await director
      .post(adminPath(`work-orders/${uncoveredTeam.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        reasonCode: 'TEAM_WITHOUT_ELDER_COVERAGE',
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(uncoveredTeamResponse).error).code).toBe('TEAM_HAS_NO_ACTIVE_COVERING_CAREGIVER');

    await director
      .post(adminPath(`work-orders/${valid.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        assigneeStaffProfileId: currentShift.staffProfileId,
        shiftAssignmentId: currentShift.id,
        reasonCode: 'CURRENT_MATCHED_SHIFT',
      })
      .expect(200);
    expect(await database.client.workOrderAssignment.findFirstOrThrow({
      where: { workOrderId: valid.workOrderId },
      select: { targetTeamId: true, assigneeStaffProfileId: true, shiftAssignmentId: true },
    })).toEqual({
      targetTeamId: currentShift.shift.teamId,
      assigneeStaffProfileId: currentShift.staffProfileId,
      shiftAssignmentId: currentShift.id,
    });

    const routineDraft = await createWorkOrderFixture(
      database,
      elder.id,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-routine-draft`,
    );
    await database.client.need.update({
      where: { id: routineDraft.needId },
      data: {
        status: 'DRAFT',
        requiresHumanReview: false,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReasonCode: null,
      },
    });
    await director
      .post(adminPath(`work-orders/${routineDraft.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        assigneeStaffProfileId: currentShift.staffProfileId,
        reasonCode: 'SAFE_ROUTINE_DRAFT_ASSIGNMENT',
      })
      .expect(200);

    const activeStay = await database.client.elderStay.findFirstOrThrow({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        elderId: elder.id,
        status: 'ACTIVE',
      },
      select: { bed: { select: { room: { select: { floorId: true } } } } },
    });
    const overlappingShift = await database.client.shift.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        teamId: currentShift.shift.teamId,
        code: `OVERLAP-${Date.now()}-${nextFixtureSequence()}`.slice(0, 64),
        name: 'Overlapping coverage regression shift',
        startsAt: new Date(Date.now() - 30 * 60 * 1000),
        endsAt: new Date(Date.now() + 30 * 60 * 1000),
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });
    const overlappingAssignment = await database.client.shiftAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        shiftId: overlappingShift.id,
        staffProfileId: currentShift.staffProfileId,
        status: 'ACCEPTED',
      },
      select: { id: true },
    });
    const overlappingStaff = await database.client.staffProfile.findUniqueOrThrow({
      where: { id: currentShift.staffProfileId },
      select: { userId: true },
    });
    const overlappingCaregiverRole = await database.client.userRole.findFirstOrThrow({
      where: {
        organizationId: ORGANIZATION_ID,
        userId: overlappingStaff.userId,
        role: { code: 'CAREGIVER' },
        revokedAt: null,
      },
      select: { id: true },
    });
    await database.client.dataScope.create({
      data: {
        userRoleId: overlappingCaregiverRole.id,
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        kind: 'ACTIVE_SHIFT',
        scopeKey: `active-shift:${overlappingAssignment.id}`,
        validFrom: new Date(Date.now() - 60_000),
        validUntil: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await database.client.shiftAssignmentScope.create({
      data: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        shiftAssignmentId: overlappingAssignment.id,
        kind: 'FLOOR',
        floorId: activeStay.bed.room.floorId,
      },
    });
    const overlapFixture = await createWorkOrderFixture(
      database,
      elder.id,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-overlap-explicit`,
    );
    const overlapAssigned = await director
      .post(adminPath(`work-orders/${overlapFixture.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        targetTeamId: currentShift.shift.teamId,
        assigneeStaffProfileId: currentShift.staffProfileId,
        shiftAssignmentId: overlappingAssignment.id,
        reasonCode: 'EXPLICIT_OVERLAPPING_COVERING_SHIFT',
      })
      .expect(200);
    const overlapAssignedVersion = bodyRecord(overlapAssigned).version;
    if (typeof overlapAssignedVersion !== 'number') throw new Error('Assigned overlap version missing');
    const caregiver = request.agent(server);
    const caregiverLogin = await login(caregiver, 'caregiver.demo');
    await caregiver
      .post(`/caregiver/work-orders/${overlapFixture.workOrderId}/accept`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(caregiverLogin))
      .send({
        expectedVersion: overlapAssignedVersion,
        targetStatus: 'ACCEPTED',
        reasonCode: 'CAREGIVER_ACCEPTED_EXPLICIT_SHIFT',
      })
      .expect(200);
    expect(await database.client.workOrderAssignment.findFirstOrThrow({
      where: { workOrderId: overlapFixture.workOrderId, status: 'CLAIMED' },
      select: { shiftAssignmentId: true },
    })).toEqual({ shiftAssignmentId: overlappingAssignment.id });
    await caregiver.get(`/caregiver/work-orders/${overlapFixture.workOrderId}`).expect(200);
    const ambiguousFixture = await createWorkOrderFixture(
      database,
      elder.id,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-ambiguous-staff-only`,
    );
    const ambiguous = await director
      .post(adminPath(`work-orders/${ambiguousFixture.workOrderId}/assign`))
      .set('Origin', ORIGIN)
      .set('x-csrf-token', csrf)
      .send({
        expectedVersion: 1,
        assigneeStaffProfileId: currentShift.staffProfileId,
        reasonCode: 'AMBIGUOUS_OVERLAPPING_SHIFTS',
      })
      .expect(409);
    expect(bodyRecord(bodyRecord(ambiguous).error).code)
      .toBe('ASSIGNMENT_SHIFT_SELECTION_REQUIRED');

    // Keep this regression fixture from becoming a second live caregiver
    // shift for later integration files that share the seeded database.
    const cleanupAt = new Date();
    await database.client.$transaction([
      database.client.dataScope.updateMany({
        where: {
          userRoleId: overlappingCaregiverRole.id,
          scopeKey: `active-shift:${overlappingAssignment.id}`,
        },
        data: { validUntil: cleanupAt },
      }),
      database.client.shiftAssignment.update({
        where: { id: overlappingAssignment.id },
        data: { status: 'CANCELLED' },
      }),
      database.client.shift.update({
        where: { id: overlappingShift.id },
        data: { status: 'COMPLETED', endsAt: cleanupAt },
      }),
    ]);
  });

  it('does not let assign race past a rejecting human review', async () => {
    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const csrf = readCsrfToken(directorLogin);
    const [elder, directorUser, caregiverStaff] = await Promise.all([
      database.client.elder.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, facilityId: FACILITY_ID, recordNumber: 'QL-E001' },
        select: { id: true },
      }),
      database.client.user.findFirstOrThrow({ where: { loginName: 'facility.director' }, select: { id: true } }),
      database.client.staffProfile.findFirstOrThrow({
        where: {
          organizationId: ORGANIZATION_ID,
          facilityId: FACILITY_ID,
          user: { loginName: 'caregiver.demo' },
        },
        select: { id: true },
      }),
    ]);
    const fixture = await createWorkOrderFixture(
      database,
      elder.id,
      directorUser.id,
      `${Date.now()}-${nextFixtureSequence()}-review-race`,
    );
    await database.client.need.update({
      where: { id: fixture.needId },
      data: {
        status: 'REVIEW_REQUIRED',
        requiresHumanReview: true,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReasonCode: null,
      },
    });

    const [assignResponse, rejectResponse] = await Promise.all([
      director
        .post(adminPath(`work-orders/${fixture.workOrderId}/assign`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrf)
        .send({
          expectedVersion: 1,
          assigneeStaffProfileId: caregiverStaff.id,
          reasonCode: 'RACING_ASSIGNMENT',
        }),
      director
        .post(adminPath(`needs/${fixture.needId}/review`))
        .set('Origin', ORIGIN)
        .set('x-csrf-token', csrf)
        .send({
          expectedVersion: 1,
          decision: 'REJECT',
          reasonCode: 'HUMAN_REVIEW_REJECTED',
        }),
    ]);
    expect([assignResponse.status, rejectResponse.status].sort()).toEqual([200, 409]);
    expect(rejectResponse.status).toBe(200);
    expect(await database.client.workOrder.findUniqueOrThrow({
      where: { id: fixture.workOrderId },
      select: { status: true, assignments: { select: { id: true } } },
    })).toEqual({ status: 'CANCELLED', assignments: [] });
  });

  it('denies transcript and audio reads immediately after voice consent is withdrawn', async () => {
    const elder = request.agent(server);
    const elderLogin = await login(elder, 'elder.demo');
    const demoResponse = await elder
      .post('/elder/voice-submissions/demo')
      .set('Origin', ORIGIN)
      .set('x-csrf-token', readCsrfToken(elderLogin))
      .send({
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey: `m03-consent-withdrawal-${Date.now()}`,
      })
      .expect(200);
    const demo = elderVoiceDemoResponseSchema.parse(demoResponse.body);
    const director = request.agent(server);
    const directorLogin = await login(director, 'facility.director');
    const directorCsrf = readCsrfToken(directorLogin);
    const restrictedPath = adminPath(`voice-submissions/${demo.submission.id}`);
    const workOrderId = demo.workOrder?.id;
    if (workOrderId === undefined) throw new Error('Consent fixture work order is missing');

    await director.get(`${restrictedPath}/transcript`).expect(200);
    await director
      .post(`${restrictedPath}/audio-read-url`)
      .set('Origin', ORIGIN)
      .set('x-csrf-token', directorCsrf)
      .expect(200);
    expect(bodyRecord(await elder
      .get(`/elder/voice-submissions/${demo.submission.id}`)
      .expect(200)).analysis).toBeDefined();
    expect(bodyRecord(await director
      .get(adminPath(`work-orders/${workOrderId}`))
      .expect(200)).analysis).not.toBeNull();

    const activeConsents = await database.client.consentRecord.findMany({
      where: {
        organizationId: ORGANIZATION_ID,
        facilityId: FACILITY_ID,
        elderId: demo.submission.elderId,
        purpose: { in: ['VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS'] },
        supersededAt: null,
      },
      orderBy: { consentVersion: 'desc' },
    });
    const currentByPurpose = new Map(activeConsents.map((consent) => [consent.purpose, consent]));
    const currentVoice = currentByPurpose.get('VOICE_CAPTURE');
    const currentAnalysis = currentByPurpose.get('TRANSCRIPTION_AI_ANALYSIS');
    if (currentVoice === undefined || currentAnalysis === undefined) {
      throw new Error('Voice consent fixtures are missing');
    }
    const withdrawnAt = new Date();
    const withdrawalIds: string[] = [];
    try {
      await database.client.$transaction(async (transaction) => {
        await transaction.consentRecord.updateMany({
          where: { id: { in: [currentVoice.id, currentAnalysis.id] }, supersededAt: null },
          data: { supersededAt: withdrawnAt },
        });
        for (const current of [currentVoice, currentAnalysis]) {
          const withdrawal = await transaction.consentRecord.create({
            data: {
              organizationId: ORGANIZATION_ID,
              facilityId: FACILITY_ID,
              elderId: demo.submission.elderId,
              purpose: current.purpose,
              decision: 'WITHDRAWN',
              authority: 'ELDER',
              consentVersion: current.consentVersion + 1,
              effectiveAt: withdrawnAt,
              reasonCode: 'INTEGRATION_TEST_WITHDRAWAL',
              recordedByUserId: current.recordedByUserId,
            },
          });
          withdrawalIds.push(withdrawal.id);
        }
      });

      await director.get(`${restrictedPath}/transcript`).expect(409);
      await director
        .post(`${restrictedPath}/audio-read-url`)
        .set('Origin', ORIGIN)
        .set('x-csrf-token', directorCsrf)
        .expect(409);
      expect(bodyRecord(await elder
        .get(`/elder/voice-submissions/${demo.submission.id}`)
        .expect(200))).not.toHaveProperty('analysis');
      expect(bodyRecord(await director
        .get(adminPath(`work-orders/${workOrderId}`))
        .expect(200)).analysis).toBeNull();
    } finally {
      await database.client.$transaction(async (transaction) => {
        await transaction.consentRecord.deleteMany({ where: { id: { in: withdrawalIds } } });
        await transaction.consentRecord.updateMany({
          where: { id: { in: [currentVoice.id, currentAnalysis.id] } },
          data: { supersededAt: null },
        });
      });
    }
  });
});

let fixtureSequence = 0;

function nextFixtureSequence(): number {
  fixtureSequence += 1;
  return fixtureSequence;
}

async function createWorkOrderFixture(
  database: DatabaseService,
  elderId: string,
  createdByUserId: string,
  suffix: string,
  status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' = 'NEW',
): Promise<{ needId: string; workOrderId: string }> {
  const correlationId = `m03-integration-fixture-${suffix}`.slice(0, 128);
  const need = await database.client.need.create({
    data: {
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
      elderId,
      source: 'MANUAL',
      summary: `Scoped integration fixture ${suffix}`,
      category: 'DAILY_LIVING',
      urgencySuggestion: 'ROUTINE',
      priority: 'ROUTINE',
      safetyRuleCodes: [],
      status: 'CONFIRMED',
      reviewedByUserId: createdByUserId,
      reviewedAt: new Date(),
      reviewReasonCode: 'INTEGRATION_FIXTURE_CONFIRMED',
      idempotencyKey: `m03-fixture-need-${suffix}`.slice(0, 128),
      correlationId,
    },
    select: { id: true },
  });
  const workOrder = await database.client.workOrder.create({
    data: {
      organizationId: ORGANIZATION_ID,
      facilityId: FACILITY_ID,
      elderId,
      primaryNeedId: need.id,
      code: `T-${suffix}`.slice(0, 64),
      title: `Integration fixture ${suffix}`.slice(0, 160),
      summary: `Scoped integration work order ${suffix}`,
      priority: 'ROUTINE',
      status,
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
      createdByUserId,
      idempotencyKey: `m03-fixture-work-order-${suffix}`.slice(0, 128),
      correlationId,
      ...(status === 'IN_PROGRESS'
        ? {
            acceptedAt: new Date(Date.now() - 3 * 60 * 1000),
            arrivedAt: new Date(Date.now() - 2 * 60 * 1000),
            startedAt: new Date(Date.now() - 60 * 1000),
          }
        : {}),
      version: status === 'ASSIGNED' ? 2 : status === 'IN_PROGRESS' ? 5 : 1,
    },
    select: { id: true },
  });
  return { needId: need.id, workOrderId: workOrder.id };
}

async function login(agent: TestAgent, loginName: string): Promise<Response> {
  return agent
    .post('/auth/login')
    .set('Origin', ORIGIN)
    .send({ loginName, password: DEMO_PASSWORD })
    .expect(200);
}

async function uploadPresignedPost(
  upload: {
    readonly method: 'POST';
    readonly url: string;
    readonly fields: Readonly<Record<string, string>>;
  },
  body: Buffer,
): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append('file', new Blob([Uint8Array.from(body)], { type: 'audio/wav' }), 'voice.wav');
  const response = await fetch(upload.url, { method: upload.method, body: form });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(`Presigned upload failed with ${response.status}: ${await response.text()}`);
  }
}

async function readStoredObject(storage: ObjectStorageService, objectKey: string): Promise<Buffer> {
  const signed = await storage.createReadUrl(objectKey);
  const response = await fetch(signed.url);
  if (!response.ok) throw new Error(`Object read failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function deterministicWaveBuffer(): Buffer {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
}

function readCsrfToken(response: Response): string {
  const cookies = response.headers['set-cookie'];
  const values = Array.isArray(cookies)
    ? cookies.filter((value): value is string => typeof value === 'string')
    : typeof cookies === 'string'
      ? [cookies]
      : [];
  const token = values
    .find((value) => value.startsWith('eldercare_csrf='))
    ?.split(';', 1)[0]
    ?.split('=', 2)[1];
  if (token === undefined) throw new Error('CSRF cookie was not set');
  return token;
}

function adminPath(suffix: string): string {
  return `/admin/organizations/${ORGANIZATION_ID}/facilities/${FACILITY_ID}/${suffix}`;
}

function stripMobileProjection(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return omitKeys(value as Record<string, unknown>, [
    'elderDisplayName',
    'locationLabel',
    'operationalAttention',
    'completionChecklistRequired',
    'requiredCompletionChecklistCodes',
  ]);
}

function bodyRecord(value: unknown): Record<string, unknown> {
  const candidate: unknown = isResponse(value) ? value.body as unknown : value;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('Expected an object response body');
  }
  return candidate as Record<string, unknown>;
}

function unknownArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Expected ${key} to be an array`);
  return value;
}

function omitKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

function isResponse(value: unknown): value is Response {
  return typeof value === 'object' && value !== null && 'body' in value && 'status' in value;
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
