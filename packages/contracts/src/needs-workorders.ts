import { z } from 'zod';

import {
  displayTextSchema,
  idempotencyKeySchema,
  identifierSchema,
  isoTimestampSchema,
  pageInfoSchema,
  recordCodeSchema,
  sortDirectionSchema,
  uuidSchema,
  versionSchema,
} from './common.js';

export const voiceSubmissionPurposeSchema = z.enum([
  'ELDER_REQUEST',
  'WORK_ORDER_COMPLETION',
]);
export const voiceSubmissionStatusSchema = z.enum([
  'UPLOAD_PENDING',
  'UPLOADED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const transcriptStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export const aiAnalysisStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export const needSourceSchema = z.enum(['VOICE', 'MANUAL']);
export const needCategorySchema = z.enum([
  'DAILY_LIVING',
  'HEALTH_CONCERN',
  'EMERGENCY_CONCERN',
  'EMOTIONAL_SUPPORT',
  'FACILITY_SUPPORT',
  'OTHER',
]);
export const needUrgencySchema = z.enum(['ROUTINE', 'PRIORITY', 'IMMEDIATE_REVIEW']);
export const needStatusSchema = z.enum([
  'DRAFT',
  'REVIEW_REQUIRED',
  'CONFIRMED',
  'REJECTED',
  'FULFILLED',
  'CANCELLED',
]);
export const needLinkKindSchema = z.enum(['SPLIT_SIBLING', 'RELATED', 'DUPLICATE']);
export const workOrderStatusSchema = z.enum([
  'NEW',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED',
]);
export const workOrderAssignmentStatusSchema = z.enum([
  'OFFERED',
  'CLAIMED',
  'RELEASED',
  'CANCELLED',
]);
export const completionNoteSourceSchema = z.enum(['TEXT', 'VOICE']);
export const HIGH_RISK_COMPLETION_CHECKLIST_CODES = [
  'RECIPIENT_STATE_CONFIRMED',
  'SERVICE_RESULT_CONFIRMED',
  'FOLLOW_UP_RISK_REVIEWED',
] as const;
export const completionChecklistCodeSchema = z.enum(HIGH_RISK_COMPLETION_CHECKLIST_CODES);
export const completionChecklistRiskReasonSchema = z.enum([
  'PRIORITY_IMMEDIATE_REVIEW',
  'NEED_REQUIRES_HUMAN_REVIEW',
  'NEED_CATEGORY_HEALTH_CONCERN',
  'NEED_CATEGORY_EMERGENCY_CONCERN',
  'SAFETY_RULE_PRESENT',
]);
export const completionChecklistConfirmationRequestSchema = z
  .object({
    code: completionChecklistCodeSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const completionChecklistConfirmationSchema = completionChecklistConfirmationRequestSchema
  .extend({ confirmedAt: isoTimestampSchema })
  .strict();
export const completionChecklistSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    required: z.boolean(),
    riskReasons: z.array(completionChecklistRiskReasonSchema).max(5),
    expectedCodes: z.array(completionChecklistCodeSchema).max(HIGH_RISK_COMPLETION_CHECKLIST_CODES.length),
    confirmations: z.array(completionChecklistConfirmationSchema).max(HIGH_RISK_COMPLETION_CHECKLIST_CODES.length),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const riskReasons = new Set(snapshot.riskReasons);
    if (riskReasons.size !== snapshot.riskReasons.length) {
      context.addIssue({ code: 'custom', path: ['riskReasons'], message: 'must not contain duplicates' });
    }
    const expected = snapshot.required ? [...HIGH_RISK_COMPLETION_CHECKLIST_CODES] : [];
    if (
      snapshot.expectedCodes.length !== expected.length ||
      snapshot.expectedCodes.some((code, index) => code !== expected[index])
    ) {
      context.addIssue({ code: 'custom', path: ['expectedCodes'], message: 'must match the server checklist' });
    }
    if (snapshot.required && snapshot.riskReasons.length === 0) {
      context.addIssue({ code: 'custom', path: ['riskReasons'], message: 'is required for a high-risk checklist' });
    }
    if (!snapshot.required && snapshot.riskReasons.length !== 0) {
      context.addIssue({ code: 'custom', path: ['riskReasons'], message: 'must be empty when no checklist is required' });
    }
    if (
      snapshot.confirmations.length !== expected.length ||
      snapshot.confirmations.some((item, index) => item.code !== expected[index])
    ) {
      context.addIssue({ code: 'custom', path: ['confirmations'], message: 'must confirm every expected code once' });
    }
  });
export const familySummaryStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'REVOKED']);
export const ratingActorTypeSchema = z.enum(['ELDER', 'FAMILY']);

