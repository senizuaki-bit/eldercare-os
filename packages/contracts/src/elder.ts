import { z } from 'zod';

import {
  dateOnlySchema,
  displayTextSchema,
  isoTimestampSchema,
  pageInfoSchema,
  recordCodeSchema,
  sortDirectionSchema,
  uuidSchema,
  versionSchema,
} from './common.js';

export const elderStatusSchema = z.enum(['ACTIVE', 'DISCHARGED', 'ARCHIVED']);
export const elderStayStatusSchema = z.enum(['PLANNED', 'ACTIVE', 'DISCHARGED', 'CANCELLED']);
export const familyRelationshipKindSchema = z.enum([
  'CHILD',
  'SPOUSE',
  'SIBLING',
  'GUARDIAN',
  'OTHER',
]);
export const familyRelationshipStatusSchema = z.enum(['PENDING', 'VERIFIED', 'REVOKED']);
export const familyShareableFieldSchema = z.enum([
  'PREFERRED_NAME',
  'CURRENT_RESIDENCE',
  'CARE_LEVEL',
  'ACCESSIBILITY_SUMMARY',
  'COMMUNICATION_PREFERENCE',
  'PERSONAL_BASELINE_SUMMARY',
  'CONSENT_SUMMARY',
  'TIMELINE_SUMMARY',
]);
export const personalBaselineSourceSchema = z.enum([
  'ELDER_STATED',
  'STAFF_CONFIRMED',
  'INFERRED',
]);
export const personalBaselineDomainSchema = z.enum([
  'ROUTINE',
  'COMMUNICATION',
  'MOBILITY',
  'SOCIAL',
  'SLEEP',
  'DIET',
  'EMOTIONAL_EXPRESSION',
  'OTHER',
]);
export const consentPurposeSchema = z.enum([
  'VOICE_CAPTURE',
  'TRANSCRIPTION_AI_ANALYSIS',
  'EMOTION_TREND',
  'ELDER_LOCATION',
  'CAREGIVER_SHIFT_LOCATION',
  'FAMILY_SHARING',
  'AI_MEMORY',
  'CONTENT_PERSONALIZATION',
  'COMMERCIAL_RECOMMENDATION',
  'FAMILY_PAYMENT',
  'PRODUCT_IMPROVEMENT_TRAINING',
]);
export const consentDecisionSchema = z.enum(['GRANTED', 'DECLINED', 'WITHDRAWN']);
export const consentAuthoritySchema = z.enum([
  'ELDER',
  'AUTHORIZED_REPRESENTATIVE',
  'LEGAL_BASIS',
]);
export const timelineVisibilitySchema = z.enum([
  'INTERNAL',
  'ELDER_VISIBLE',
  'FAMILY_ELIGIBLE',
]);

const optionalNoteSchema = z.string().trim().max(2000);
const preferredNameSchema = z.string().trim().min(1).max(80);
const safeScalarSchema = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);
const safeMetadataSchema = z.record(z.string().min(1).max(64), safeScalarSchema);
const queryBooleanSchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

export const elderCareLevelSummarySchema = z
  .object({ id: uuidSchema, code: recordCodeSchema, name: displayTextSchema, rank: z.number().int() })
  .strict();

export const elderResidenceSchema = z
  .object({
    stayId: uuidSchema,
    buildingId: uuidSchema,
    buildingName: displayTextSchema,
    floorId: uuidSchema,
    floorName: displayTextSchema,
    zoneId: uuidSchema.nullable(),
    zoneName: displayTextSchema.nullable(),
    roomId: uuidSchema,
    roomName: displayTextSchema,
    bedId: uuidSchema,
    bedLabel: displayTextSchema,
    admittedAt: isoTimestampSchema,
  })
  .strict();

export const elderListItemSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    recordNumber: recordCodeSchema,
    displayName: displayTextSchema,
    preferredName: preferredNameSchema.nullable(),
    status: elderStatusSchema,
    careLevel: elderCareLevelSummarySchema.nullable(),
    currentResidence: elderResidenceSchema.nullable(),
    version: versionSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const elderDetailSchema = elderListItemSchema
  .extend({
    portalUserId: uuidSchema.nullable(),
    createdAt: isoTimestampSchema,
  })
  .strict();

