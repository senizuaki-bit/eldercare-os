import { describe, expect, it } from 'vitest';

import {
  HIGH_RISK_COMPLETION_CHECKLIST_CODES,
  caregiverCompletionVoiceResultSchema,
  elderHumanHelpRequestSchema,
  elderVoiceDemoRequestSchema,
  familySummarySchema,
  needAnalysisOutputSchema,
  needLinkSchema,
  needReviewRequestSchema,
  ratingCreateRequestSchema,
  serviceCompletionSchema,
  transcriptPrivateSchema,
  voiceSubmissionSchema,
  elderVoiceUploadIntentRequestSchema,
  voiceUploadIntentRequestSchema,
  workOrderAcceptRequestSchema,
  workOrderAssignmentSchema,
  workOrderAssignRequestSchema,
  workOrderArrivalSchema,
  workOrderCompletionRequestSchema,
  workOrderCompletionVoiceUploadIntentRequestSchema,
  workOrderStartRequestSchema,
  workOrderTransitionSchema,
  workOrderVerifyRequestSchema,
  workOrdersQuerySchema,
} from './needs-workorders.js';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  facility: '20000000-0000-4000-8000-000000000001',
  elder: '30000000-0000-4000-8000-000000000001',
  workOrder: '40000000-0000-4000-8000-000000000001',
  submission: '50000000-0000-4000-8000-000000000001',
  user: '60000000-0000-4000-8000-000000000001',
  staff: '70000000-0000-4000-8000-000000000001',
  team: '80000000-0000-4000-8000-000000000001',
  shiftAssignment: '90000000-0000-4000-8000-000000000001',
  sourceNeed: 'a0000000-0000-4000-8000-000000000001',
  targetNeed: 'b0000000-0000-4000-8000-000000000001',
} as const;
const timestamp = '2026-07-21T08:00:00.000Z';

