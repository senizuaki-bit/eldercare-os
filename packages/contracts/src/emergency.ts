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

export const emergencyStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'RESPONDING',
  'RESOLVED',
  'REVIEWED',
]);

const familyEmergencyPreferenceVersionSchema = z.number().int().nonnegative();
export const emergencySourceKindSchema = z.enum([
  'ELDER_BUTTON',
  'VOICE_RISK',
  'IOT_BUTTON',
  'STAFF_MANUAL',
]);
export const emergencyLocationStateSchema = z.enum([
  'CURRENT',
  'STALE',
  'ROOM_FALLBACK',
  'UNKNOWN',
]);
export const emergencyResponderStatusSchema = z.enum([
  'OFFERED',
  'ASSIGNED',
  'ACKNOWLEDGED',
  'RELEASED',
]);
export const emergencyMilestoneKindSchema = z.enum(['EN_ROUTE', 'ON_SITE']);
export const emergencySlaStageSchema = z.enum([
  'ACKNOWLEDGEMENT',
  'ARRIVAL',
  'RESOLUTION',
]);
export const emergencyEscalationStatusSchema = z.enum([
  'SCHEDULED',
  'TRIGGERED',
  'CANCELLED',
  'FAILED',
]);
export const emergencyReviewKindSchema = z.enum(['COMPLETED', 'WAIVED']);
export const emergencyFamilyStageSchema = z.enum([
  'OPENED',
  'ACKNOWLEDGED',
  'RESPONDING',
  'RESOLVED',
  'REVIEWED',
]);
export const emergencyNotificationChannelSchema = z.enum([
  'IN_APP',
  'SMS',
  'PHONE',
  'EMAIL',
]);
export const emergencyDeliveryStatusSchema = z.enum([
  'PENDING',
  'DELIVERED',
  'FAILED',
  'SUPPRESSED',
]);
export const emergencyActorTypeSchema = z.enum(['USER', 'SYSTEM', 'DEVICE', 'AGENT']);

export const EMERGENCY_RESOLUTION_CHECKLIST_CODES = [
  'SCENE_SAFETY_CONFIRMED',
  'ELDER_STATE_CONFIRMED',
  'FOLLOW_UP_HANDOFF_CONFIRMED',
] as const;
export const emergencyResolutionChecklistCodeSchema = z.enum(
  EMERGENCY_RESOLUTION_CHECKLIST_CODES,
);
export const emergencyResolutionChecklistConfirmationSchema = z
  .object({
    code: emergencyResolutionChecklistCodeSchema,
    confirmed: z.literal(true),
  })
  .strict();
export const emergencyResolutionChecklistRequestSchema = z
  .array(emergencyResolutionChecklistConfirmationSchema)
  .length(EMERGENCY_RESOLUTION_CHECKLIST_CODES.length)
  .superRefine((items, context) => {
    items.forEach((item, index) => {
      if (item.code !== EMERGENCY_RESOLUTION_CHECKLIST_CODES[index]) {
        context.addIssue({
          code: 'custom',
          path: [index, 'code'],
          message: 'must confirm the complete server-owned checklist in order',
        });
      }
    });
  });

const boundedSummarySchema = z.string().trim().min(1).max(1_000);
const nullableTimestampSchema = isoTimestampSchema.nullable();
const nullableUuidSchema = uuidSchema.nullable();
const nullableRecordCodeSchema = recordCodeSchema.nullable();
const nullableDisplayTextSchema = displayTextSchema.nullable();
const clientObservedAtSchema = isoTimestampSchema.optional();

export const emergencyLocationInputSchema = z
  .object({
    source: recordCodeSchema,
    observedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    floorId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    normalizedX: z.number().min(0).max(1).optional(),
    normalizedY: z.number().min(0).max(1).optional(),
    accuracyMeters: z.number().positive().max(100_000).optional(),
  })
  .strict()
  .superRefine((location, context) => {
    if (Date.parse(location.expiresAt) <= Date.parse(location.observedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'must be later than observedAt',
      });
    }
    if ((location.normalizedX === undefined) !== (location.normalizedY === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['normalizedX'],
        message: 'normalized coordinates must be supplied together',
      });
    }
  });

export const elderEmergencySignalRequestSchema = z
  .object({
    externalEventId: identifierSchema,
    idempotencyKey: idempotencyKeySchema,
    reasonCode: recordCodeSchema.default('ELDER_BUTTON_PRESSED'),
    clientObservedAt: clientObservedAtSchema,
  })
  .strict();

export const mqttEmergencySignalPayloadSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    eventId: identifierSchema,
    organizationSlug: identifierSchema,
    facilityCode: identifierSchema,
    sourceId: identifierSchema,
    timestamp: isoTimestampSchema,
    reasonCode: recordCodeSchema.default('IOT_EMERGENCY_BUTTON'),
    location: emergencyLocationInputSchema.optional(),
  })
  .strict();

export const emergencyAssignRequestSchema = z
  .object({
    staffProfileId: uuidSchema,
    shiftAssignmentId: uuidSchema,
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    reasonCode: recordCodeSchema,
    emergencyElevationReasonCode: recordCodeSchema.optional(),
  })
  .strict();

export const emergencyAcknowledgeRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    reasonCode: recordCodeSchema.default('CAREGIVER_ACKNOWLEDGED'),
    clientObservedAt: clientObservedAtSchema,
  })
  .strict();

export const emergencyMilestoneRequestSchema = z
  .object({
    kind: emergencyMilestoneKindSchema,
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    reasonCode: recordCodeSchema,
    clientObservedAt: clientObservedAtSchema,
  })
  .strict();

export const emergencyResolveRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    outcomeCode: recordCodeSchema,
    summary: boundedSummarySchema,
    familyNotify: z.boolean(),
    completionChecklist: emergencyResolutionChecklistRequestSchema,
  })
  .strict();

export const emergencyReviewRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    idempotencyKey: idempotencyKeySchema,
    kind: emergencyReviewKindSchema,
    summary: boundedSummarySchema.optional(),
    waiverReasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.kind === 'COMPLETED') {
      if (review.summary === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'is required for a completed review',
        });
      }
      if (review.waiverReasonCode !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['waiverReasonCode'],
          message: 'must be omitted for a completed review',
        });
      }
    } else {
      if (review.waiverReasonCode === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['waiverReasonCode'],
          message: 'is required for a waived review',
        });
      }
      if (review.summary !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['summary'],
          message: 'must be omitted for a waived review',
        });
      }
    }
  });

export const familyEmergencyPreferenceUpdateRequestSchema = z
  .object({
    expectedVersion: familyEmergencyPreferenceVersionSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
    enabled: z.boolean(),
    notifyOnOpened: z.boolean(),
    notifyOnResolved: z.boolean(),
    channel: emergencyNotificationChannelSchema,
  })
  .strict();

export const emergenciesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: emergencyStatusSchema.optional(),
    sourceKind: emergencySourceKindSchema.optional(),
    locationState: emergencyLocationStateSchema.optional(),
    search: z.string().trim().max(160).optional(),
    sortBy: z.enum(['openedAt', 'updatedAt', 'status']).default('openedAt'),
    sortDirection: sortDirectionSchema.default('desc'),
  })
  .strict();

export const familyEmergenciesQuerySchema = emergenciesQuerySchema
  .pick({
    page: true,
    pageSize: true,
  })
  .strict();

export const emergencyElderProjectionSchema = z
  .object({
    id: uuidSchema,
    displayName: displayTextSchema,
    preferredName: nullableDisplayTextSchema,
    roomLabel: nullableDisplayTextSchema,
  })
  .strict();

export const emergencyLocationProjectionSchema = z
  .object({
    state: emergencyLocationStateSchema,
    source: recordCodeSchema,
    label: nullableDisplayTextSchema,
    observedAt: nullableTimestampSchema,
    expiresAt: nullableTimestampSchema,
    accuracyMeters: z.number().nonnegative().nullable(),
    fallbackReasonCode: nullableRecordCodeSchema,
  })
  .strict()
  .superRefine((location, context) => {
    if (location.state !== 'CURRENT' && location.accuracyMeters !== null) {
      context.addIssue({
        code: 'custom',
        path: ['accuracyMeters'],
        message: 'must be hidden unless the location is current',
      });
    }
  });

export const emergencyResponderProjectionSchema = z
  .object({
    id: uuidSchema,
    staffProfileId: uuidSchema,
    displayName: nullableDisplayTextSchema,
    jobTitle: nullableDisplayTextSchema,
    status: emergencyResponderStatusSchema,
    isEmergencyElevation: z.boolean(),
    elevationExpiresAt: nullableTimestampSchema,
    assignedAt: isoTimestampSchema,
    acknowledgedAt: nullableTimestampSchema,
  })
  .strict();

export const emergencySlaProjectionSchema = z
  .object({
    stage: emergencySlaStageSchema,
    status: emergencyEscalationStatusSchema,
    dueAt: isoTimestampSchema,
  })
  .strict();