export const eldersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    status: elderStatusSchema.optional(),
    careLevelId: uuidSchema.optional(),
    buildingId: uuidSchema.optional(),
    floorId: uuidSchema.optional(),
    zoneId: uuidSchema.optional(),
    roomId: uuidSchema.optional(),
    bedId: uuidSchema.optional(),
    stayStatus: elderStayStatusSchema.optional(),
    sort: z
      .enum(['displayName', 'recordNumber', 'careLevel', 'admittedAt', 'updatedAt'])
      .default('displayName'),
    direction: sortDirectionSchema.default('asc'),
  })
  .strict();

export const eldersPageSchema = z
  .object({ items: z.array(elderListItemSchema), pageInfo: pageInfoSchema })
  .strict();

export const elderCreateRequestSchema = z
  .object({
    recordNumber: recordCodeSchema,
    displayName: displayTextSchema,
    preferredName: preferredNameSchema.optional(),
    birthDate: dateOnlySchema.optional(),
    portalUserId: uuidSchema.optional(),
    careLevelId: uuidSchema.optional(),
  })
  .strict();

export const elderUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    recordNumber: recordCodeSchema.optional(),
    displayName: displayTextSchema.optional(),
    preferredName: preferredNameSchema.nullable().optional(),
    birthDate: dateOnlySchema.nullable().optional(),
    portalUserId: uuidSchema.nullable().optional(),
    careLevelId: uuidSchema.nullable().optional(),
    status: elderStatusSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const elderStaySchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    bedId: uuidSchema,
    previousStayId: uuidSchema.nullable(),
    status: elderStayStatusSchema,
    admittedAt: isoTimestampSchema,
    dischargedAt: isoTimestampSchema.nullable(),
    admissionReasonCode: recordCodeSchema.nullable(),
    dischargeReasonCode: recordCodeSchema.nullable(),
    version: versionSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((stay, context) => {
    if (stay.dischargedAt !== null && Date.parse(stay.dischargedAt) <= Date.parse(stay.admittedAt)) {
      context.addIssue({ code: 'custom', path: ['dischargedAt'], message: 'must be after admittedAt' });
    }
    if (stay.status === 'ACTIVE' && stay.dischargedAt !== null) {
      context.addIssue({ code: 'custom', path: ['dischargedAt'], message: 'must be null for ACTIVE stay' });
    }
    if (stay.status === 'DISCHARGED' && stay.dischargedAt === null) {
      context.addIssue({ code: 'custom', path: ['dischargedAt'], message: 'is required for DISCHARGED stay' });
    }
  });

export const elderStaysPageSchema = z
  .object({ items: z.array(elderStaySchema), pageInfo: pageInfoSchema })
  .strict();

export const admitElderRequestSchema = z
  .object({
    expectedElderVersion: versionSchema,
    bedId: uuidSchema,
    admittedAt: isoTimestampSchema,
    admissionReasonCode: recordCodeSchema.optional(),
  })
  .strict();

export const transferElderStayRequestSchema = z
  .object({
    expectedStayVersion: versionSchema,
    targetBedId: uuidSchema,
    transferredAt: isoTimestampSchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const dischargeElderStayRequestSchema = z
  .object({
    expectedStayVersion: versionSchema,
    dischargedAt: isoTimestampSchema,
    reasonCode: recordCodeSchema,
  })
  .strict();

export const familySharingPreferenceSchema = z
  .object({
    field: familyShareableFieldSchema,
    allowed: z.boolean(),
    validFrom: isoTimestampSchema,
    validUntil: isoTimestampSchema.nullable(),
  })
  .strict()
  .refine(
    (preference) =>
      preference.validUntil === null ||
      Date.parse(preference.validUntil) > Date.parse(preference.validFrom),
    { path: ['validUntil'], message: 'must be after validFrom' },
  );

export const familyRelationshipSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    elderId: uuidSchema,
    familyUserId: uuidSchema,
    relationshipKind: familyRelationshipKindSchema,
    relationshipLabel: z.string().trim().max(80).nullable(),
    status: familyRelationshipStatusSchema,
    activeFrom: isoTimestampSchema,
    activeUntil: isoTimestampSchema.nullable(),
    verifiedAt: isoTimestampSchema.nullable(),
    revokedAt: isoTimestampSchema.nullable(),
    sharingPreferences: z.array(familySharingPreferenceSchema).max(32),
    version: versionSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((relationship, context) => {
    if (
      relationship.activeUntil !== null &&
      Date.parse(relationship.activeUntil) <= Date.parse(relationship.activeFrom)
    ) {
      context.addIssue({ code: 'custom', path: ['activeUntil'], message: 'must be after activeFrom' });
    }
    if (relationship.status === 'VERIFIED' && relationship.verifiedAt === null) {
      context.addIssue({ code: 'custom', path: ['verifiedAt'], message: 'is required when verified' });
    }
    if (relationship.status === 'REVOKED' && relationship.revokedAt === null) {
      context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'is required when revoked' });
    }
  });

