import {
  caregiverEmergenciesPageSchema,
  caregiverEmergencyAcknowledgeRequestSchema,
  caregiverEmergencyMilestoneRequestSchema,
  caregiverEmergencyResolveRequestSchema,
  caregiverEmergencySchema,
  elderEmergencySignalRequestSchema,
  elderEmergencyStatusSchema,
  familyEmergencyNotificationPreferenceSchema,
  familyEmergencyNotificationPreferenceUpdateRequestSchema,
  familyEmergencySummariesPageSchema,
  type CaregiverEmergency,
  type ElderEmergencyStatus,
  type EmergencyMilestoneKind,
  type EmergencyStatus,
  type FamilyEmergencyNotificationPreference,
  type FamilyEmergencySummary
} from '@eldercare/contracts';

import { MobileCareRequestError } from './m03-client';

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000'
).replace(/\/$/, '');
const CSRF_COOKIE_NAMES = ['__Host-eldercare_csrf', 'eldercare_csrf'] as const;

type JsonRecord = Record<string, unknown>;
type CaregiverEmergencyAction = 'acknowledge' | 'en-route' | 'on-site';

export type MobileEmergencyStatus = EmergencyStatus;
export type MobileEmergencyLocation = CaregiverEmergency['location'];
export type FamilyEmergencySummaryView = FamilyEmergencySummary;

export interface MobileEmergencyView {
  readonly acknowledgedAt: string | null;
  readonly assignedToMe: boolean;
  readonly currentDeadlineAt: string | null;
  readonly elderDisplayName: string;
  readonly id: string;
  readonly location: CaregiverEmergency['location'];
  readonly milestones: readonly EmergencyMilestoneKind[];
  readonly onSiteAt: string | null;
  readonly openedAt: string;
  readonly reasonCode: string;
  readonly requiredResolutionChecklistCodes: readonly string[];
  readonly resolvedAt: string | null;
  readonly respondingAt: string | null;
  readonly sourceKind: CaregiverEmergency['sourceKind'];
  readonly status: EmergencyStatus;
  readonly version: number;
}

