import {
  aiAnalysisSchema,
  completionChecklistSnapshotSchema,
  needAnalysisOutputSchema,
  type AIAnalysis,
  type FamilySummary,
  type Need,
  type Rating,
  type TranscriptMetadata,
  type VoiceSubmission,
  type WorkOrder,
  type WorkOrderArrival,
  type WorkOrderAssignment,
  type WorkOrderDetail,
  type WorkOrderTransition,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { voiceConsentFailureCode } from './voice-consent.js';

export const WORK_ORDER_INCLUDE = {
  assignments: {
    include: { assignee: { include: { user: true } }, targetTeam: true },
    orderBy: [{ assignedAt: 'desc' as const }, { id: 'desc' as const }],
  },
  primaryNeed: { include: { aiAnalysis: true } },
  transitions: { orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }] },
  arrivals: { orderBy: [{ arrivedAt: 'asc' as const }, { id: 'asc' as const }] },
  completion: true,
  familySummary: true,
  ratings: { orderBy: { createdAt: 'desc' as const } },
  elder: {
    include: {
      consentRecords: {
        where: {
          purpose: { in: ['VOICE_CAPTURE' as const, 'TRANSCRIPTION_AI_ANALYSIS' as const] },
          supersededAt: null,
        },
        orderBy: [{ purpose: 'asc' as const }, { consentVersion: 'desc' as const }],
        select: {
          purpose: true,
          decision: true,
          consentVersion: true,
          effectiveAt: true,
          expiresAt: true,
        },
      },
      stays: {
        where: { status: 'ACTIVE' as const },
        orderBy: { admittedAt: 'desc' as const },
        take: 1,
        include: {
          bed: {
            include: { room: { include: { floor: { include: { building: true } } } } },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkOrderInclude;

export const NEED_INCLUDE = {
  elder: {
    include: {
      stays: {
        where: { status: 'ACTIVE' as const },
        orderBy: { admittedAt: 'desc' as const },
        take: 1,
        include: {
          bed: {
            include: { room: { include: { floor: { include: { building: true } } } } },
          },
        },
      },
    },
  },
} satisfies Prisma.NeedInclude;

export type WorkOrderRecord = Prisma.WorkOrderGetPayload<{ include: typeof WORK_ORDER_INCLUDE }>;
export type NeedRecord = Prisma.NeedGetPayload<{ include: typeof NEED_INCLUDE }>;

export function mapVoiceSubmission(record: Prisma.VoiceSubmissionGetPayload<Record<string, never>>): VoiceSubmission {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    workOrderId: record.workOrderId,
    submittedByUserId: record.submittedByUserId,
    purpose: record.purpose,
    status: record.status,
    mimeType: record.mimeType as VoiceSubmission['mimeType'],
    sizeBytes: record.actualSizeBytes ?? record.declaredSizeBytes,
    checksumSha256: record.checksumSha256,
    fixtureKey: record.fixtureKey as VoiceSubmission['fixtureKey'],
    failureCode: record.failureCode,
    uploadedAt: iso(record.uploadedAt),
    completedAt: iso(record.completedAt),
    retentionUntil: record.retentionUntil.toISOString(),
    correlationId: record.correlationId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapTranscriptMetadata(record: Prisma.TranscriptGetPayload<Record<string, never>>): TranscriptMetadata {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    voiceSubmissionId: record.voiceSubmissionId,
    status: record.status,
    confidence: record.confidence,
    durationMs: record.durationMs,
    provider: record.provider,
    model: record.model,
    providerVersion: record.providerVersion,
    failureCode: record.failureCode,
    retentionUntil: record.retentionUntil.toISOString(),
    correlationId: record.correlationId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    completedAt: iso(record.completedAt),
  };
}

export function mapAnalysis(record: Prisma.AIAnalysisGetPayload<Record<string, never>>): AIAnalysis {
  const output = record.output === null ? null : needAnalysisOutputSchema.parse(record.output);
  const evidence = stringArray(record.evidence);
  return aiAnalysisSchema.parse({
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    transcriptId: record.transcriptId,
    status: record.status,
    output,
    confidence: record.confidence,
    evidence,
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    schemaVersion: record.schemaVersion,
    failureCode: record.failureCode,
    retentionUntil: record.retentionUntil.toISOString(),
    contentDeletedAt: iso(record.contentDeletedAt),
    correlationId: record.correlationId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    completedAt: iso(record.completedAt),
  });
}

/**
 * Sensitive AI content must stop appearing as soon as its retention window
 * closes, even when the cleanup worker has not yet redacted the database row.
 */
export function mapRetainedAnalysis(
  record: Prisma.AIAnalysisGetPayload<Record<string, never>> | null,
  now: Date = new Date(),
): AIAnalysis | null {
  if (
    record === null ||
    record.contentDeletedAt !== null ||
    record.retentionUntil.getTime() <= now.getTime()
  ) {
    return null;
  }
  return mapAnalysis(record);
}

export function mapNeed(record: Prisma.NeedGetPayload<Record<string, never>>): Need {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    voiceSubmissionId: record.voiceSubmissionId,
    aiAnalysisId: record.aiAnalysisId,
    source: record.source,
    summary: record.summary,
    category: record.category,
    urgencySuggestion: record.urgencySuggestion,
    priority: record.priority,
    requiresHumanReview: record.requiresHumanReview,
    safetyRuleCodes: stringArray(record.safetyRuleCodes),
    status: record.status,
    reviewedByUserId: record.reviewedByUserId,
    reviewedAt: iso(record.reviewedAt),
    reviewReasonCode: record.reviewReasonCode,
    correlationId: record.correlationId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapNeedWithElder(record: NeedRecord): Need & { elder: ReturnType<typeof mapElderProjection> } {
  return { ...mapNeed(record), elder: mapElderProjection(record.elder) };
}

export function mapAssignment(record: WorkOrderRecord['assignments'][number]): WorkOrderAssignment {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    workOrderId: record.workOrderId,
    targetTeamId: record.targetTeamId,
    assigneeStaffProfileId: record.assigneeStaffProfileId,
    shiftAssignmentId: record.shiftAssignmentId,
    status: record.status,
    assignedByUserId: record.assignedByUserId,
    assignedAt: record.assignedAt.toISOString(),
    claimedAt: iso(record.claimedAt),
    releasedAt: iso(record.releasedAt),
    reasonCode: record.reasonCode,
    version: record.version,
  };
}

export function mapTransition(record: WorkOrderRecord['transitions'][number]): WorkOrderTransition {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    workOrderId: record.workOrderId,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    fromVersion: record.fromVersion,
    toVersion: record.toVersion,
    actorUserId: record.actorUserId,
    reasonCode: record.reasonCode,
    correlationId: record.correlationId,
    occurredAt: record.occurredAt.toISOString(),
  };
}

export function mapArrival(record: WorkOrderRecord['arrivals'][number]): WorkOrderArrival {
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    workOrderId: record.workOrderId,
    actorUserId: record.actorUserId,
    fromVersion: record.fromVersion,
    toVersion: record.toVersion,
    reasonCode: record.reasonCode,
    arrivedAt: record.arrivedAt.toISOString(),
    correlationId: record.correlationId,
  };
}

export function mapWorkOrder(record: WorkOrderRecord): WorkOrder {
  const current = record.assignments.find((assignment) => ['OFFERED', 'CLAIMED'].includes(assignment.status));
  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    primaryNeedId: record.primaryNeedId,
    code: record.code,
    title: record.title,
    summary: record.summary,
    priority: record.priority,
    status: record.status,
    dueAt: record.dueAt.toISOString(),
    acceptedAt: iso(record.acceptedAt),
    arrivedAt: iso(record.arrivedAt),
    startedAt: iso(record.startedAt),
    completedAt: iso(record.completedAt),
    verifiedAt: iso(record.verifiedAt),
    closedAt: iso(record.closedAt),
    cancelledAt: iso(record.cancelledAt),
    currentAssignment: current === undefined ? null : mapAssignment(current),
    correlationId: record.correlationId,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapWorkOrderWithProjections(record: WorkOrderRecord): WorkOrder & {
  elder: ReturnType<typeof mapElderProjection>;
  assignee?: ReturnType<typeof mapAssigneeProjection>;
} {
  const base = mapWorkOrder(record);
  const current = record.assignments.find((assignment) => ['OFFERED', 'CLAIMED'].includes(assignment.status));
  const assignee = current?.assignee === null || current?.assignee === undefined
    ? undefined
    : mapAssigneeProjection(current.assignee);
  return {
    ...base,
    elder: mapElderProjection(record.elder),
    ...(assignee === undefined ? {} : { assignee }),
  };
}

export function mapWorkOrderDetail(
  record: WorkOrderRecord,
  linkedNeeds: readonly Prisma.NeedGetPayload<Record<string, never>>[],
): WorkOrderDetail & Record<string, unknown> {
  const current = record.assignments.find((assignment) => ['OFFERED', 'CLAIMED'].includes(assignment.status));
  const now = new Date();
  const analysis = voiceConsentFailureCode(record.elder.consentRecords, now) === null
    ? mapRetainedAnalysis(record.primaryNeed.aiAnalysis, now)
    : null;
  return {
    ...mapWorkOrder(record),
    need: mapNeed(record.primaryNeed),
    linkedNeeds: linkedNeeds.map(mapNeed),
    assignments: record.assignments.map(mapAssignment),
    transitions: record.transitions.map(mapTransition),
    arrivals: record.arrivals.map(mapArrival),
    completion: record.completion === null
      ? null
      : {
          id: record.completion.id,
          organizationId: record.completion.organizationId,
          facilityId: record.completion.facilityId,
          elderId: record.completion.elderId,
          workOrderId: record.completion.workOrderId,
          submittedByStaffProfileId: record.completion.submittedByStaffProfileId,
          noteSource: record.completion.noteSource,
          noteText: record.completion.noteText,
          voiceSubmissionId: record.completion.voiceSubmissionId,
          confirmedAt: record.completion.confirmedAt.toISOString(),
          completionChecklist: completionChecklistSnapshotSchema.parse(
            record.completion.completionChecklist,
          ),
          checklistConfirmedAt: iso(record.completion.checklistConfirmedAt),
          correlationId: record.completion.correlationId,
          version: record.completion.version,
          createdAt: record.completion.createdAt.toISOString(),
        },
    elder: mapElderProjection(record.elder),
    ...(current?.assignee === null || current?.assignee === undefined
      ? {}
      : { assignee: mapAssigneeProjection(current.assignee) }),
    analysis,
    ruleResults: ruleResults(stringArray(record.primaryNeed.safetyRuleCodes)),
    familySummary: record.familySummary === null ? null : mapFamilySummary(record.familySummary),
  };
}

export function mapFamilySummary(record: Prisma.FamilySummaryGetPayload<Record<string, never>>): FamilySummary {
  return {
    id: record.id,
    elderId: record.elderId,
    workOrderId: record.workOrderId,
    status: record.status,
    title: record.title,
    summary: record.summary,
    serviceCompletedAt: record.serviceCompletedAt.toISOString(),
    publishedAt: iso(record.publishedAt),
    version: record.version,
  };
}

export function mapRating(record: Prisma.RatingGetPayload<Record<string, never>>): Rating {
  return {
    id: record.id,
    elderId: record.elderId,
    workOrderId: record.workOrderId,
    actorType: record.actorType,
    score: record.score,
    comment: record.comment,
    requiresFollowUp: record.requiresFollowUp,
    createdAt: record.createdAt.toISOString(),
  };
}

export function mapElderProjection(record: NeedRecord['elder'] | WorkOrderRecord['elder']) {
  const stay = record.stays[0];
  return {
    id: record.id,
    displayName: record.displayName,
    preferredName: record.preferredName,
    recordNumber: record.recordNumber,
    roomLabel: stay === undefined
      ? null
      : `${stay.bed.room.floor.building.name} · ${stay.bed.room.floor.name} · ${stay.bed.room.name} · ${stay.bed.label}`,
  };
}

function mapAssigneeProjection(record: NonNullable<WorkOrderRecord['assignments'][number]['assignee']>) {
  return {
    staffProfileId: record.id,
    displayName: record.user.displayName,
    jobTitle: record.jobTitle,
  };
}

function ruleResults(codes: readonly string[]) {
  return codes.map((code) => {
    if (code.includes('HEALTH') || code.includes('DIZZINESS')) {
      return {
        code,
        label: '健康关注需人工查看',
        explanation: '确定性规则要求工作人员优先查看；AI 没有作出诊断或紧急结论。',
        severity: 'WARNING' as const,
      };
    }
    if (code.includes('EMERGENCY')) {
      return {
        code,
        label: '需进入确定性紧急规则复核',
        explanation: '该标记只要求立即人工复核，不代表 AI 已判定紧急事件。',
        severity: 'CRITICAL' as const,
      };
    }
    return { code, label: '规则记录', explanation: '该规则参与了最终优先级判断。', severity: 'INFO' as const };
  });
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