export const familyRelationshipCreateRequestSchema = z
  .object({
    familyUserId: uuidSchema,
    relationshipKind: familyRelationshipKindSchema,
    relationshipLabel: z.string().trim().min(1).max(80).optional(),
    activeFrom: isoTimestampSchema,
    activeUntil: isoTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (relationship) =>
      relationship.activeUntil === undefined ||
      Date.parse(relationship.activeUntil) > Date.parse(relationship.activeFrom),
    { path: ['activeUntil'], message: 'must be after activeFrom' },
  );

export const familyRelationshipDecisionRequestSchema = z
  .object({ expectedVersion: versionSchema, reasonCode: recordCodeSchema.optional() })
  .strict();

export const sharingPreferencesUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    preferences: z.array(
      z
        .object({
          field: familyShareableFieldSchema,
          allowed: z.boolean(),
          validUntil: isoTimestampSchema.optional(),
        })
        .strict(),
    ).max(32),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, preference] of input.preferences.entries()) {
      if (seen.has(preference.field)) {
        context.addIssue({
          code: 'custom',
          path: ['preferences', index, 'field'],
          message: 'must be unique',
        });
      }
      seen.add(preference.field);
    }
  });

export const emergencyContactSchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    familyRelationshipId: uuidSchema.nullable(),
    displayName: displayTextSchema,
    relationshipLabel: z.string().trim().min(1).max(80),
    contactValue: z.string().trim().min(3).max(160),
    priority: z.number().int().min(1).max(20),
    isPrimary: z.boolean(),
    active: z.boolean(),
    version: versionSchema,
  })
  .strict();