export const acceptedVoiceMimeTypeSchema = z.enum([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
]);
export const fakeVoiceFixtureKeySchema = z.enum([
  'HOT_WATER_DIZZINESS_V1',
  'CARE_COMPLETION_V1',
  'TRANSCRIPTION_FAILURE_V1',
  'ANALYSIS_FAILURE_V1',
]);

const nullableUuidSchema = uuidSchema.nullable();
const nullableTimestampSchema = isoTimestampSchema.nullable();
const correlationIdSchema = identifierSchema.refine((value) => value.length >= 8, {
  message: 'must contain at least eight characters',
});
const boundedNoteSchema = z.string().trim().min(1).max(2_000);
const nullableBoundedNoteSchema = boundedNoteSchema.nullable();
const safeSummarySchema = z.string().trim().min(1).max(1_000);
const ruleCodeSchema = recordCodeSchema;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex digest');

export const needEmotionObservationSchema = z
  .object({
    label: z.enum(['NONE', 'POSSIBLE_DISTRESS']),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().trim().min(1).max(240)).max(10),
  })
  .strict();

export const needAnalysisSubIntentSchema = z
  .object({
    category: needCategorySchema,
    summary: safeSummarySchema,
    urgencySuggestion: needUrgencySchema,
  })
  .strict();

export const needAnalysisOutputSchema = z
  .object({
    summary: safeSummarySchema,
    categories: z.array(needCategorySchema).min(1).max(8),
    urgencySuggestion: needUrgencySchema,
    reportedConcerns: z.array(z.string().trim().min(1).max(160)).max(20),
    safetyFlags: z.array(ruleCodeSchema).max(20),
    emotionObservation: needEmotionObservationSchema.nullable(),
    followUpQuestions: z.array(z.string().trim().min(1).max(240)).max(10),
    requiresHumanReview: z.boolean(),
    subIntents: z.array(needAnalysisSubIntentSchema).min(1).max(8),
  })
  .strict()
  .superRefine((analysis, context) => {
    const categories = new Set(analysis.categories);
    for (const [index, intent] of analysis.subIntents.entries()) {
      if (!categories.has(intent.category)) {
        context.addIssue({
          code: 'custom',
          path: ['subIntents', index, 'category'],
          message: 'must also appear in categories',
        });
      }
    }
  });

export const voiceUploadIntentRequestSchema = z
  .object({
    purpose: voiceSubmissionPurposeSchema.default('ELDER_REQUEST'),
    mimeType: acceptedVoiceMimeTypeSchema,
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
    checksumSha256: sha256Schema.optional(),
    fixtureKey: fakeVoiceFixtureKeySchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const elderVoiceUploadIntentRequestSchema = voiceUploadIntentRequestSchema
  .extend({ purpose: z.literal('ELDER_REQUEST').default('ELDER_REQUEST') })
  .strict();

export const signedUploadSchema = z
  .object({
    method: z.literal('POST'),
    url: z.string().url(),
    fields: z.record(z.string().min(1).max(128), z.string().max(2_048)),
    expiresAt: isoTimestampSchema,
  })
  .strict();

export const voiceUploadIntentSchema = z
  .object({
    submissionId: uuidSchema,
    expectedVersion: versionSchema,
    upload: signedUploadSchema,
    acceptedMimeTypes: z.array(acceptedVoiceMimeTypeSchema).min(1),
    maxSizeBytes: z.number().int().positive(),
  })
  .strict();

export const voiceAudioReadUrlSchema = z
  .object({
    submissionId: uuidSchema,
    url: z.string().url(),
    expiresAt: isoTimestampSchema,
  })
  .strict();

export const voiceUploadFinalizeRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    checksumSha256: sha256Schema.optional(),
  })
  .strict();

export const workOrderCompletionVoiceUploadIntentRequestSchema = voiceUploadIntentRequestSchema
  .omit({ purpose: true })
  .strict();