export interface FamilyEmergencyPreferenceView
  extends FamilyEmergencyNotificationPreference {
  readonly elderDisplayName: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const entries = document.cookie.split(';').map((entry) => entry.trim());
  for (const name of CSRF_COOKIE_NAMES) {
    const prefix = `${name}=`;
    const match = entries.find((entry) => entry.startsWith(prefix));
    if (match === undefined) continue;
    try {
      return decodeURIComponent(match.slice(prefix.length));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    throw new MobileCareRequestError(502, 'INVALID_JSON_RESPONSE');
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCsrfToken();
    if (csrf !== undefined) headers.set('x-csrf-token', csrf);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'include',
      headers
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new MobileCareRequestError(0, 'NETWORK_UNAVAILABLE');
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const envelope =
      isRecord(body) && isRecord(body.error) ? body.error : null;
    const code =
      envelope === null
        ? `HTTP_${response.status}`
        : readString(envelope, 'code') ?? `HTTP_${response.status}`;
    const correlationId =
      envelope === null ? null : readString(envelope, 'correlationId');
    if (correlationId === null) {
      throw new MobileCareRequestError(response.status, code);
    }
    throw new MobileCareRequestError(response.status, code, correlationId);
  }
  return body;
}

function idempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function invalidResponse(): never {
  throw new MobileCareRequestError(502, 'INVALID_M04_RESPONSE');
}

function invalidRequest(): never {
  throw new MobileCareRequestError(500, 'INVALID_M04_REQUEST');
}

function toMobileEmergency(event: CaregiverEmergency): MobileEmergencyView {
  const milestones: EmergencyMilestoneKind[] = [];
  if (event.respondingAt !== null) milestones.push('EN_ROUTE');
  if (event.onSiteAt !== null) milestones.push('ON_SITE');

  return {
    acknowledgedAt: event.acknowledgedAt,
    assignedToMe: event.assignedToMe,
    currentDeadlineAt: event.currentDeadlineAt,
    elderDisplayName: event.elder.preferredName ?? event.elder.displayName,
    id: event.id,
    location: event.location,
    milestones,
    onSiteAt: event.onSiteAt,
    openedAt: event.openedAt,
    reasonCode: event.reasonCode,
    requiredResolutionChecklistCodes:
      event.requiredResolutionChecklistCodes,
    resolvedAt: event.resolvedAt,
    respondingAt: event.respondingAt,
    sourceKind: event.sourceKind,
    status: event.status,
    version: event.version
  };
}

export async function createElderEmergency(
  externalEventId: string,
  clientObservedAt: string,
  signal?: AbortSignal
): Promise<ElderEmergencyStatus> {
  const payload = elderEmergencySignalRequestSchema.safeParse({
    clientObservedAt,
    externalEventId,
    idempotencyKey: externalEventId,
    reasonCode: 'ELDER_BUTTON_PRESSED'
  });
  if (!payload.success) return invalidRequest();

  const parsed = elderEmergencyStatusSchema.safeParse(
    await request('/elder/emergencies', {
      body: JSON.stringify(payload.data),
      method: 'POST',
      signal
    })
  );
  if (!parsed.success) return invalidResponse();
  return parsed.data;
}

export async function loadElderEmergency(
  emergencyId: string,
  signal?: AbortSignal
): Promise<ElderEmergencyStatus> {
  const parsed = elderEmergencyStatusSchema.safeParse(
    await request(`/elder/emergencies/${encodeURIComponent(emergencyId)}`, {
      signal
    })
  );
  if (!parsed.success) return invalidResponse();
  return parsed.data;
}

export async function loadCaregiverEmergencies(
  signal?: AbortSignal
): Promise<MobileEmergencyView[]> {
  const parsed = caregiverEmergenciesPageSchema.safeParse(
    await request('/caregiver/emergencies', { signal })
  );
  if (!parsed.success) return invalidResponse();
  return parsed.data.items.map(toMobileEmergency);
}

export async function loadCaregiverEmergency(
  emergencyId: string,
  signal?: AbortSignal
): Promise<MobileEmergencyView> {
  const parsed = caregiverEmergencySchema.safeParse(
    await request(`/caregiver/emergencies/${encodeURIComponent(emergencyId)}`, {
      signal
    })
  );
  if (!parsed.success) return invalidResponse();
  return toMobileEmergency(parsed.data);
}

export async function transitionCaregiverEmergency(
  emergencyId: string,
  expectedVersion: number,
  action: CaregiverEmergencyAction
): Promise<MobileEmergencyView> {
  const reasonCodes: Record<CaregiverEmergencyAction, string> = {
    acknowledge: 'CAREGIVER_ACKNOWLEDGED',
    'en-route': 'CAREGIVER_EN_ROUTE',
    'on-site': 'CAREGIVER_ON_SITE'
  };
  const common = {
    clientObservedAt: new Date().toISOString(),
    expectedVersion,
    idempotencyKey: idempotencyKey(`caregiver-${action}`),
    reasonCode: reasonCodes[action]
  };
  const payload =
    action === 'acknowledge'
      ? caregiverEmergencyAcknowledgeRequestSchema.safeParse(common)
      : caregiverEmergencyMilestoneRequestSchema.safeParse({
          ...common,
          kind: action === 'en-route' ? 'EN_ROUTE' : 'ON_SITE'
        });
  if (!payload.success) return invalidRequest();

  const parsed = caregiverEmergencySchema.safeParse(
    await request(
      action === 'acknowledge'
        ? `/caregiver/emergencies/${encodeURIComponent(emergencyId)}/acknowledge`
        : `/caregiver/emergencies/${encodeURIComponent(emergencyId)}/milestones`,
      {
        body: JSON.stringify(payload.data),
        method: 'POST'
      }
    )
  );
  if (!parsed.success) return invalidResponse();
  return toMobileEmergency(parsed.data);
}

export async function resolveCaregiverEmergency(
  emergencyId: string,
  input: {
    readonly completionChecklist: readonly string[];
    readonly expectedVersion: number;
    readonly familyNotify: boolean;
    readonly outcomeCode: string;
    readonly summary: string;
  }
): Promise<MobileEmergencyView> {
  const payload = caregiverEmergencyResolveRequestSchema.safeParse({
    completionChecklist: input.completionChecklist.map((code) => ({
      code,
      confirmed: true
    })),
    expectedVersion: input.expectedVersion,
    familyNotify: input.familyNotify,
    idempotencyKey: idempotencyKey('caregiver-resolve'),
    outcomeCode: input.outcomeCode,
    summary: input.summary
  });
  if (!payload.success) return invalidRequest();

  const parsed = caregiverEmergencySchema.safeParse(
    await request(
      `/caregiver/emergencies/${encodeURIComponent(emergencyId)}/resolve`,
      {
        body: JSON.stringify(payload.data),
        method: 'POST'
      }
    )
  );
  if (!parsed.success) return invalidResponse();
  return toMobileEmergency(parsed.data);
}

export async function loadFamilyEmergencySummaries(
  signal?: AbortSignal
): Promise<FamilyEmergencySummaryView[]> {
  const parsed = familyEmergencySummariesPageSchema.safeParse(
    await request('/family/emergencies', { signal })
  );
  if (!parsed.success) return invalidResponse();
  return parsed.data.items;
}

export async function loadFamilyEmergencyPreference(
  elderId: string,
  elderDisplayName: string,
  signal?: AbortSignal
): Promise<FamilyEmergencyPreferenceView> {
  const parsed = familyEmergencyNotificationPreferenceSchema.safeParse(
    await request(
      `/family/elders/${encodeURIComponent(elderId)}/emergency-notification-preference`,
      { signal }
    )
  );
  if (!parsed.success) return invalidResponse();
  return { ...parsed.data, elderDisplayName };
}

export async function updateFamilyEmergencyPreference(
  preference: FamilyEmergencyPreferenceView
): Promise<FamilyEmergencyPreferenceView> {
  const payload =
    familyEmergencyNotificationPreferenceUpdateRequestSchema.safeParse({
      channel: preference.channel,
      enabled: preference.enabled,
      expectedVersion: preference.version,
      idempotencyKey: idempotencyKey('family-emergency-preference'),
      notifyOnOpened: preference.notifyOnOpened,
      notifyOnResolved: preference.notifyOnResolved
    });
  if (!payload.success) return invalidRequest();

  const parsed = familyEmergencyNotificationPreferenceSchema.safeParse(
    await request(
      `/family/elders/${encodeURIComponent(preference.elderId)}/emergency-notification-preference`,
      {
        body: JSON.stringify(payload.data),
        method: 'PUT'
      }
    )
  );
  if (!parsed.success) return invalidResponse();
  return { ...parsed.data, elderDisplayName: preference.elderDisplayName };
}