export const emergencyContactCreateRequestSchema = z
  .object({
    familyRelationshipId: uuidSchema.optional(),
    displayName: displayTextSchema,
    relationshipLabel: z.string().trim().min(1).max(80),
    contactValue: z.string().trim().min(3).max(160),
    priority: z.number().int().min(1).max(20),
    isPrimary: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();

export const emergencyContactUpdateRequestSchema = emergencyContactSchema
  .omit({ id: true, elderId: true, version: true })
  .partial()
  .extend({ expectedVersion: versionSchema })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

export const accessibilityProfileSchema = z
  .object({
    elderId: uuidSchema,
    preferredTextScale: z.enum(['STANDARD', 'LARGE', 'EXTRA_LARGE']),
    highContrast: z.boolean(),
    reducedMotion: z.boolean(),
    hearingSupport: z.boolean(),
    visionSupport: z.boolean(),
    mobilitySupport: z.boolean(),
    preferredInputMode: z.enum(['TOUCH', 'VOICE', 'HUMAN_ASSISTED']),
    humanHandoffPreferred: z.boolean(),
    notes: optionalNoteSchema.nullable(),
    version: versionSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const accessibilityProfileUpdateRequestSchema = accessibilityProfileSchema
  .omit({ elderId: true, version: true, updatedAt: true })
  .partial()
  .extend({ expectedVersion: versionSchema })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  });

const quietTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const communicationPreferenceSchema = z
  .object({
    elderId: uuidSchema,
    preferredLanguage: z.string().trim().min(2).max(35),
    speakingPace: z.enum(['SLOW', 'STANDARD']),
    repeatKeyInformation: z.boolean(),
    preferredChannel: z.enum(['VOICE', 'TEXT', 'IN_PERSON']),
    quietHoursStart: quietTimeSchema.nullable(),
    quietHoursEnd: quietTimeSchema.nullable(),
    version: versionSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .refine(
    (profile) => (profile.quietHoursStart === null) === (profile.quietHoursEnd === null),
    { path: ['quietHoursEnd'], message: 'quiet hours must include both start and end' },
  );

export const communicationPreferenceUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    preferredLanguage: z.string().trim().min(2).max(35).optional(),
    speakingPace: z.enum(['SLOW', 'STANDARD']).optional(),
    repeatKeyInformation: z.boolean().optional(),
    preferredChannel: z.enum(['VOICE', 'TEXT', 'IN_PERSON']).optional(),
    quietHoursStart: quietTimeSchema.nullable().optional(),
    quietHoursEnd: quietTimeSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion'), {
    message: 'at least one mutable field is required',
  })
  .refine(
    (input) =>
      input.quietHoursStart === undefined ||
      input.quietHoursEnd === undefined ||
      (input.quietHoursStart === null) === (input.quietHoursEnd === null),
    { path: ['quietHoursEnd'], message: 'quiet hours must include both start and end' },
  );

const personalBaselineInputShape = {
  baselineKey: recordCodeSchema,
  domain: personalBaselineDomainSchema,
  value: z.string().trim().min(1).max(2000),
  sourceKind: personalBaselineSourceSchema,
  sourceUserId: uuidSchema.optional(),
  confirmedByStaffProfileId: uuidSchema.optional(),
  inferenceMethod: z.string().trim().min(1).max(160).optional(),
  confidence: z.number().min(0).max(1).optional(),
  observedAt: isoTimestampSchema,
  validFrom: isoTimestampSchema,
};

export const personalBaselineCreateRequestSchema = z
  .object(personalBaselineInputShape)
  .strict()
  .superRefine(validateBaselineSource);

export const personalBaselineSchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    ...personalBaselineInputShape,
    sourceUserId: uuidSchema.nullable(),
    confirmedByStaffProfileId: uuidSchema.nullable(),
    inferenceMethod: z.string().trim().min(1).max(160).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    supersededAt: isoTimestampSchema.nullable(),
    version: versionSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()
  .superRefine(validateBaselineSource);

export const personalBaselinesPageSchema = z
  .object({ items: z.array(personalBaselineSchema), pageInfo: pageInfoSchema })
  .strict();

export const consentRecordSchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    purpose: consentPurposeSchema,
    decision: consentDecisionSchema,
    authority: consentAuthoritySchema,
    consentVersion: versionSchema,
    effectiveAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema.nullable(),
    supersededAt: isoTimestampSchema.nullable(),
    reasonCode: recordCodeSchema.nullable(),
    recordedByUserId: uuidSchema,
    createdAt: isoTimestampSchema,
  })
  .strict()
  .refine(
    (consent) => consent.expiresAt === null || Date.parse(consent.expiresAt) > Date.parse(consent.effectiveAt),
    { path: ['expiresAt'], message: 'must be after effectiveAt' },
  );