describe('M03 voice and analysis contracts', () => {
  it('accepts only allowlisted audio metadata and refuses client tenancy', () => {
    expect(
      voiceUploadIntentRequestSchema.parse({
        mimeType: 'audio/webm',
        sizeBytes: 1_024,
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey: 'voice-request-0001',
      }),
    ).toMatchObject({ purpose: 'ELDER_REQUEST', mimeType: 'audio/webm' });
    expect(
      voiceUploadIntentRequestSchema.safeParse({
        organizationId: ids.organization,
        mimeType: 'audio/webm',
        sizeBytes: 1_024,
        idempotencyKey: 'voice-request-0001',
      }).success,
    ).toBe(false);
    expect(
      elderVoiceUploadIntentRequestSchema.safeParse({
        purpose: 'WORK_ORDER_COMPLETION',
        mimeType: 'audio/webm',
        sizeBytes: 1_024,
        idempotencyKey: 'voice-request-0002',
      }).success,
    ).toBe(false);
    expect(
      voiceUploadIntentRequestSchema.safeParse({
        mimeType: 'application/octet-stream',
        sizeBytes: 1_024,
        idempotencyKey: 'voice-request-0001',
      }).success,
    ).toBe(false);
    expect(
      voiceUploadIntentRequestSchema.safeParse({
        mimeType: 'audio/webm',
        sizeBytes: 10 * 1024 * 1024 + 1,
        idempotencyKey: 'voice-request-0001',
      }).success,
    ).toBe(false);
  });

  it('binds completion audio to a work order and failed records to a safe error code', () => {
    const submission = {
      id: ids.submission,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      workOrderId: null,
      submittedByUserId: ids.user,
      purpose: 'ELDER_REQUEST',
      status: 'UPLOAD_PENDING',
      mimeType: 'audio/webm',
      sizeBytes: 1_024,
      checksumSha256: null,
      fixtureKey: 'HOT_WATER_DIZZINESS_V1',
      failureCode: null,
      uploadedAt: null,
      completedAt: null,
      retentionUntil: '2026-07-28T08:00:00.000Z',
      correlationId: 'corr-m03-voice-0001',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    expect(voiceSubmissionSchema.safeParse(submission).success).toBe(true);
    expect(
      voiceSubmissionSchema.safeParse({
        ...submission,
        purpose: 'WORK_ORDER_COMPLETION',
      }).success,
    ).toBe(false);
    expect(
      voiceSubmissionSchema.safeParse({
        ...submission,
        status: 'FAILED',
      }).success,
    ).toBe(false);
  });

  it('keeps raw transcript in an explicitly private contract', () => {
    const transcript = {
      id: ids.submission,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      voiceSubmissionId: ids.submission,
      status: 'COMPLETED',
      text: '我想喝热水，今天有点头晕。',
      confidence: 0.99,
      durationMs: 2_900,
      provider: 'deterministic_fake',
      model: 'fixture_transcriber',
      providerVersion: 'v1',
      failureCode: null,
      retentionUntil: '2026-07-28T08:00:00.000Z',
      correlationId: 'corr-m03-voice-0001',
      version: 1,
      createdAt: timestamp,
      completedAt: timestamp,
    } as const;
    expect(transcriptPrivateSchema.safeParse(transcript).success).toBe(true);
    expect(transcriptPrivateSchema.safeParse({ ...transcript, text: null }).success).toBe(false);
  });

  it('keeps caregiver completion upload tenancy server-derived and marks the result as a reviewable AI draft', () => {
    expect(
      workOrderCompletionVoiceUploadIntentRequestSchema.parse({
        mimeType: 'audio/webm',
        sizeBytes: 1_024,
        fixtureKey: 'CARE_COMPLETION_V1',
        idempotencyKey: 'completion-voice-0001',
      }),
    ).not.toHaveProperty('purpose');
    expect(
      workOrderCompletionVoiceUploadIntentRequestSchema.safeParse({
        purpose: 'ELDER_REQUEST',
        mimeType: 'audio/webm',
        sizeBytes: 1_024,
        idempotencyKey: 'completion-voice-0001',
      }).success,
    ).toBe(false);

    const submission = {
      id: ids.submission,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      workOrderId: ids.workOrder,
      submittedByUserId: ids.user,
      purpose: 'WORK_ORDER_COMPLETION',
      status: 'COMPLETED',
      mimeType: 'audio/webm',
      sizeBytes: 1_024,
      checksumSha256: null,
      fixtureKey: 'CARE_COMPLETION_V1',
      failureCode: null,
      uploadedAt: timestamp,
      completedAt: timestamp,
      retentionUntil: '2026-07-28T08:00:00.000Z',
      correlationId: 'corr-m03-completion-0001',
      version: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    const transcript = {
      id: '51000000-0000-4000-8000-000000000001',
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      voiceSubmissionId: ids.submission,
      status: 'COMPLETED',
      confidence: 0.99,
      durationMs: 2_800,
      provider: 'deterministic-fake',
      model: 'fixture-transcriber-v1',
      providerVersion: 'v1',
      failureCode: null,
      retentionUntil: '2026-07-28T08:00:00.000Z',
      correlationId: 'corr-m03-completion-0001',
      version: 1,
      createdAt: timestamp,
      completedAt: timestamp,
    } as const;
    expect(caregiverCompletionVoiceResultSchema.safeParse({
      submission,
      transcript,
      completionDraft: {
        workOrderId: ids.workOrder,
        voiceSubmissionId: ids.submission,
        noteText: '已提供温水，建议本班继续观察。',
        aiDisclosure: 'AI_DRAFT_REQUIRES_CAREGIVER_REVIEW',
        requiresCaregiverReview: true,
      },
    }).success).toBe(true);
    expect(caregiverCompletionVoiceResultSchema.safeParse({
      submission,
      transcript,
      completionDraft: null,
    }).success).toBe(false);
  });

  it('requires sub-intent categories to be declared by the analysis', () => {
    const output = {
      summary: '老人希望喝热水，并表示今天有点头晕',
      categories: ['DAILY_LIVING', 'HEALTH_CONCERN'],
      urgencySuggestion: 'PRIORITY',
      reportedConcerns: ['头晕'],
      safetyFlags: ['DIZZINESS_REQUIRES_REVIEW'],
      emotionObservation: null,
      followUpQuestions: ['现在能否正常站立和行走？'],
      requiresHumanReview: true,
      subIntents: [
        { category: 'DAILY_LIVING', summary: '提供热水', urgencySuggestion: 'ROUTINE' },
        { category: 'HEALTH_CONCERN', summary: '确认头晕情况', urgencySuggestion: 'PRIORITY' },
      ],
    } as const;
    expect(needAnalysisOutputSchema.safeParse(output).success).toBe(true);
    expect(
      needAnalysisOutputSchema.safeParse({
        ...output,
        categories: ['DAILY_LIVING'],
      }).success,
    ).toBe(false);
  });
});

describe('M03 need and work-order contracts', () => {
  it('requires a complete deterministic correction when confirming a need', () => {
    expect(
      needReviewRequestSchema.safeParse({
        expectedVersion: 1,
        decision: 'CONFIRM',
        reasonCode: 'HUMAN_REVIEW',
      }).success,
    ).toBe(false);
    expect(
      needReviewRequestSchema.safeParse({
        expectedVersion: 1,
        decision: 'CONFIRM',
        summary: '提供热水并人工确认头晕情况',
        category: 'HEALTH_CONCERN',
        priority: 'PRIORITY',
        reasonCode: 'HUMAN_REVIEW',
      }).success,
    ).toBe(true);
    expect(
      needReviewRequestSchema.safeParse({
        expectedVersion: 1,
        decision: 'REJECT',
        reasonCode: 'HUMAN_REVIEW_REJECTED',
      }).success,
    ).toBe(true);
  });

  it('rejects self-links and assignment records without a target', () => {
    expect(
      needLinkSchema.safeParse({
        id: ids.sourceNeed,
        organizationId: ids.organization,
        facilityId: ids.facility,
        sourceNeedId: ids.sourceNeed,
        targetNeedId: ids.sourceNeed,
        kind: 'SPLIT_SIBLING',
        correlationId: 'corr-m03-needs-0001',
        createdAt: timestamp,
      }).success,
    ).toBe(false);
    const assignment = {
      id: ids.shiftAssignment,
      organizationId: ids.organization,
      facilityId: ids.facility,
      workOrderId: ids.workOrder,
      targetTeamId: null,
      assigneeStaffProfileId: null,
      shiftAssignmentId: null,
      status: 'OFFERED',
      assignedByUserId: ids.user,
      assignedAt: timestamp,
      claimedAt: null,
      releasedAt: null,
      reasonCode: 'SHIFT_POOL',
      version: 1,
    } as const;
    expect(workOrderAssignmentSchema.safeParse(assignment).success).toBe(false);
    expect(
      workOrderAssignmentSchema.safeParse({ ...assignment, targetTeamId: ids.team }).success,
    ).toBe(true);
    expect(
      workOrderAssignmentSchema.safeParse({
        ...assignment,
        targetTeamId: ids.team,
        status: 'CLAIMED',
      }).success,
    ).toBe(false);
  });

  it('requires immutable transition versions to advance exactly once', () => {
    const transition = {
      id: ids.workOrder,
      organizationId: ids.organization,
      facilityId: ids.facility,
      workOrderId: ids.workOrder,
      fromStatus: 'ASSIGNED',
      toStatus: 'ACCEPTED',
      fromVersion: 2,
      toVersion: 3,
      actorUserId: ids.user,
      reasonCode: 'CAREGIVER_ACCEPTED',
      correlationId: 'corr-m03-work-order-0001',
      occurredAt: timestamp,
    } as const;
    expect(workOrderTransitionSchema.safeParse(transition).success).toBe(true);
    expect(workOrderTransitionSchema.safeParse({ ...transition, toVersion: 4 }).success).toBe(false);
  });

  it('binds an explicit shift to both its staff assignee and team', () => {
    const request = {
      expectedVersion: 1,
      targetTeamId: ids.team,
      assigneeStaffProfileId: ids.staff,
      shiftAssignmentId: ids.shiftAssignment,
      reasonCode: 'SUPERVISOR_ASSIGNED',
    } as const;
    expect(workOrderAssignRequestSchema.safeParse(request).success).toBe(true);
    expect(
      workOrderAssignRequestSchema.safeParse({ ...request, assigneeStaffProfileId: undefined }).success,
    ).toBe(false);
    expect(
      workOrderAssignRequestSchema.safeParse({ ...request, targetTeamId: undefined }).success,
    ).toBe(false);
    expect(
      workOrderAssignRequestSchema.safeParse({
        expectedVersion: 1,
        targetTeamId: ids.team,
        reasonCode: 'TEAM_OFFER',
      }).success,
    ).toBe(true);
    expect(
      workOrderAssignRequestSchema.safeParse({
        expectedVersion: 1,
        assigneeStaffProfileId: ids.staff,
        reasonCode: 'STAFF_AUTO_SHIFT',
      }).success,
    ).toBe(true);
    expect(
      workOrderAssignRequestSchema.safeParse({
        expectedVersion: 1,
        targetTeamId: ids.team,
        assigneeStaffProfileId: ids.staff,
        reasonCode: 'AMBIGUOUS_PARTIAL_ASSIGNMENT',
      }).success,
    ).toBe(false);
  });

  it('narrows each transition endpoint to its one allowed target status', () => {
    const request = { expectedVersion: 2, reasonCode: 'CAREGIVER_ACTION' } as const;
    expect(workOrderAcceptRequestSchema.safeParse({ ...request, targetStatus: 'ACCEPTED' }).success).toBe(true);
    expect(workOrderAcceptRequestSchema.safeParse({ ...request, targetStatus: 'IN_PROGRESS' }).success).toBe(false);
    expect(workOrderStartRequestSchema.safeParse({ ...request, targetStatus: 'IN_PROGRESS' }).success).toBe(true);
    expect(workOrderVerifyRequestSchema.safeParse({ ...request, targetStatus: 'CLOSED' }).success).toBe(false);
  });

  it('records arrival as a versioned audit fact without inventing an ARRIVED status', () => {
    expect(
      workOrderArrivalSchema.safeParse({
        id: ids.workOrder,
        organizationId: ids.organization,
        facilityId: ids.facility,
        workOrderId: ids.workOrder,
        actorUserId: ids.user,
        fromVersion: 2,
        toVersion: 3,
        reasonCode: 'CAREGIVER_ARRIVED',
        arrivedAt: timestamp,
        correlationId: 'correlation-arrival-0001',
      }).success,
    ).toBe(true);
    expect(
      workOrderArrivalSchema.safeParse({
        id: ids.workOrder,
        organizationId: ids.organization,
        facilityId: ids.facility,
        workOrderId: ids.workOrder,
        actorUserId: ids.user,
        fromVersion: 2,
        toVersion: 4,
        reasonCode: 'CAREGIVER_ARRIVED',
        arrivedAt: timestamp,
        correlationId: 'correlation-arrival-0001',
      }).success,
    ).toBe(false);
  });

  it('requires completion note material that matches its source', () => {
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'TEXT',
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-0001',
      }).success,
    ).toBe(false);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'TEXT',
        noteText: 'Service completed safely.',
        voiceSubmissionId: ids.submission,
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-0001',
      }).success,
    ).toBe(false);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'VOICE',
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-0001',
      }).success,
    ).toBe(false);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'VOICE',
        voiceSubmissionId: ids.submission,
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-0001',
      }).success,
    ).toBe(true);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'TEXT',
        noteText: 'Service completed safely.',
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-checklist-0001',
        completionChecklist: HIGH_RISK_COMPLETION_CHECKLIST_CODES.map((code) => ({
          code,
          confirmed: true,
        })),
      }).success,
    ).toBe(true);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'TEXT',
        noteText: 'Service completed safely.',
        reasonCode: 'SERVICE_COMPLETED',
        idempotencyKey: 'completion-request-checklist-duplicate',
        completionChecklist: [
          { code: HIGH_RISK_COMPLETION_CHECKLIST_CODES[0], confirmed: true },
          { code: HIGH_RISK_COMPLETION_CHECKLIST_CODES[0], confirmed: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      workOrderCompletionRequestSchema.safeParse({
        expectedVersion: 4,
        noteSource: 'VOICE',
        voiceSubmissionId: ids.submission,
        reasonCode: 'SERVICE_COMPLETED',
      }).success,
    ).toBe(false);

    const completion = {
      id: ids.submission,
      organizationId: ids.organization,
      facilityId: ids.facility,
      elderId: ids.elder,
      workOrderId: ids.workOrder,
      submittedByStaffProfileId: ids.staff,
      noteSource: 'VOICE',
      noteText: null,
      voiceSubmissionId: ids.submission,
      confirmedAt: timestamp,
      completionChecklist: {
        schemaVersion: 1,
        required: false,
        riskReasons: [],
        expectedCodes: [],
        confirmations: [],
      },
      checklistConfirmedAt: null,
      correlationId: 'corr-m03-work-order-0001',
      version: 1,
      createdAt: timestamp,
    } as const;
    expect(serviceCompletionSchema.safeParse(completion).success).toBe(true);
  });

  it('uses allowlisted filters and parses false without widening a query', () => {
    expect(workOrdersQuerySchema.parse({ overdue: 'false' })).toMatchObject({
      page: 1,
      pageSize: 20,
      overdue: false,
      sort: 'createdAt',
      direction: 'desc',
    });
    expect(workOrdersQuerySchema.safeParse({ organizationId: ids.organization }).success).toBe(false);
  });
});