export const voiceSubmissionCancelRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const voiceSubmissionSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    workOrderId: nullableUuidSchema,
    submittedByUserId: uuidSchema,
    purpose: voiceSubmissionPurposeSchema,
    status: voiceSubmissionStatusSchema,
    mimeType: acceptedVoiceMimeTypeSchema,
    sizeBytes: z.number().int().positive(),
    checksumSha256: sha256Schema.nullable(),
    fixtureKey: fakeVoiceFixtureKeySchema.nullable(),
    failureCode: recordCodeSchema.nullable(),
    uploadedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
    retentionUntil: isoTimestampSchema,
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.purpose === 'ELDER_REQUEST' && submission.workOrderId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['workOrderId'],
        message: 'must be null for elder requests',
      });
    }
    if (submission.purpose === 'WORK_ORDER_COMPLETION' && submission.workOrderId === null) {
      context.addIssue({
        code: 'custom',
        path: ['workOrderId'],
        message: 'is required for work-order completion audio',
      });
    }
    if (submission.status === 'FAILED' && submission.failureCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'is required for failed submissions',
      });
    }
  });

export const transcriptMetadataSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    voiceSubmissionId: uuidSchema,
    status: transcriptStatusSchema,
    confidence: z.number().min(0).max(1).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    provider: recordCodeSchema,
    model: recordCodeSchema,
    providerVersion: recordCodeSchema,
    failureCode: recordCodeSchema.nullable(),
    retentionUntil: isoTimestampSchema,
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
    completedAt: nullableTimestampSchema,
  })
  .strict();

export const transcriptPrivateSchema = transcriptMetadataSchema
  .extend({ text: z.string().max(20_000).nullable() })
  .strict()
  .superRefine((transcript, context) => {
    if (transcript.status === 'COMPLETED' && (transcript.text === null || transcript.text.length === 0)) {
      context.addIssue({ code: 'custom', path: ['text'], message: 'is required when completed' });
    }
    if (transcript.status === 'FAILED' && transcript.failureCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'is required when failed',
      });
    }
  });

export const completionVoiceDraftSchema = z
  .object({
    workOrderId: uuidSchema,
    voiceSubmissionId: uuidSchema,
    noteText: boundedNoteSchema,
    aiDisclosure: z.literal('AI_DRAFT_REQUIRES_CAREGIVER_REVIEW'),
    requiresCaregiverReview: z.literal(true),
  })
  .strict();

export const caregiverCompletionVoiceResultSchema = z
  .object({
    submission: voiceSubmissionSchema,
    transcript: transcriptMetadataSchema.nullable(),
    completionDraft: completionVoiceDraftSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.submission.status === 'COMPLETED' && result.completionDraft === null) {
      context.addIssue({
        code: 'custom',
        path: ['completionDraft'],
        message: 'is required when completion voice processing succeeds',
      });
    }
    if (result.submission.status !== 'COMPLETED' && result.completionDraft !== null) {
      context.addIssue({
        code: 'custom',
        path: ['completionDraft'],
        message: 'must be null until completion voice processing succeeds',
      });
    }
  });

export const aiAnalysisSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    transcriptId: uuidSchema,
    status: aiAnalysisStatusSchema,
    output: needAnalysisOutputSchema.nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    evidence: z.array(z.string().trim().min(1).max(240)).max(20),
    provider: recordCodeSchema,
    model: recordCodeSchema,
    promptVersion: recordCodeSchema,
    schemaVersion: recordCodeSchema,
    failureCode: recordCodeSchema.nullable(),
    retentionUntil: isoTimestampSchema,
    contentDeletedAt: nullableTimestampSchema,
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
    completedAt: nullableTimestampSchema,
  })
  .strict()
  .superRefine((analysis, context) => {
    if (
      analysis.status === 'COMPLETED' &&
      analysis.output === null &&
      analysis.contentDeletedAt === null
    ) {
      context.addIssue({ code: 'custom', path: ['output'], message: 'is required when completed' });
    }
    if (analysis.contentDeletedAt !== null && analysis.output !== null) {
      context.addIssue({
        code: 'custom',
        path: ['output'],
        message: 'must be null after retained content is deleted',
      });
    }
    if (analysis.contentDeletedAt !== null && analysis.evidence.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'must be empty after retained content is deleted',
      });
    }
    if (analysis.status === 'FAILED' && analysis.failureCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'is required when failed',
      });
    }
  });

