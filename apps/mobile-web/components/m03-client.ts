const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CSRF_COOKIE_NAMES = ['__Host-eldercare_csrf', 'eldercare_csrf'] as const;
const CSRF_HEADER_NAME = 'x-csrf-token';

type JsonRecord = Record<string, unknown>;
type NeedUrgency = 'ROUTINE' | 'PRIORITY' | 'IMMEDIATE_REVIEW';
export type CompletionVoiceMimeType = 'audio/webm' | 'audio/wav' | 'audio/mpeg' | 'audio/mp4';
type VoiceSubmissionStatus =
  | 'UPLOAD_PENDING'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
type WorkOrderStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'VERIFIED'
  | 'CLOSED'
  | 'CANCELLED';

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly correlationId?: string;
  };
}

export interface MobileNeedView {
  readonly id: string;
  readonly priority: NeedUrgency;
  readonly requiresHumanReview: boolean;
  readonly status: string;
  readonly summary: string;
}

export interface MobileWorkOrderView {
  readonly arrivedAt: string | null;
  readonly code: string | null;
  readonly completedAt: string | null;
  readonly dueAt: string | null;
  readonly elderDisplayName: string | null;
  readonly id: string;
  readonly locationLabel: string | null;
  readonly operationalAttention: readonly string[];
  readonly completionChecklistRequired: boolean;
  readonly requiredCompletionChecklistCodes: readonly CompletionChecklistCode[];
  readonly priority: NeedUrgency;
  readonly status: WorkOrderStatus;
  readonly summary: string;
  readonly title: string;
  readonly version: number;
}

export type CompletionChecklistCode =
  | 'RECIPIENT_STATE_CONFIRMED'
  | 'SERVICE_RESULT_CONFIRMED'
  | 'FOLLOW_UP_RISK_REVIEWED';

export interface ElderVoiceSubmissionView {
  readonly failureCode: string | null;
  readonly id: string;
  readonly needs: readonly MobileNeedView[];
  readonly status: VoiceSubmissionStatus;
  readonly version: number;
  readonly workOrders: readonly MobileWorkOrderView[];
}

export interface ElderServiceView extends MobileWorkOrderView {
  readonly canRate: boolean;
  readonly canVerify: boolean;
  readonly ratingScore: number | null;
}

export interface FamilySummaryView {
  readonly id: string;
  readonly publishedAt: string;
  readonly serviceCompletedAt: string;
  readonly status: 'PUBLISHED';
  readonly summary: string;
  readonly title: string;
  readonly workOrderId: string;
}

export interface CaregiverTaskUpdateView {
  readonly eventId: string;
  readonly eventType:
    | 'WORK_ORDER.ASSIGNED'
    | 'WORK_ORDER.ACCEPTED'
    | 'WORK_ORDER.ARRIVED'
    | 'WORK_ORDER.IN_PROGRESS'
    | 'WORK_ORDER.COMPLETED'
    | 'WORK_ORDER.VERIFIED'
    | 'WORK_ORDER.CLOSED'
    | 'WORK_ORDER.CANCELLED';
  readonly occurredAt: string;
  readonly status: WorkOrderStatus;
  readonly version: number;
  readonly workOrderId: string;
}

export interface CaregiverCompletionVoiceUploadIntentView {
  readonly acceptedMimeTypes: readonly CompletionVoiceMimeType[];
  readonly expectedVersion: number;
  readonly maxSizeBytes: number;
  readonly submissionId: string;
  readonly upload: {
    readonly expiresAt: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly method: 'POST';
    readonly url: string;
  };
}

export interface CaregiverCompletionVoiceResultView {
  readonly completionDraft: {
    readonly noteText: string;
    readonly voiceSubmissionId: string;
  } | null;
  readonly failureCode: string | null;
  readonly status: VoiceSubmissionStatus;
  readonly submissionId: string;
  readonly version: number;
}

export class MobileCareRequestError extends Error {
  readonly code: string;
  readonly correlationId?: string;
  readonly status: number;