describe('M03 family and elder-safe result contracts', () => {
  it('keeps identity out of deterministic demo and human-handoff requests', () => {
    expect(elderVoiceDemoRequestSchema.parse({ idempotencyKey: 'voice-demo-0001' })).toEqual({
      fixtureKey: 'HOT_WATER_DIZZINESS_V1',
      idempotencyKey: 'voice-demo-0001',
    });
    expect(
      elderHumanHelpRequestSchema.safeParse({
        elderId: ids.elder,
        reasonCode: 'REQUEST_HUMAN',
        idempotencyKey: 'human-help-0001',
      }).success,
    ).toBe(false);
  });

  it('fails closed on internal completion notes and raw transcripts', () => {
    const summary = {
      id: ids.workOrder,
      elderId: ids.elder,
      workOrderId: ids.workOrder,
      status: 'PUBLISHED',
      title: '送水与关怀确认已完成',
      summary: '工作人员已完成服务并进行了人工确认。',
      serviceCompletedAt: timestamp,
      publishedAt: timestamp,
      version: 1,
    } as const;
    expect(familySummarySchema.safeParse(summary).success).toBe(true);
    expect(
      familySummarySchema.safeParse({
        ...summary,
        internalNote: '原始内部处置内容',
      }).success,
    ).toBe(false);
    expect(
      familySummarySchema.safeParse({
        ...summary,
        rawTranscript: '完整转写',
      }).success,
    ).toBe(false);
  });

  it('bounds ratings and exposes no disciplinary action field', () => {
    expect(
      ratingCreateRequestSchema.parse({
        expectedWorkOrderVersion: 6,
        score: 5,
        idempotencyKey: 'rating-request-0001',
      }),
    ).toMatchObject({ score: 5, requiresFollowUp: false });
    expect(
      ratingCreateRequestSchema.safeParse({
        expectedWorkOrderVersion: 6,
        score: 0,
        idempotencyKey: 'rating-request-0001',
      }).success,
    ).toBe(false);
    expect(
      ratingCreateRequestSchema.safeParse({
        expectedWorkOrderVersion: 6,
        score: 1,
        idempotencyKey: 'rating-request-0001',
        disciplinaryAction: 'DEDUCT_PAY',
      }).success,
    ).toBe(false);
  });
});