export const needSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    voiceSubmissionId: nullableUuidSchema,
    aiAnalysisId: nullableUuidSchema,
    source: needSourceSchema,
    summary: safeSummarySchema,
    category: needCategorySchema,
    urgencySuggestion: needUrgencySchema,
    priority: needUrgencySchema,
    requiresHumanReview: z.boolean(),
    safetyRuleCodes: z.array(ruleCodeSchema).max(20),
    status: needStatusSchema,
    reviewedByUserId: nullableUuidSchema,
    reviewedAt: nullableTimestampSchema,
    reviewReasonCode: recordCodeSchema.nullable(),
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((need, context) => {
    if (need.source === 'VOICE' && need.voiceSubmissionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['voiceSubmissionId'],
        message: 'is required for voice needs',
      });
    }
    if (['CONFIRMED', 'REJECTED'].includes(need.status) && need.reviewedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['reviewedAt'],
        message: 'is required after review',
      });
    }
  });

export const elderProjectionSchema = z
  .object({
    id: uuidSchema,
    displayName: displayTextSchema,
    preferredName: displayTextSchema.nullable(),
    recordNumber: recordCodeSchema,
    roomLabel: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export const assigneeProjectionSchema = z
  .object({
    staffProfileId: uuidSchema,
    displayName: displayTextSchema,
    jobTitle: displayTextSchema,
  })
  .strict();

export const adminNeedSchema = needSchema
  .extend({ elder: elderProjectionSchema })
  .strict();

export const needLinkSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    sourceNeedId: uuidSchema,
    targetNeedId: uuidSchema,
    kind: needLinkKindSchema,
    correlationId: correlationIdSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()
  .refine((link) => link.sourceNeedId !== link.targetNeedId, {
    path: ['targetNeedId'],
    message: 'must differ from sourceNeedId',
  });

export const needsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    elderId: uuidSchema.optional(),
    category: needCategorySchema.optional(),
    priority: needUrgencySchema.optional(),
    status: needStatusSchema.optional(),
    requiresHumanReview: z.preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean()).optional(),
    sort: z.enum(['createdAt', 'priority', 'status', 'updatedAt']).default('createdAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .strict();

export const needsPageSchema = z
  .object({ items: z.array(needSchema), pageInfo: pageInfoSchema })
  .strict();

export const adminNeedsPageSchema = z
  .object({ items: z.array(adminNeedSchema), pageInfo: pageInfoSchema })
  .strict();

export const manualNeedCreateRequestSchema = z
  .object({
    elderId: uuidSchema,
    summary: safeSummarySchema,
    category: needCategorySchema,
    priority: needUrgencySchema,
    requiresHumanReview: z.boolean().default(false),
    reasonCode: recordCodeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const needReviewRequestSchema = z.discriminatedUnion('decision', [
  z
    .object({
      expectedVersion: versionSchema,
      decision: z.literal('CONFIRM'),
      summary: safeSummarySchema,
      category: needCategorySchema,
      priority: needUrgencySchema,
      reasonCode: recordCodeSchema,
    })
    .strict(),
  z
    .object({
      expectedVersion: versionSchema,
      decision: z.literal('REJECT'),
      summary: safeSummarySchema.optional(),
      category: needCategorySchema.optional(),
      priority: needUrgencySchema.optional(),
      reasonCode: recordCodeSchema,
    })
    .strict(),
]);

export const workOrderAssignmentSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    workOrderId: uuidSchema,
    targetTeamId: nullableUuidSchema,
    assigneeStaffProfileId: nullableUuidSchema,
    shiftAssignmentId: nullableUuidSchema,
    status: workOrderAssignmentStatusSchema,
    assignedByUserId: uuidSchema,
    assignedAt: isoTimestampSchema,
    claimedAt: nullableTimestampSchema,
    releasedAt: nullableTimestampSchema,
    reasonCode: recordCodeSchema,
    version: versionSchema,
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.targetTeamId === null && assignment.assigneeStaffProfileId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetTeamId'],
        message: 'a team or staff assignee is required',
      });
    }
    if (assignment.status === 'CLAIMED' && assignment.assigneeStaffProfileId === null) {
      context.addIssue({
        code: 'custom',
        path: ['assigneeStaffProfileId'],
        message: 'is required when claimed',
      });
    }
  });