  constructor(status: number, code: string, correlationId?: string) {
    super('Mobile care request failed');
    this.name = 'MobileCareRequestError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

function readNumber(record: JsonRecord, key: string): number | null {
  return typeof record[key] === 'number' && Number.isFinite(record[key])
    ? record[key]
    : null;
}

function readBoolean(record: JsonRecord, key: string): boolean | null {
  return typeof record[key] === 'boolean' ? record[key] : null;
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  return isRecord(record[key]) ? record[key] : null;
}

function readRecords(record: JsonRecord, key: string): JsonRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const parts = document.cookie.split(';').map((part) => part.trim());
  for (const name of CSRF_COOKIE_NAMES) {
    const prefix = `${name}=`;
    const cookie = parts.find((part) => part.startsWith(prefix));
    if (!cookie) continue;
    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  try {
    return await response.json();
  } catch {
    throw new MobileCareRequestError(502, 'INVALID_JSON_RESPONSE');
  }
}

function toRequestError(response: Response, body: unknown): MobileCareRequestError {
  const envelope = isRecord(body) ? (body as ErrorEnvelope) : undefined;
  return new MobileCareRequestError(
    response.status,
    envelope?.error?.code ?? `HTTP_${response.status}`,
    envelope?.error?.correlationId
  );
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) {
    const csrfToken = readCsrfToken();
    if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
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
  if (!response.ok) throw toRequestError(response, body);
  return body;
}

const workOrderStatuses = new Set<WorkOrderStatus>([
  'NEW',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED'
]);
const priorities = new Set<NeedUrgency>(['ROUTINE', 'PRIORITY', 'IMMEDIATE_REVIEW']);
const submissionStatuses = new Set<VoiceSubmissionStatus>([
  'UPLOAD_PENDING',
  'UPLOADED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
]);
const completionVoiceMimeTypes = new Set<CompletionVoiceMimeType>([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4'
]);
const completionChecklistCodes = new Set<CompletionChecklistCode>([
  'RECIPIENT_STATE_CONFIRMED',
  'SERVICE_RESULT_CONFIRMED',
  'FOLLOW_UP_RISK_REVIEWED'
]);
const orderedCompletionChecklistCodes: readonly CompletionChecklistCode[] = [
  'RECIPIENT_STATE_CONFIRMED',
  'SERVICE_RESULT_CONFIRMED',
  'FOLLOW_UP_RISK_REVIEWED'
];
const taskUpdateTypes = new Set<CaregiverTaskUpdateView['eventType']>([
  'WORK_ORDER.ASSIGNED',
  'WORK_ORDER.ACCEPTED',
  'WORK_ORDER.ARRIVED',
  'WORK_ORDER.IN_PROGRESS',
  'WORK_ORDER.COMPLETED',
  'WORK_ORDER.VERIFIED',
  'WORK_ORDER.CLOSED',
  'WORK_ORDER.CANCELLED'
]);

function requireRecord(body: unknown): JsonRecord {
  if (!isRecord(body)) throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  return body;
}

function requireString(record: JsonRecord, key: string): string {
  const value = readString(record, key);
  if (!value) throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  return value;
}

function requireVersion(record: JsonRecord): number {
  const value = readNumber(record, 'version');
  if (value === null || !Number.isInteger(value) || value < 1) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  return value;
}

function requirePositiveInteger(record: JsonRecord, key: string): number {
  const value = readNumber(record, key);
  if (value === null || !Number.isInteger(value) || value < 1) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  return value;
}

function normalizePriority(value: unknown): NeedUrgency {
  return typeof value === 'string' && priorities.has(value as NeedUrgency)
    ? (value as NeedUrgency)
    : 'ROUTINE';
}

function normalizeWorkOrder(value: unknown): MobileWorkOrderView {
  const wrapper = requireRecord(value);
  const record = readRecord(wrapper, 'workOrder') ?? wrapper;
  const status = requireString(record, 'status');
  if (!workOrderStatuses.has(status as WorkOrderStatus)) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }

  const elder = readRecord(wrapper, 'elder');
  const residence = elder ? readRecord(elder, 'currentResidence') : null;
  const derivedLocation = residence
    ? [
        readString(residence, 'buildingName'),
        readString(residence, 'floorName'),
        readString(residence, 'roomName'),
        readString(residence, 'bedLabel')
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : null;
  const attention = wrapper.operationalAttention;
  const checklistRequired = readBoolean(wrapper, 'completionChecklistRequired') ?? false;
  const checklistValue = wrapper.requiredCompletionChecklistCodes;
  if (
    checklistValue !== undefined &&
    (!Array.isArray(checklistValue) || checklistValue.some(
      (item) => typeof item !== 'string' || !completionChecklistCodes.has(item as CompletionChecklistCode)
    ))
  ) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  const requiredCompletionChecklistCodes = (checklistValue ?? []) as CompletionChecklistCode[];
  const expectedChecklistCodes = checklistRequired ? orderedCompletionChecklistCodes : [];
  if (
    requiredCompletionChecklistCodes.length !== expectedChecklistCodes.length ||
    requiredCompletionChecklistCodes.some((code, index) => code !== expectedChecklistCodes[index])
  ) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }

  return {
    arrivedAt: readString(wrapper, 'arrivedAt') ?? readString(record, 'arrivedAt'),
    code: readString(record, 'code'),
    completedAt: readString(record, 'completedAt'),
    dueAt: readString(record, 'dueAt'),
    elderDisplayName:
      readString(wrapper, 'elderDisplayName') ??
      (elder ? readString(elder, 'preferredName') ?? readString(elder, 'displayName') : null),
    id: requireString(record, 'id'),
    locationLabel: readString(wrapper, 'locationLabel') ?? derivedLocation,
    operationalAttention: Array.isArray(attention)
      ? attention.filter((item): item is string => typeof item === 'string').slice(0, 4)
      : [],
    completionChecklistRequired: checklistRequired,
    requiredCompletionChecklistCodes,
    priority: normalizePriority(record.priority),
    status: status as WorkOrderStatus,
    summary: requireString(record, 'summary'),
    title: requireString(record, 'title'),
    version: requireVersion(record)
  };
}

function normalizeNeed(value: unknown): MobileNeedView {
  const record = requireRecord(value);
  return {
    id: requireString(record, 'id'),
    priority: normalizePriority(record.priority),
    requiresHumanReview: readBoolean(record, 'requiresHumanReview') ?? false,
    status: requireString(record, 'status'),
    summary: requireString(record, 'summary')
  };
}

function normalizeVoiceSubmission(body: unknown): ElderVoiceSubmissionView {
  const wrapper = requireRecord(body);
  const record = readRecord(wrapper, 'submission') ?? wrapper;
  const status = requireString(record, 'status');
  if (!submissionStatuses.has(status as VoiceSubmissionStatus)) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  const singularNeed = readRecord(wrapper, 'need');
  const singularWorkOrder = readRecord(wrapper, 'workOrder');
  const needs = readRecords(wrapper, 'needs');
  const workOrders = readRecords(wrapper, 'workOrders');

  return {
    failureCode: readString(record, 'failureCode'),
    id: requireString(record, 'id'),
    needs: (needs.length > 0 ? needs : singularNeed ? [singularNeed] : []).map(normalizeNeed),
    status: status as VoiceSubmissionStatus,
    version: requireVersion(record),
    workOrders: (workOrders.length > 0 ? workOrders : singularWorkOrder ? [singularWorkOrder] : []).map(
      normalizeWorkOrder
    )
  };
}

function normalizeItems(body: unknown): unknown[] {
  const record = requireRecord(body);
  if (!Array.isArray(record.items)) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  return record.items;
}

function normalizeElderService(value: unknown): ElderServiceView {
  const wrapper = requireRecord(value);
  const workOrder = normalizeWorkOrder(wrapper);
  const rating = readRecord(wrapper, 'rating');
  return {
    ...workOrder,
    canRate:
      readBoolean(wrapper, 'canRate') ?? ['VERIFIED', 'CLOSED'].includes(workOrder.status),
    canVerify: readBoolean(wrapper, 'canVerify') ?? workOrder.status === 'COMPLETED',
    ratingScore: rating ? readNumber(rating, 'score') : readNumber(wrapper, 'ratingScore')
  };
}

function normalizeActionWorkOrder(body: unknown): MobileWorkOrderView | null {
  if (body === undefined) return null;
  return normalizeWorkOrder(body);
}

function validateArrival(body: unknown, workOrderId: string): void {
  const record = requireRecord(body);
  if (
    requireString(record, 'workOrderId') !== workOrderId ||
    !readString(record, 'arrivedAt') ||
    readNumber(record, 'toVersion') === null
  ) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
}

function normalizeTaskUpdate(value: unknown): CaregiverTaskUpdateView | null {
  if (!isRecord(value)) return null;
  const eventId = readString(value, 'eventId');
  const eventType = readString(value, 'eventType');
  const occurredAt = readString(value, 'occurredAt');
  const status = readString(value, 'status');
  const version = readNumber(value, 'version');
  const workOrderId = readString(value, 'workOrderId');
  if (
    !eventId ||
    !eventType ||
    !taskUpdateTypes.has(eventType as CaregiverTaskUpdateView['eventType']) ||
    !occurredAt ||
    !status ||
    !workOrderStatuses.has(status as WorkOrderStatus) ||
    version === null ||
    !Number.isInteger(version) ||
    version < 1 ||
    !workOrderId
  ) {
    return null;
  }
  return {
    eventId,
    eventType: eventType as CaregiverTaskUpdateView['eventType'],
    occurredAt,
    status: status as WorkOrderStatus,
    version,
    workOrderId
  };
}

function normalizeCompletionVoiceUploadIntent(
  body: unknown
): CaregiverCompletionVoiceUploadIntentView {
  const record = requireRecord(body);
  const upload = readRecord(record, 'upload');
  const rawMimeTypes = record.acceptedMimeTypes;
  if (
    upload === null ||
    readString(upload, 'method') !== 'POST' ||
    !Array.isArray(rawMimeTypes)
  ) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  const acceptedMimeTypes = rawMimeTypes.filter(
    (value): value is CompletionVoiceMimeType =>
      typeof value === 'string' && completionVoiceMimeTypes.has(value as CompletionVoiceMimeType)
  );
  if (acceptedMimeTypes.length === 0 || acceptedMimeTypes.length !== rawMimeTypes.length) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  const rawFields = readRecord(upload, 'fields');
  if (rawFields === null) throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  const fields = Object.fromEntries(
    Object.entries(rawFields).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  if (Object.keys(fields).length !== Object.keys(rawFields).length) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  return {
    acceptedMimeTypes,
    expectedVersion: requirePositiveInteger(record, 'expectedVersion'),
    maxSizeBytes: requirePositiveInteger(record, 'maxSizeBytes'),
    submissionId: requireString(record, 'submissionId'),
    upload: {
      expiresAt: requireString(upload, 'expiresAt'),
      fields,
      method: 'POST',
      url: requireString(upload, 'url')
    }
  };
}

function normalizeCompletionVoiceResult(body: unknown): CaregiverCompletionVoiceResultView {
  const wrapper = requireRecord(body);
  const submission = readRecord(wrapper, 'submission');
  if (submission === null) throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  const status = requireString(submission, 'status');
  if (!submissionStatuses.has(status as VoiceSubmissionStatus)) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  const submissionId = requireString(submission, 'id');
  const draft = readRecord(wrapper, 'completionDraft');
  const completionDraft = draft === null
    ? null
    : {
        noteText: requireString(draft, 'noteText'),
        voiceSubmissionId: requireString(draft, 'voiceSubmissionId')
      };
  if (completionDraft !== null && completionDraft.voiceSubmissionId !== submissionId) {
    throw new MobileCareRequestError(502, 'INVALID_MOBILE_RESPONSE');
  }
  return {
    completionDraft,
    failureCode: readString(submission, 'failureCode'),
    status: status as VoiceSubmissionStatus,
    submissionId,
    version: requireVersion(submission)
  };
}

export function subscribeCaregiverTaskUpdates(
  onUpdate: (update: CaregiverTaskUpdateView) => void,
  onConnectionChange?: (state: 'open' | 'reconnecting' | 'unsupported') => void
): () => void {
  if (typeof EventSource === 'undefined') {
    onConnectionChange?.('unsupported');
    return () => undefined;
  }
  let source: EventSource;
  try {
    source = new EventSource(`${API_BASE_URL}/caregiver/task-updates`, {
      withCredentials: true
    });
  } catch {
    onConnectionChange?.('unsupported');
    return () => undefined;
  }
  source.onopen = () => onConnectionChange?.('open');
  source.onerror = () => onConnectionChange?.('reconnecting');
  source.onmessage = (event) => {
    try {
      const rawData: unknown = event.data;
      if (typeof rawData !== 'string') return;
      const update = normalizeTaskUpdate(JSON.parse(rawData) as unknown);
      if (update) onUpdate(update);
    } catch {
      // Ignore malformed or non-contract events; authoritative GETs remain the source of truth.
    }
  };
  return () => source.close();
}

export async function createDemoVoiceSubmission(
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<ElderVoiceSubmissionView> {
  return normalizeVoiceSubmission(
    await request('/elder/voice-submissions/demo', {
      body: JSON.stringify({
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey
      }),
      method: 'POST',
      signal
    })
  );
}

export async function requestHumanHelp(idempotencyKey: string): Promise<void> {
  await request('/elder/voice-submissions/human-help', {
    body: JSON.stringify({
      idempotencyKey,
      reasonCode: 'ELDER_REQUESTED_HUMAN_HELP'
    }),
    method: 'POST'
  });
}

export async function loadVoiceSubmission(
  submissionId: string,
  signal?: AbortSignal
): Promise<ElderVoiceSubmissionView> {
  return normalizeVoiceSubmission(
    await request(`/elder/voice-submissions/${encodeURIComponent(submissionId)}`, {
      signal
    })
  );
}

export async function cancelElderVoiceSubmission(
  submissionId: string,
  expectedVersion: number
): Promise<ElderVoiceSubmissionView> {
  return normalizeVoiceSubmission(
    await request(`/elder/voice-submissions/${encodeURIComponent(submissionId)}/cancel`, {
      body: JSON.stringify({
        expectedVersion,
        reasonCode: 'ELDER_CANCELLED_VOICE_REQUEST'
      }),
      method: 'POST'
    })
  );
}

export async function loadElderServices(signal?: AbortSignal): Promise<ElderServiceView[]> {
  return normalizeItems(
    await request('/elder/services', { signal })
  ).map(normalizeElderService);
}

export async function verifyElderWorkOrder(
  workOrderId: string,
  expectedVersion: number
): Promise<MobileWorkOrderView | null> {
  return normalizeActionWorkOrder(
    await request(`/elder/work-orders/${encodeURIComponent(workOrderId)}/verify`, {
      body: JSON.stringify({
        expectedVersion,
        reasonCode: 'ELDER_CONFIRMED_COMPLETION',
        targetStatus: 'VERIFIED'
      }),
      method: 'POST'
    })
  );
}

export async function rateElderWorkOrder(
  workOrderId: string,
  expectedWorkOrderVersion: number,
  score: number,
  requiresFollowUp: boolean,
  idempotencyKey: string
): Promise<void> {
  await request(`/elder/work-orders/${encodeURIComponent(workOrderId)}/ratings`, {
    body: JSON.stringify({
      expectedWorkOrderVersion,
      idempotencyKey,
      requiresFollowUp,
      score
    }),
    method: 'POST'
  });
}

export async function loadCaregiverWorkOrders(
  signal?: AbortSignal
): Promise<MobileWorkOrderView[]> {
  return normalizeItems(
    await request('/caregiver/work-orders', { signal })
  ).map(normalizeWorkOrder);
}

export async function loadCaregiverWorkOrder(
  workOrderId: string,
  signal?: AbortSignal
): Promise<MobileWorkOrderView> {
  return normalizeWorkOrder(
    await request(`/caregiver/work-orders/${encodeURIComponent(workOrderId)}`, {
      signal
    })
  );
}

type CaregiverAction = 'accept' | 'arrive' | 'start';

export async function transitionCaregiverWorkOrder(
  workOrderId: string,
  expectedVersion: number,
  action: CaregiverAction
): Promise<MobileWorkOrderView | null> {
  const reasonCodes: Record<CaregiverAction, string> = {
    accept: 'CAREGIVER_ACCEPTED',
    arrive: 'CAREGIVER_ARRIVED',
    start: 'CAREGIVER_STARTED'
  };
  const targetStatus = action === 'accept' ? 'ACCEPTED' : action === 'start' ? 'IN_PROGRESS' : null;
  const body = await request(
    `/caregiver/work-orders/${encodeURIComponent(workOrderId)}/${action}`,
    {
      body: JSON.stringify({
        expectedVersion,
        reasonCode: reasonCodes[action],
        ...(targetStatus ? { targetStatus } : {})
      }),
      method: 'POST'
    }
  );
  if (action === 'arrive') {
    validateArrival(body, workOrderId);
    return null;
  }
  return normalizeActionWorkOrder(body);
}

export async function createCaregiverCompletionVoiceUploadIntent(
  workOrderId: string,
  file: Pick<File, 'size' | 'type'>,
  idempotencyKey: string
): Promise<CaregiverCompletionVoiceUploadIntentView> {
  if (!completionVoiceMimeTypes.has(file.type as CompletionVoiceMimeType)) {
    throw new MobileCareRequestError(400, 'VOICE_MIME_TYPE_NOT_ALLOWED');
  }
  return normalizeCompletionVoiceUploadIntent(
    await request(
      `/caregiver/work-orders/${encodeURIComponent(workOrderId)}/voice-submissions/upload-intents`,
      {
        body: JSON.stringify({
          fixtureKey: 'CARE_COMPLETION_V1',
          idempotencyKey,
          mimeType: file.type,
          sizeBytes: file.size
        }),
        method: 'POST'
      }
    )
  );
}

export async function uploadCaregiverCompletionVoiceFile(
  intent: CaregiverCompletionVoiceUploadIntentView,
  file: File
): Promise<void> {
  if (
    !intent.acceptedMimeTypes.includes(file.type as CompletionVoiceMimeType) ||
    file.size < 1 ||
    file.size > intent.maxSizeBytes
  ) {
    throw new MobileCareRequestError(400, 'VOICE_FILE_NOT_ALLOWED');
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(intent.upload.fields)) form.append(name, value);
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch(intent.upload.url, {
      body: form,
      credentials: 'omit',
      method: intent.upload.method
    });
  } catch {
    throw new MobileCareRequestError(0, 'NETWORK_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new MobileCareRequestError(response.status, 'VOICE_UPLOAD_FAILED');
  }
}

export async function finalizeCaregiverCompletionVoice(
  workOrderId: string,
  submissionId: string,
  expectedVersion: number
): Promise<CaregiverCompletionVoiceResultView> {
  return normalizeCompletionVoiceResult(
    await request(
      `/caregiver/work-orders/${encodeURIComponent(workOrderId)}/voice-submissions/${encodeURIComponent(submissionId)}/finalize`,
      {
        body: JSON.stringify({ expectedVersion }),
        method: 'POST'
      }
    )
  );
}

export async function cancelCaregiverCompletionVoice(
  workOrderId: string,
  submissionId: string,
  expectedVersion: number
): Promise<ElderVoiceSubmissionView> {
  return normalizeVoiceSubmission(
    await request(
      `/caregiver/work-orders/${encodeURIComponent(workOrderId)}/voice-submissions/${encodeURIComponent(submissionId)}/cancel`,
      {
        body: JSON.stringify({
          expectedVersion,
          reasonCode: 'CAREGIVER_CANCELLED_COMPLETION_VOICE'
        }),
        method: 'POST'
      }
    )
  );
}

export async function completeCaregiverWorkOrder(
  workOrderId: string,
  expectedVersion: number,
  noteText: string,
  idempotencyKey: string,
  voiceSubmissionId?: string,
  completionChecklist?: readonly CompletionChecklistCode[]
): Promise<MobileWorkOrderView | null> {
  return normalizeActionWorkOrder(
    await request(`/caregiver/work-orders/${encodeURIComponent(workOrderId)}/complete`, {
      body: JSON.stringify({
        expectedVersion,
        idempotencyKey,
        noteSource: voiceSubmissionId === undefined ? 'TEXT' : 'VOICE',
        noteText,
        reasonCode: 'CAREGIVER_COMPLETED',
        ...(completionChecklist === undefined
          ? {}
          : {
              completionChecklist: completionChecklist.map((code) => ({
                code,
                confirmed: true
              }))
            }),
        ...(voiceSubmissionId === undefined ? {} : { voiceSubmissionId })
      }),
      method: 'POST'
    })
  );
}

export async function loadFamilySummaries(signal?: AbortSignal): Promise<FamilySummaryView[]> {
  return normalizeItems(
    await request('/family/summaries', { signal })
  ).flatMap((value) => {
    const record = requireRecord(value);
    if (readString(record, 'status') !== 'PUBLISHED') return [];
    const publishedAt = readString(record, 'publishedAt');
    if (!publishedAt) return [];
    return [
      {
        id: requireString(record, 'id'),
        publishedAt,
        serviceCompletedAt: requireString(record, 'serviceCompletedAt'),
        status: 'PUBLISHED' as const,
        summary: requireString(record, 'summary'),
        title: requireString(record, 'title'),
        workOrderId: requireString(record, 'workOrderId')
      }
    ];
  });
}