export const emergencyAdminItemSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    elder: emergencyElderProjectionSchema,
    sourceKind: emergencySourceKindSchema,
    reasonCode: recordCodeSchema,
    status: emergencyStatusSchema,
    version: versionSchema,
    openedAt: isoTimestampSchema,
    acknowledgedAt: nullableTimestampSchema,
    respondingAt: nullableTimestampSchema,
    onSiteAt: nullableTimestampSchema,
    resolvedAt: nullableTimestampSchema,
    reviewedAt: nullableTimestampSchema,
    currentDeadlineAt: nullableTimestampSchema,
    location: emergencyLocationProjectionSchema,
    currentResponder: emergencyResponderProjectionSchema.nullable(),
    activeSla: emergencySlaProjectionSchema.nullable(),
    escalationCount: z.number().int().nonnegative(),
    correlationId: identifierSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const emergencyTransitionProjectionSchema = z
  .object({
    id: uuidSchema,
    fromStatus: emergencyStatusSchema.nullable(),
    toStatus: emergencyStatusSchema,
    fromVersion: z.number().int().nonnegative(),
    toVersion: versionSchema,
    actorType: emergencyActorTypeSchema,
    actorLabel: nullableDisplayTextSchema,
    reasonCode: recordCodeSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict();

export const emergencyAcknowledgementProjectionSchema = z
  .object({
    staffProfileId: uuidSchema,
    actorLabel: nullableDisplayTextSchema,
    clientObservedAt: nullableTimestampSchema,
    acknowledgedAt: isoTimestampSchema,
  })
  .strict();

export const emergencyMilestoneProjectionSchema = z
  .object({
    id: uuidSchema,
    kind: emergencyMilestoneKindSchema,
    staffProfileId: uuidSchema,
    actorLabel: nullableDisplayTextSchema,
    clientObservedAt: nullableTimestampSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict();

export const emergencyEscalationProjectionSchema = z
  .object({
    id: uuidSchema,
    stage: emergencySlaStageSchema,
    status: emergencyEscalationStatusSchema,
    dueAt: isoTimestampSchema,
    triggeredAt: nullableTimestampSchema,
  })
  .strict();

export const emergencyResolutionProjectionSchema = z
  .object({
    resolvedByLabel: nullableDisplayTextSchema,
    summary: boundedSummarySchema,
    outcomeCode: recordCodeSchema,
    familyNotify: z.boolean(),
    completionChecklist: z
      .array(emergencyResolutionChecklistCodeSchema)
      .length(EMERGENCY_RESOLUTION_CHECKLIST_CODES.length),
    resolvedAt: isoTimestampSchema,
  })
  .strict();

export const emergencyReviewProjectionSchema = z
  .object({
    reviewedByLabel: nullableDisplayTextSchema,
    kind: emergencyReviewKindSchema,
    summary: boundedSummarySchema.nullable(),
    waiverReasonCode: nullableRecordCodeSchema,
    reviewedAt: isoTimestampSchema,
  })
  .strict();

export const emergencyRelatedEventProjectionSchema = z
  .object({
    id: uuidSchema,
    status: emergencyStatusSchema,
    reasonCode: recordCodeSchema,
    openedAt: isoTimestampSchema,
  })
  .strict();

export const emergencyAdminDetailSchema = emergencyAdminItemSchema
  .extend({
    acknowledgement: emergencyAcknowledgementProjectionSchema.nullable(),
    responders: z.array(emergencyResponderProjectionSchema).max(100),
    milestones: z.array(emergencyMilestoneProjectionSchema).max(10),
    escalations: z.array(emergencyEscalationProjectionSchema).max(100),
    transitions: z.array(emergencyTransitionProjectionSchema).max(100),
    relatedEvents: z.array(emergencyRelatedEventProjectionSchema).max(100),
    resolution: emergencyResolutionProjectionSchema.nullable(),
    review: emergencyReviewProjectionSchema.nullable(),
    requiredResolutionChecklistCodes: z
      .tuple([
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[0]),
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[1]),
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[2]),
      ]),
  })
  .strict();

export const emergencyAdminPageSchema = z
  .object({
    items: z.array(emergencyAdminItemSchema).max(100),
    pageInfo: pageInfoSchema,
  })
  .strict();

export const caregiverEmergencySchema = emergencyAdminItemSchema
  .omit({
    organizationId: true,
    facilityId: true,
    correlationId: true,
    reviewedAt: true,
    currentResponder: true,
  })
  .extend({
    assignedToMe: z.boolean(),
    requiredResolutionChecklistCodes: z
      .tuple([
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[0]),
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[1]),
        z.literal(EMERGENCY_RESOLUTION_CHECKLIST_CODES[2]),
      ]),
  })
  .strict();

export const caregiverEmergenciesPageSchema = z
  .object({
    items: z.array(caregiverEmergencySchema).max(100),
    pageInfo: pageInfoSchema,
  })
  .strict();