export const workOrderSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    primaryNeedId: uuidSchema,
    code: recordCodeSchema,
    title: displayTextSchema,
    summary: safeSummarySchema,
    priority: needUrgencySchema,
    status: workOrderStatusSchema,
    dueAt: isoTimestampSchema,
    acceptedAt: nullableTimestampSchema,
    arrivedAt: nullableTimestampSchema,
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
    verifiedAt: nullableTimestampSchema,
    closedAt: nullableTimestampSchema,
    cancelledAt: nullableTimestampSchema,
    currentAssignment: workOrderAssignmentSchema.nullable(),
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((workOrder, context) => {
    const requiredTimestamps: Partial<Record<z.infer<typeof workOrderStatusSchema>, keyof typeof workOrder>> = {
      ACCEPTED: 'acceptedAt',
      IN_PROGRESS: 'startedAt',
      COMPLETED: 'completedAt',
      VERIFIED: 'verifiedAt',
      CLOSED: 'closedAt',
      CANCELLED: 'cancelledAt',
    };
    const timestamp = requiredTimestamps[workOrder.status];
    if (timestamp !== undefined && workOrder[timestamp] === null) {
      context.addIssue({ code: 'custom', path: [timestamp], message: `is required for ${workOrder.status}` });
    }
  });

export const adminWorkOrderListItemSchema = workOrderSchema
  .extend({
    elder: elderProjectionSchema,
    assignee: assigneeProjectionSchema.optional(),
  })
  .strict();

export const caregiverWorkOrderSchema = workOrderSchema
  .extend({
    elderDisplayName: displayTextSchema,
    locationLabel: z.string().trim().min(1).max(240).nullable(),
    operationalAttention: z.array(recordCodeSchema).max(4),
    completionChecklistRequired: z.boolean(),
    requiredCompletionChecklistCodes: z
      .array(completionChecklistCodeSchema)
      .max(HIGH_RISK_COMPLETION_CHECKLIST_CODES.length),
  })
  .strict()
  .superRefine((workOrder, context) => {
    const expected = workOrder.completionChecklistRequired
      ? [...HIGH_RISK_COMPLETION_CHECKLIST_CODES]
      : [];
    if (
      workOrder.requiredCompletionChecklistCodes.length !== expected.length ||
      workOrder.requiredCompletionChecklistCodes.some((code, index) => code !== expected[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['requiredCompletionChecklistCodes'],
        message: 'must match completionChecklistRequired',
      });
    }
  });

export const workOrderTransitionSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    workOrderId: uuidSchema,
    fromStatus: workOrderStatusSchema.nullable(),
    toStatus: workOrderStatusSchema,
    fromVersion: z.number().int().min(0),
    toVersion: versionSchema,
    actorUserId: uuidSchema,
    reasonCode: recordCodeSchema,
    correlationId: correlationIdSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict()
  .refine((transition) => transition.toVersion === transition.fromVersion + 1, {
    path: ['toVersion'],
    message: 'must increment fromVersion by one',
  });

export const serviceCompletionSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    workOrderId: uuidSchema,
    submittedByStaffProfileId: uuidSchema,
    noteSource: completionNoteSourceSchema,
    noteText: nullableBoundedNoteSchema,
    voiceSubmissionId: nullableUuidSchema,
    confirmedAt: isoTimestampSchema,
    completionChecklist: completionChecklistSnapshotSchema,
    checklistConfirmedAt: nullableTimestampSchema,
    correlationId: correlationIdSchema,
    version: versionSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.noteSource === 'TEXT' && completion.noteText === null) {
      context.addIssue({ code: 'custom', path: ['noteText'], message: 'is required for text notes' });
    }
    if (completion.noteSource === 'VOICE' && completion.voiceSubmissionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['voiceSubmissionId'],
        message: 'is required for voice notes',
      });
    }
    if (completion.completionChecklist.required !== (completion.checklistConfirmedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['checklistConfirmedAt'],
        message: 'must be present exactly when the checklist is required',
      });
    }
  });

