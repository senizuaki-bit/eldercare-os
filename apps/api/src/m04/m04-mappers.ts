import type {
  EmergencyAdminDetail,
  EmergencyAdminItem,
  FamilyEmergencySummary,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';
import { EMERGENCY_RESOLUTION_CHECKLIST_CODES } from './emergency-resolution-checklist.js';

export const EMERGENCY_DETAIL_INCLUDE = {
  elder: {
    include: {
      stays: {
        where: { status: 'ACTIVE' as const },
        orderBy: { admittedAt: 'desc' as const },
        take: 1,
        include: {
          bed: {
            include: {
              room: {
                include: {
                  floor: { include: { building: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  signals: {
    orderBy: [{ receivedAt: 'asc' as const }, { id: 'asc' as const }],
  },
  locationSnapshot: true,
  transitions: {
    include: { actor: true },
    orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }],
  },
  primaryRelatedEvents: {
    include: {
      relatedEvent: {
        select: {
          id: true,
          status: true,
          reasonCode: true,
          openedAt: true,
          version: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  linkedRelatedEvents: {
    include: {
      primaryEvent: {
        select: {
          id: true,
          status: true,
          reasonCode: true,
          openedAt: true,
          version: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  acknowledgement: {
    include: {
      staffProfile: { include: { user: true } },
    },
  },
  responders: {
    include: {
      staffProfile: { include: { user: true } },
    },
    orderBy: [{ assignedAt: 'asc' as const }, { id: 'asc' as const }],
  },
  milestones: {
    include: {
      staffProfile: { include: { user: true } },
    },
    orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }],
  },
  escalations: {
    include: { escalationStep: true },
    orderBy: [{ dueAt: 'asc' as const }, { id: 'asc' as const }],
  },
  resolution: { include: { resolvedBy: true } },
  review: { include: { reviewedBy: true } },
  familySummaries: {
    orderBy: [{ publishedAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.EmergencyEventInclude;

export type EmergencyEventRecord = Prisma.EmergencyEventGetPayload<{
  include: typeof EMERGENCY_DETAIL_INCLUDE;
}>;

export function mapEmergencyListItem(
  record: EmergencyEventRecord,
  now: Date = new Date(),
): EmergencyAdminItem {
  const currentResponder =
    record.responders.find((item) => item.status === 'ACKNOWLEDGED') ??
    record.responders.find((item) => item.status === 'ASSIGNED') ??
    record.responders.find((item) => item.status === 'OFFERED');
  const nextSla = record.escalations.find(
    (item) => item.status === 'SCHEDULED' && item.dueAt.getTime() > now.getTime(),
  );

  return {
    id: record.id,
    organizationId: record.organizationId,
    facilityId: record.facilityId,
    elderId: record.elderId,
    elder: mapEmergencyElder(record.elder),
    sourceKind: record.sourceKind,
    reasonCode: record.reasonCode,
    status: record.status,
    version: record.version,
    openedAt: record.openedAt.toISOString(),
    acknowledgedAt: iso(record.acknowledgedAt),
    respondingAt: iso(record.respondingAt),
    onSiteAt: iso(record.onSiteAt),
    resolvedAt: iso(record.resolvedAt),
    reviewedAt: iso(record.reviewedAt),
    currentDeadlineAt: iso(record.currentDeadlineAt),
    location: mapEmergencyLocation(record.locationSnapshot, record.elder, now),
    currentResponder:
      currentResponder === undefined ? null : mapEmergencyResponder(currentResponder),
    activeSla:
      nextSla === undefined
        ? null
        : {
            stage: nextSla.stage,
            dueAt: nextSla.dueAt.toISOString(),
            status: nextSla.status,
          },
    escalationCount: record.escalations.filter(
      (item) => item.status === 'TRIGGERED',
    ).length,
    correlationId: record.correlationId,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function mapEmergencyDetail(
  record: EmergencyEventRecord,
  now: Date = new Date(),
): EmergencyAdminDetail {
  return {
    ...mapEmergencyListItem(record, now),
    acknowledgement:
      record.acknowledgement === null
        ? null
        : {
            staffProfileId: record.acknowledgement.staffProfileId,
            actorLabel: record.acknowledgement.staffProfile.user.displayName,
            clientObservedAt: iso(record.acknowledgement.clientObservedAt),
            acknowledgedAt:
              record.acknowledgement.acknowledgedAt.toISOString(),
          },
    responders: record.responders.map(mapEmergencyResponder),
    milestones: record.milestones.map((milestone) => ({
      id: milestone.id,
      kind: milestone.kind,
      staffProfileId: milestone.staffProfileId,
      actorLabel: milestone.staffProfile.user.displayName,
      clientObservedAt: iso(milestone.clientObservedAt),
      occurredAt: milestone.occurredAt.toISOString(),
    })),
    escalations: record.escalations.map((escalation) => ({
      id: escalation.id,
      stage: escalation.stage,
      status: escalation.status,
      dueAt: escalation.dueAt.toISOString(),
      triggeredAt: iso(escalation.triggeredAt),
    })),
    transitions: record.transitions.map((transition) => ({
      id: transition.id,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      fromVersion: transition.fromVersion,
      toVersion: transition.toVersion,
      actorType: transition.actorType,
      actorLabel: transition.actor?.displayName ?? null,
      reasonCode: transition.reasonCode,
      occurredAt: transition.occurredAt.toISOString(),
    })),
    relatedEvents: [
      ...record.primaryRelatedEvents.map((link) =>
        mapRelatedEmergency(link.relatedEvent),
      ),
      ...record.linkedRelatedEvents.map((link) =>
        mapRelatedEmergency(link.primaryEvent),
      ),
    ],
    resolution:
      record.resolution === null
        ? null
        : {
            resolvedByLabel: record.resolution.resolvedBy.displayName,
            summary: record.resolution.summary,
            outcomeCode: record.resolution.outcomeCode,
            familyNotify: record.resolution.familyNotify,
            completionChecklist: resolutionChecklist(
              record.resolution.completionChecklist,
            ),
            resolvedAt: record.resolution.resolvedAt.toISOString(),
          },
    review:
      record.review === null
        ? null
        : {
            reviewedByLabel: record.review.reviewedBy.displayName,
            kind: record.review.kind,
            summary: record.review.summary,
            waiverReasonCode: record.review.waiverReasonCode,
            reviewedAt: record.review.reviewedAt.toISOString(),
          },
    requiredResolutionChecklistCodes: [
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
    ],
  };
}

export function mapFamilyEmergencySummary(
  summary: EmergencyEventRecord['familySummaries'][number],
  elderDisplayName: string,
): FamilyEmergencySummary {
  return {
    id: summary.id,
    emergencyEventId: summary.emergencyEventId,
    elderId: summary.elderId,
    elderDisplayName,
    stage: summary.stage,
    title: summary.title,
    summary: summary.summary,
    publishedAt: summary.publishedAt.toISOString(),
  };
}

function mapEmergencyResponder(
  responder: EmergencyEventRecord['responders'][number],
) {
  return {
    id: responder.id,
    staffProfileId: responder.staffProfileId,
    displayName: responder.staffProfile.user.displayName,
    jobTitle: responder.staffProfile.jobTitle,
    status: responder.status,
    isEmergencyElevation: responder.isEmergencyElevation,
    elevationExpiresAt: iso(responder.elevationExpiresAt),
    assignedAt: responder.assignedAt.toISOString(),
    acknowledgedAt: iso(responder.acknowledgedAt),
  };
}

function mapEmergencyElder(record: EmergencyEventRecord['elder']) {
  return {
    id: record.id,
    displayName: record.displayName,
    preferredName: record.preferredName,
    roomLabel: roomLabel(record.stays[0]),
  };
}

function mapEmergencyLocation(
  snapshot: EmergencyEventRecord['locationSnapshot'],
  elder: EmergencyEventRecord['elder'],
  now: Date,
) {
  const fallbackRoom = roomLabel(elder.stays[0]);
  if (snapshot === null) {
    return {
      state: 'UNKNOWN' as const,
      source: 'NONE',
      label: '尚未收到有效位置，请人工确认',
      observedAt: null,
      expiresAt: null,
      accuracyMeters: null,
      fallbackReasonCode: 'LOCATION_UNAVAILABLE',
    };
  }

  const state =
    snapshot.state === 'CURRENT' &&
    snapshot.expiresAt !== null &&
    snapshot.expiresAt.getTime() <= now.getTime()
      ? ('STALE' as const)
      : snapshot.state;
  const label =
    state === 'CURRENT'
      ? fallbackRoom ?? '已取得当前区域位置'
      : state === 'STALE'
        ? '位置已过期，请核对房间并人工确认'
        : state === 'ROOM_FALLBACK'
          ? fallbackRoom === null
            ? '实时位置不可用，请人工确认'
            : `${fallbackRoom}（房间信息，非实时位置）`
          : '位置未知，请人工确认';

  return {
    state,
    source: snapshot.source,
    label,
    observedAt: iso(snapshot.observedAt),
    expiresAt: iso(snapshot.expiresAt),
    accuracyMeters:
      state !== 'CURRENT' || snapshot.accuracyMeters === null
        ? null
        : Number(snapshot.accuracyMeters.toString()),
    fallbackReasonCode: snapshot.fallbackReasonCode,
  };
}

function mapRelatedEmergency(
  record:
    | EmergencyEventRecord['primaryRelatedEvents'][number]['relatedEvent']
    | EmergencyEventRecord['linkedRelatedEvents'][number]['primaryEvent'],
) {
  return {
    id: record.id,
    status: record.status,
    reasonCode: record.reasonCode,
    openedAt: record.openedAt.toISOString(),
  };
}

function roomLabel(
  stay: EmergencyEventRecord['elder']['stays'][number] | undefined,
): string | null {
  if (stay === undefined) return null;
  return [
    stay.bed.room.floor.building.name,
    stay.bed.room.floor.name,
    stay.bed.room.name,
    stay.bed.label,
  ].join(' · ');
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function resolutionChecklist(
  value: Prisma.JsonValue,
): (typeof EMERGENCY_RESOLUTION_CHECKLIST_CODES)[number][] {
  const raw =
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    Array.isArray(value['expectedCodes'])
      ? value['expectedCodes']
      : Array.isArray(value)
        ? value
        : [];
  return raw.filter(
    (
      item,
    ): item is (typeof EMERGENCY_RESOLUTION_CHECKLIST_CODES)[number] =>
      typeof item === 'string' &&
      EMERGENCY_RESOLUTION_CHECKLIST_CODES.includes(
        item as (typeof EMERGENCY_RESOLUTION_CHECKLIST_CODES)[number],
      ),
  );
}