export const elderEmergencyStatusSchema = z
  .object({
    id: uuidSchema,
    status: emergencyStatusSchema,
    openedAt: isoTimestampSchema,
    humanResponseStartedAt: nullableTimestampSchema,
    assistanceMessage: displayTextSchema,
    fallbackPhoneNumber: z.string().trim().min(3).max(32),
  })
  .strict();

export const familyEmergencySummarySchema = z
  .object({
    id: uuidSchema,
    emergencyEventId: uuidSchema,
    elderId: uuidSchema,
    elderDisplayName: displayTextSchema,
    stage: emergencyFamilyStageSchema,
    title: displayTextSchema,
    summary: boundedSummarySchema,
    publishedAt: isoTimestampSchema,
  })
  .strict();

export const familyEmergencySummariesPageSchema = z
  .object({
    items: z.array(familyEmergencySummarySchema).max(100),
    pageInfo: pageInfoSchema,
  })
  .strict();

export const familyEmergencyNotificationPreferenceSchema = z
  .object({
    id: nullableUuidSchema,
    elderId: uuidSchema,
    enabled: z.boolean(),
    notifyOnOpened: z.boolean(),
    notifyOnResolved: z.boolean(),
    channel: emergencyNotificationChannelSchema,
    version: familyEmergencyPreferenceVersionSchema,
    updatedAt: nullableTimestampSchema,
  })
  .strict();

export const caregiverEmergencyAcknowledgeRequestSchema = emergencyAcknowledgeRequestSchema;
export const caregiverEmergencyMilestoneRequestSchema = emergencyMilestoneRequestSchema;
export const caregiverEmergencyResolveRequestSchema = emergencyResolveRequestSchema;
export const adminEmergencyAssignRequestSchema = emergencyAssignRequestSchema;
export const adminEmergencyResolveRequestSchema = emergencyResolveRequestSchema;
export const adminEmergencyReviewRequestSchema = emergencyReviewRequestSchema;
export const familyEmergencyNotificationPreferenceUpdateRequestSchema =
  familyEmergencyPreferenceUpdateRequestSchema;

export type EmergencyStatus = z.infer<typeof emergencyStatusSchema>;
export type EmergencySourceKind = z.infer<typeof emergencySourceKindSchema>;
export type EmergencyLocationState = z.infer<typeof emergencyLocationStateSchema>;
export type EmergencyResponderStatus = z.infer<typeof emergencyResponderStatusSchema>;
export type EmergencyMilestoneKind = z.infer<typeof emergencyMilestoneKindSchema>;
export type EmergencySlaStage = z.infer<typeof emergencySlaStageSchema>;
export type EmergencyEscalationStatus = z.infer<
  typeof emergencyEscalationStatusSchema
>;
export type EmergencyReviewKind = z.infer<typeof emergencyReviewKindSchema>;
export type EmergencyFamilyStage = z.infer<typeof emergencyFamilyStageSchema>;
export type EmergencyNotificationChannel = z.infer<
  typeof emergencyNotificationChannelSchema
>;
export type EmergencyDeliveryStatus = z.infer<typeof emergencyDeliveryStatusSchema>;
export type ElderEmergencySignalRequest = z.infer<
  typeof elderEmergencySignalRequestSchema
>;
export type MqttEmergencySignalPayload = z.infer<
  typeof mqttEmergencySignalPayloadSchema
>;
export type EmergencyAssignRequest = z.infer<typeof emergencyAssignRequestSchema>;
export type EmergencyAcknowledgeRequest = z.infer<
  typeof emergencyAcknowledgeRequestSchema
>;
export type EmergencyMilestoneRequest = z.infer<typeof emergencyMilestoneRequestSchema>;
export type EmergencyResolveRequest = z.infer<typeof emergencyResolveRequestSchema>;
export type EmergencyReviewRequest = z.infer<typeof emergencyReviewRequestSchema>;
export type FamilyEmergencyPreferenceUpdateRequest = z.infer<
  typeof familyEmergencyPreferenceUpdateRequestSchema
>;
export type EmergencyAdminItem = z.infer<typeof emergencyAdminItemSchema>;
export type EmergencyAdminDetail = z.infer<typeof emergencyAdminDetailSchema>;
export type EmergencyAdminPage = z.infer<typeof emergencyAdminPageSchema>;
export type CaregiverEmergency = z.infer<typeof caregiverEmergencySchema>;
export type ElderEmergencyStatus = z.infer<typeof elderEmergencyStatusSchema>;
export type FamilyEmergencySummary = z.infer<typeof familyEmergencySummarySchema>;
export type FamilyEmergencyNotificationPreference = z.infer<
  typeof familyEmergencyNotificationPreferenceSchema
>;