export const workOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    elderId: uuidSchema.optional(),
    status: workOrderStatusSchema.optional(),
    priority: needUrgencySchema.optional(),
    assigneeStaffProfileId: uuidSchema.optional(),
    overdue: z.preprocess((value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    }, z.boolean()).optional(),
    sort: z.enum(['createdAt', 'dueAt', 'priority', 'status', 'updatedAt']).default('createdAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .strict();

export const workOrdersPageSchema = z
  .object({ items: z.array(workOrderSchema), pageInfo: pageInfoSchema })
  .strict();

export const adminWorkOrdersPageSchema = z
  .object({ items: z.array(adminWorkOrderListItemSchema), pageInfo: pageInfoSchema })
  .strict();

export const caregiverWorkOrdersPageSchema = z
  .object({ items: z.array(caregiverWorkOrderSchema), pageInfo: pageInfoSchema })
  .strict();

export const workOrderCreateRequestSchema = z
  .object({
    primaryNeedId: uuidSchema,
    title: displayTextSchema,
    summary: safeSummarySchema,
    priority: needUrgencySchema,
    dueAt: isoTimestampSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const workOrderAssignmentRequestBase = {
  expectedVersion: versionSchema,
  reasonCode: recordCodeSchema,
} as const;

export const workOrderAssignRequestSchema = z.union([
  z
    .object({
      ...workOrderAssignmentRequestBase,
      targetTeamId: uuidSchema,
      assigneeStaffProfileId: uuidSchema,
      shiftAssignmentId: uuidSchema,
    })
    .strict(),
  z
    .object({
      ...workOrderAssignmentRequestBase,
      targetTeamId: uuidSchema,
      assigneeStaffProfileId: z.never().optional(),
      shiftAssignmentId: z.never().optional(),
    })
    .strict(),
  z
    .object({
      ...workOrderAssignmentRequestBase,
      targetTeamId: z.never().optional(),
      assigneeStaffProfileId: uuidSchema,
      shiftAssignmentId: z.never().optional(),
    })
    .strict(),
]);

export const workOrderTransitionRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    targetStatus: workOrderStatusSchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const workOrderAcceptRequestSchema = workOrderTransitionRequestSchema
  .extend({ targetStatus: z.literal('ACCEPTED') })
  .strict();

export const workOrderStartRequestSchema = workOrderTransitionRequestSchema
  .extend({ targetStatus: z.literal('IN_PROGRESS') })
  .strict();

export const workOrderVerifyRequestSchema = workOrderTransitionRequestSchema
  .extend({ targetStatus: z.literal('VERIFIED') })
  .strict();

export const workOrderCloseRequestSchema = workOrderTransitionRequestSchema
  .extend({ targetStatus: z.literal('CLOSED') })
  .strict();

export const workOrderArrivalRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const workOrderArrivalSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    workOrderId: uuidSchema,
    actorUserId: uuidSchema,
    fromVersion: versionSchema,
    toVersion: versionSchema,
    reasonCode: recordCodeSchema,
    arrivedAt: isoTimestampSchema,
    correlationId: correlationIdSchema,
  })
  .strict()
  .refine((arrival) => arrival.toVersion === arrival.fromVersion + 1, {
    path: ['toVersion'],
    message: 'must increment fromVersion by one',
  });

export const workOrderDetailSchema = workOrderSchema
  .extend({
    need: needSchema,
    linkedNeeds: z.array(needSchema),
    assignments: z.array(workOrderAssignmentSchema),
    transitions: z.array(workOrderTransitionSchema),
    arrivals: z.array(workOrderArrivalSchema),
    completion: serviceCompletionSchema.nullable(),
  })
  .strict();

const workOrderCompletionRequestBase = {
  expectedVersion: versionSchema,
  reasonCode: recordCodeSchema,
  idempotencyKey: idempotencyKeySchema,
  completionChecklist: z
    .array(completionChecklistConfirmationRequestSchema)
    .max(HIGH_RISK_COMPLETION_CHECKLIST_CODES.length)
    .superRefine((items, context) => {
      const uniqueCodes = new Set(items.map((item) => item.code));
      if (uniqueCodes.size !== items.length) {
        context.addIssue({ code: 'custom', message: 'must not contain duplicate codes' });
      }
    })
    .optional(),
} as const;

export const workOrderCompletionRequestSchema = z.discriminatedUnion('noteSource', [
  z
    .object({
      ...workOrderCompletionRequestBase,
      noteSource: z.literal('TEXT'),
      noteText: boundedNoteSchema,
    })
    .strict(),
  z
    .object({
      ...workOrderCompletionRequestBase,
      noteSource: z.literal('VOICE'),
      noteText: boundedNoteSchema.optional(),
      voiceSubmissionId: uuidSchema,
    })
    .strict(),
]);

export const familySummarySchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    workOrderId: uuidSchema,
    status: familySummaryStatusSchema,
    title: displayTextSchema,
    summary: safeSummarySchema,
    serviceCompletedAt: isoTimestampSchema,
    publishedAt: nullableTimestampSchema,
    version: versionSchema,
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.status === 'PUBLISHED' && summary.publishedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['publishedAt'],
        message: 'is required when published',
      });
    }
  });

export const workOrderRuleResultSchema = z
  .object({
    code: recordCodeSchema,
    label: displayTextSchema,
    explanation: z.string().trim().min(1).max(500),
    severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  })
  .strict();