export const consentRecordCreateRequestSchema = z
  .object({
    expectedElderVersion: versionSchema,
    purpose: consentPurposeSchema,
    decision: z.enum(['GRANTED', 'DECLINED']),
    authority: consentAuthoritySchema,
    effectiveAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema.optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine(
    (consent) =>
      consent.expiresAt === undefined || Date.parse(consent.expiresAt) > Date.parse(consent.effectiveAt),
    { path: ['expiresAt'], message: 'must be after effectiveAt' },
  );

export const consentWithdrawalRequestSchema = z
  .object({
    expectedConsentVersion: versionSchema,
    effectiveAt: isoTimestampSchema,
    authority: consentAuthoritySchema,
    reasonCode: recordCodeSchema.optional(),
  })
  .strict();

export const consentHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    purpose: consentPurposeSchema.optional(),
    decision: consentDecisionSchema.optional(),
    currentOnly: queryBooleanSchema.default(false),
    sort: z.enum(['effectiveAt', 'purpose', 'createdAt']).default('effectiveAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .strict();

export const consentHistoryPageSchema = z
  .object({ items: z.array(consentRecordSchema), pageInfo: pageInfoSchema })
  .strict();

export const elderTimelineEntrySchema = z
  .object({
    id: uuidSchema,
    elderId: uuidSchema,
    eventType: recordCodeSchema,
    sourceResourceType: recordCodeSchema,
    sourceResourceId: z.string().min(1).max(128),
    visibility: timelineVisibilitySchema,
    safeSummaryCode: recordCodeSchema,
    safeMetadata: safeMetadataSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict();

export const elderTimelineQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    eventType: recordCodeSchema.optional(),
    visibility: timelineVisibilitySchema.optional(),
    occurredFrom: isoTimestampSchema.optional(),
    occurredTo: isoTimestampSchema.optional(),
    direction: sortDirectionSchema.default('desc'),
  })
  .strict()
  .refine(
    (query) =>
      query.occurredFrom === undefined ||
      query.occurredTo === undefined ||
      Date.parse(query.occurredTo) >= Date.parse(query.occurredFrom),
    { path: ['occurredTo'], message: 'must not be before occurredFrom' },
  );

export const elderTimelinePageSchema = z
  .object({ items: z.array(elderTimelineEntrySchema), pageInfo: pageInfoSchema })
  .strict();

export const elderSensitiveDetailSchema = z
  .object({
    elderId: uuidSchema,
    birthDate: dateOnlySchema.nullable(),
    emergencyContacts: z.array(emergencyContactSchema).max(20),
    accessibilityProfile: accessibilityProfileSchema.nullable(),
    communicationPreference: communicationPreferenceSchema.nullable(),
    personalBaselines: z.array(personalBaselineSchema).max(100),
    currentConsents: z.array(consentRecordSchema).max(64),
  })
  .strict();

export const familyElderSummarySchema = z
  .object({
    id: uuidSchema,
    displayName: displayTextSchema,
    preferredName: preferredNameSchema.nullable().optional(),
    currentResidence: elderResidenceSchema.nullable().optional(),
    careLevel: elderCareLevelSummarySchema.nullable().optional(),
    accessibilitySummary: z
      .object({
        preferredTextScale: z.enum(['STANDARD', 'LARGE', 'EXTRA_LARGE']),
        hearingSupport: z.boolean(),
        visionSupport: z.boolean(),
        mobilitySupport: z.boolean(),
      })
      .strict()
      .optional(),
    communicationPreference: z
      .object({
        preferredLanguage: z.string().trim().min(2).max(35),
        speakingPace: z.enum(['SLOW', 'STANDARD']),
        repeatKeyInformation: z.boolean(),
        preferredChannel: z.enum(['VOICE', 'TEXT', 'IN_PERSON']),
        quietHoursStart: quietTimeSchema.nullable(),
        quietHoursEnd: quietTimeSchema.nullable(),
      })
      .strict()
      .optional(),
    personalBaselineSummary: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
    consentSummary: z.array(
      z.object({ purpose: consentPurposeSchema, active: z.boolean() }).strict(),
    ).max(32).optional(),
    timelineSummary: z.array(
      elderTimelineEntrySchema.pick({ id: true, eventType: true, safeSummaryCode: true, occurredAt: true }),
    ).max(20).optional(),
    sharedFields: z.array(familyShareableFieldSchema).max(32),
  })
  .strict()
  .superRefine((summary, context) => {
    const shared = new Set(summary.sharedFields);
    if (shared.size !== summary.sharedFields.length) {
      context.addIssue({ code: 'custom', path: ['sharedFields'], message: 'must be unique' });
    }
    const mappedFields = [
      ['PREFERRED_NAME', 'preferredName'],
      ['CURRENT_RESIDENCE', 'currentResidence'],
      ['CARE_LEVEL', 'careLevel'],
      ['ACCESSIBILITY_SUMMARY', 'accessibilitySummary'],
      ['COMMUNICATION_PREFERENCE', 'communicationPreference'],
      ['PERSONAL_BASELINE_SUMMARY', 'personalBaselineSummary'],
      ['CONSENT_SUMMARY', 'consentSummary'],
      ['TIMELINE_SUMMARY', 'timelineSummary'],
    ] as const;
    for (const [field, property] of mappedFields) {
      if (summary[property] !== undefined && !shared.has(field)) {
        context.addIssue({
          code: 'custom',
          path: [property],
          message: `requires ${field} in sharedFields`,
        });
      }
    }
  });

export const familyEldersPageSchema = z
  .object({ items: z.array(familyElderSummarySchema), pageInfo: pageInfoSchema })
  .strict();

export const caregiverElderSummarySchema = z
  .object({
    id: uuidSchema,
    displayName: displayTextSchema,
    preferredName: preferredNameSchema.nullable(),
    currentResidence: elderResidenceSchema,
    careLevel: elderCareLevelSummarySchema.nullable(),
    accessibilitySummary: z
      .object({
        hearingSupport: z.boolean(),
        visionSupport: z.boolean(),
        mobilitySupport: z.boolean(),
        preferredInputMode: z.enum(['TOUCH', 'VOICE', 'HUMAN_ASSISTED']),
      })
      .strict()
      .nullable(),
    operationalAttention: z.array(z.string().trim().min(1).max(240)).max(16),
    shiftAssignmentId: uuidSchema,
  })
  .strict();

export const caregiverEldersPageSchema = z
  .object({ items: z.array(caregiverElderSummarySchema), pageInfo: pageInfoSchema })
  .strict();

function validateBaselineSource(
  baseline: {
    sourceKind: z.infer<typeof personalBaselineSourceSchema>;
    sourceUserId?: string | null;
    confirmedByStaffProfileId?: string | null;
    inferenceMethod?: string | null;
    confidence?: number | null;
  },
  context: z.RefinementCtx,
): void {
  if (baseline.sourceKind === 'ELDER_STATED') {
    if (baseline.sourceUserId == null) {
      context.addIssue({ code: 'custom', path: ['sourceUserId'], message: 'is required' });
    }
    if (baseline.confirmedByStaffProfileId != null || baseline.inferenceMethod != null || baseline.confidence != null) {
      context.addIssue({ code: 'custom', message: 'ELDER_STATED cannot include staff or inference fields' });
    }
  }
  if (baseline.sourceKind === 'STAFF_CONFIRMED') {
    if (baseline.confirmedByStaffProfileId == null) {
      context.addIssue({ code: 'custom', path: ['confirmedByStaffProfileId'], message: 'is required' });
    }
    if (baseline.inferenceMethod != null || baseline.confidence != null) {
      context.addIssue({ code: 'custom', message: 'STAFF_CONFIRMED cannot include inference fields' });
    }
  }
  if (baseline.sourceKind === 'INFERRED') {
    if (baseline.inferenceMethod == null) {
      context.addIssue({ code: 'custom', path: ['inferenceMethod'], message: 'is required' });
    }
    if (baseline.confidence == null) {
      context.addIssue({ code: 'custom', path: ['confidence'], message: 'is required' });
    }
  }
}

export type ElderStatus = z.infer<typeof elderStatusSchema>;
export type ElderStayStatus = z.infer<typeof elderStayStatusSchema>;
export type ElderListItem = z.infer<typeof elderListItemSchema>;
export type ElderDetail = z.infer<typeof elderDetailSchema>;
export type EldersQuery = z.output<typeof eldersQuerySchema>;
export type EldersPage = z.infer<typeof eldersPageSchema>;
export type ElderCreateRequest = z.infer<typeof elderCreateRequestSchema>;
export type ElderUpdateRequest = z.infer<typeof elderUpdateRequestSchema>;
export type ElderStay = z.infer<typeof elderStaySchema>;
export type AdmitElderRequest = z.infer<typeof admitElderRequestSchema>;
export type TransferElderStayRequest = z.infer<typeof transferElderStayRequestSchema>;
export type DischargeElderStayRequest = z.infer<typeof dischargeElderStayRequestSchema>;
export type FamilyRelationship = z.infer<typeof familyRelationshipSchema>;
export type FamilyRelationshipCreateRequest = z.infer<typeof familyRelationshipCreateRequestSchema>;
export type SharingPreferencesUpdateRequest = z.infer<typeof sharingPreferencesUpdateRequestSchema>;
export type AccessibilityProfile = z.infer<typeof accessibilityProfileSchema>;
export type CommunicationPreference = z.infer<typeof communicationPreferenceSchema>;
export type PersonalBaselineSource = z.infer<typeof personalBaselineSourceSchema>;
export type PersonalBaseline = z.infer<typeof personalBaselineSchema>;
export type PersonalBaselineCreateRequest = z.infer<typeof personalBaselineCreateRequestSchema>;
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type ConsentRecordCreateRequest = z.infer<typeof consentRecordCreateRequestSchema>;
export type ElderTimelineEntry = z.infer<typeof elderTimelineEntrySchema>;
export type FamilyElderSummary = z.infer<typeof familyElderSummarySchema>;
export type CaregiverElderSummary = z.infer<typeof caregiverElderSummarySchema>;