export const adminWorkOrderDetailSchema = workOrderDetailSchema
  .extend({
    elder: elderProjectionSchema,
    assignee: assigneeProjectionSchema.optional(),
    analysis: aiAnalysisSchema.nullable(),
    ruleResults: z.array(workOrderRuleResultSchema).max(20),
    familySummary: familySummarySchema.nullable(),
  })
  .strict();

export const familySummariesPageSchema = z
  .object({ items: z.array(familySummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const familySummariesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    elderId: uuidSchema.optional(),
  })
  .strict();

export const familySummaryPublishRequestSchema = z
  .object({
    expectedWorkOrderVersion: versionSchema,
    title: displayTextSchema,
    summary: safeSummarySchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const ratingSchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    workOrderId: uuidSchema,
    actorType: ratingActorTypeSchema,
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(1_000).nullable(),
    requiresFollowUp: z.boolean(),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const elderServiceSchema = workOrderSchema
  .extend({
    canVerify: z.boolean(),
    canRate: z.boolean(),
    rating: ratingSchema.nullable(),
  })
  .strict();

export const elderServicesPageSchema = z
  .object({ items: z.array(elderServiceSchema), pageInfo: pageInfoSchema })
  .strict();

export const ratingCreateRequestSchema = z
  .object({
    expectedWorkOrderVersion: versionSchema,
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(1_000).optional(),
    requiresFollowUp: z.boolean().default(false),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/**
 * Local deterministic demo entry point. Production clients use the
 * upload-intent/finalize flow and never submit a raw transcript.
 */
export const elderVoiceDemoRequestSchema = z
  .object({
    fixtureKey: z.literal('HOT_WATER_DIZZINESS_V1').default('HOT_WATER_DIZZINESS_V1'),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const elderVoiceDemoResponseSchema = z
  .object({
    submission: voiceSubmissionSchema,
    transcript: transcriptMetadataSchema,
    analysis: aiAnalysisSchema,
    needs: z.array(needSchema).min(2),
    workOrder: workOrderSchema.nullable(),
  })
  .strict();

export const elderVoiceSubmissionProgressSchema = z
  .object({
    submission: voiceSubmissionSchema,
    transcript: transcriptMetadataSchema.optional(),
    analysis: aiAnalysisSchema.optional(),
    needs: z.array(needSchema),
    workOrder: workOrderSchema.nullable(),
  })
  .strict();

export const elderHumanHelpRequestSchema = z
  .object({
    reasonCode: recordCodeSchema,
    message: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const elderHumanHelpResponseSchema = z
  .object({
    need: needSchema,
    workOrder: workOrderSchema.nullable(),
    humanReviewRequired: z.literal(true),
  })
  .strict();

export const taskUpdateEventSchema = z
  .object({
    eventId: identifierSchema,
    eventType: z.enum([
      'WORK_ORDER.ASSIGNED',
      'WORK_ORDER.ACCEPTED',
      'WORK_ORDER.ARRIVED',
      'WORK_ORDER.IN_PROGRESS',
      'WORK_ORDER.COMPLETED',
      'WORK_ORDER.VERIFIED',
      'WORK_ORDER.CLOSED',
      'WORK_ORDER.CANCELLED',
    ]),
    workOrderId: uuidSchema,
    status: workOrderStatusSchema,
    version: versionSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict();

export type VoiceSubmissionPurpose = z.infer<typeof voiceSubmissionPurposeSchema>;
export type VoiceSubmissionStatus = z.infer<typeof voiceSubmissionStatusSchema>;
export type VoiceUploadIntentRequest = z.infer<typeof voiceUploadIntentRequestSchema>;
export type ElderVoiceUploadIntentRequest = z.infer<typeof elderVoiceUploadIntentRequestSchema>;
export type VoiceUploadIntent = z.infer<typeof voiceUploadIntentSchema>;
export type VoiceAudioReadUrl = z.infer<typeof voiceAudioReadUrlSchema>;
export type VoiceUploadFinalizeRequest = z.infer<typeof voiceUploadFinalizeRequestSchema>;
export type WorkOrderCompletionVoiceUploadIntentRequest = z.infer<typeof workOrderCompletionVoiceUploadIntentRequestSchema>;
export type VoiceSubmissionCancelRequest = z.infer<typeof voiceSubmissionCancelRequestSchema>;
export type VoiceSubmission = z.infer<typeof voiceSubmissionSchema>;
export type TranscriptMetadata = z.infer<typeof transcriptMetadataSchema>;
export type TranscriptPrivate = z.infer<typeof transcriptPrivateSchema>;
export type CompletionVoiceDraft = z.infer<typeof completionVoiceDraftSchema>;
export type CaregiverCompletionVoiceResult = z.infer<typeof caregiverCompletionVoiceResultSchema>;
export type NeedAnalysisOutput = z.infer<typeof needAnalysisOutputSchema>;
export type AIAnalysis = z.infer<typeof aiAnalysisSchema>;
export type Need = z.infer<typeof needSchema>;
export type ElderProjection = z.infer<typeof elderProjectionSchema>;
export type AssigneeProjection = z.infer<typeof assigneeProjectionSchema>;
export type AdminNeed = z.infer<typeof adminNeedSchema>;
export type NeedLink = z.infer<typeof needLinkSchema>;
export type NeedsQuery = z.infer<typeof needsQuerySchema>;
export type NeedsPage = z.infer<typeof needsPageSchema>;
export type ManualNeedCreateRequest = z.infer<typeof manualNeedCreateRequestSchema>;
export type NeedReviewRequest = z.infer<typeof needReviewRequestSchema>;
export type WorkOrderStatus = z.infer<typeof workOrderStatusSchema>;
export type WorkOrderAssignment = z.infer<typeof workOrderAssignmentSchema>;
export type WorkOrder = z.infer<typeof workOrderSchema>;
export type AdminWorkOrderListItem = z.infer<typeof adminWorkOrderListItemSchema>;
export type CaregiverWorkOrder = z.infer<typeof caregiverWorkOrderSchema>;
export type WorkOrderTransition = z.infer<typeof workOrderTransitionSchema>;
export type ServiceCompletion = z.infer<typeof serviceCompletionSchema>;
export type CompletionChecklistCode = z.infer<typeof completionChecklistCodeSchema>;
export type CompletionChecklistRiskReason = z.infer<typeof completionChecklistRiskReasonSchema>;
export type CompletionChecklistSnapshot = z.infer<typeof completionChecklistSnapshotSchema>;
export type WorkOrderDetail = z.infer<typeof workOrderDetailSchema>;
export type AdminWorkOrderDetail = z.infer<typeof adminWorkOrderDetailSchema>;
export type WorkOrdersQuery = z.infer<typeof workOrdersQuerySchema>;
export type WorkOrdersPage = z.infer<typeof workOrdersPageSchema>;
export type WorkOrderCreateRequest = z.infer<typeof workOrderCreateRequestSchema>;
export type WorkOrderAssignRequest = z.infer<typeof workOrderAssignRequestSchema>;
export type WorkOrderTransitionRequest = z.infer<typeof workOrderTransitionRequestSchema>;
export type WorkOrderAcceptRequest = z.infer<typeof workOrderAcceptRequestSchema>;
export type WorkOrderStartRequest = z.infer<typeof workOrderStartRequestSchema>;
export type WorkOrderVerifyRequest = z.infer<typeof workOrderVerifyRequestSchema>;
export type WorkOrderCloseRequest = z.infer<typeof workOrderCloseRequestSchema>;
export type WorkOrderArrivalRequest = z.infer<typeof workOrderArrivalRequestSchema>;
export type WorkOrderArrival = z.infer<typeof workOrderArrivalSchema>;
export type WorkOrderCompletionRequest = z.infer<typeof workOrderCompletionRequestSchema>;
export type FamilySummary = z.infer<typeof familySummarySchema>;
export type FamilySummariesQuery = z.infer<typeof familySummariesQuerySchema>;
export type FamilySummariesPage = z.infer<typeof familySummariesPageSchema>;
export type FamilySummaryPublishRequest = z.infer<typeof familySummaryPublishRequestSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type ElderService = z.infer<typeof elderServiceSchema>;
export type RatingCreateRequest = z.infer<typeof ratingCreateRequestSchema>;
export type ElderVoiceDemoRequest = z.infer<typeof elderVoiceDemoRequestSchema>;
export type ElderVoiceDemoResponse = z.infer<typeof elderVoiceDemoResponseSchema>;
export type ElderVoiceSubmissionProgress = z.infer<typeof elderVoiceSubmissionProgressSchema>;
export type ElderHumanHelpRequest = z.infer<typeof elderHumanHelpRequestSchema>;
export type ElderHumanHelpResponse = z.infer<typeof elderHumanHelpResponseSchema>;
export type TaskUpdateEvent = z.infer<typeof taskUpdateEventSchema>;
