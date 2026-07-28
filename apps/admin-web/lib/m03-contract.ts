import {
  aiAnalysisSchema,
  familySummarySchema,
  needReviewRequestSchema,
  needSchema,
  pageInfoSchema,
  workOrderAssignRequestSchema,
  workOrderDetailSchema,
  workOrderSchema,
  workOrderTransitionRequestSchema,
  type AIAnalysis,
  type FamilySummary,
  type Need,
  type NeedReviewRequest,
  type PageInfo,
  type WorkOrder,
  type WorkOrderAssignRequest,
  type WorkOrderDetail,
  type WorkOrderTransitionRequest
} from '@eldercare/contracts';

import { ContractValidationError } from './auth-contract';

export interface ElderProjection {
  displayName: string;
  id: string;
  preferredName: string | null;
  recordNumber: string | null;
  roomLabel: string | null;
}

export interface AssigneeProjection {
  displayName: string;
  jobTitle: string | null;
  staffProfileId: string;
}

export interface DeterministicRuleProjection {
  code: string;
  explanation: string;
  label: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface NeedAdminItem extends Need {
  elder?: ElderProjection;
}

export interface WorkOrderAdminItem extends WorkOrder {
  assignee?: AssigneeProjection;
  elder?: ElderProjection;
}

export interface WorkOrderAdminDetail extends WorkOrderDetail {
  analysis?: AIAnalysis | null;
  assignee?: AssigneeProjection;
  elder?: ElderProjection;
  familySummary?: FamilySummary | null;
  ruleResults?: DeterministicRuleProjection[];
}

export interface ScopedPage<T> {
  items: T[];
  pageInfo: PageInfo;
}

type JsonRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function nullableProjectionString(
  value: JsonRecord,
  key: string,
  maxLength: number
): string | null | undefined {
  return Object.hasOwn(value, key) ? optionalString(value[key], maxLength) : null;
}

function parseElderProjection(value: unknown, elderId: string): ElderProjection | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'displayName', 'preferredName', 'recordNumber', 'roomLabel'])) {
    return undefined;
  }

  const displayName = optionalString(value.displayName, 160);
  const preferredName = nullableProjectionString(value, 'preferredName', 160);
  const recordNumber = nullableProjectionString(value, 'recordNumber', 80);
  const roomLabel = nullableProjectionString(value, 'roomLabel', 160);
  if (
    value.id !== elderId ||
    typeof displayName !== 'string' ||
    preferredName === undefined ||
    recordNumber === undefined ||
    roomLabel === undefined
  ) {
    return undefined;
  }

  return { id: elderId, displayName, preferredName, recordNumber, roomLabel };
}

function parseAssigneeProjection(
  value: unknown,
  assigneeStaffProfileId: string | null
): AssigneeProjection | undefined {
  if (
    assigneeStaffProfileId === null ||
    !isRecord(value) ||
    !hasOnlyKeys(value, ['staffProfileId', 'displayName', 'jobTitle'])
  ) {
    return undefined;
  }

  const displayName = optionalString(value.displayName, 160);
  const jobTitle = nullableProjectionString(value, 'jobTitle', 120);
  if (
    value.staffProfileId !== assigneeStaffProfileId ||
    typeof displayName !== 'string' ||
    jobTitle === undefined
  ) {
    return undefined;
  }

  return { staffProfileId: assigneeStaffProfileId, displayName, jobTitle };
}

function parseRuleResults(value: unknown): DeterministicRuleProjection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) return undefined;

  const parsed: DeterministicRuleProjection[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['code', 'label', 'explanation', 'severity'])) {
      return undefined;
    }
    const code = optionalString(item.code, 80);
    const label = optionalString(item.label, 160);
    const explanation = optionalString(item.explanation, 500);
    const severity = item.severity;
    if (
      typeof code !== 'string' ||
      typeof label !== 'string' ||
      typeof explanation !== 'string' ||
      (severity !== 'INFO' && severity !== 'WARNING' && severity !== 'CRITICAL')
    ) {
      return undefined;
    }
    parsed.push({ code, label, explanation, severity });
  }
  return parsed;
}

function assertScopedNeed(need: Need, organizationId: string, facilityId: string): void {
  if (need.organizationId !== organizationId || need.facilityId !== facilityId) {
    throw new ContractValidationError('M03 need');
  }
}

function assertScopedWorkOrder(
  workOrder: WorkOrder,
  organizationId: string,
  facilityId: string
): void {
  if (workOrder.organizationId !== organizationId || workOrder.facilityId !== facilityId) {
    throw new ContractValidationError('M03 work order');
  }

  const assignment = workOrder.currentAssignment;
  if (
    assignment !== null &&
    (assignment.organizationId !== organizationId ||
      assignment.facilityId !== facilityId ||
      assignment.workOrderId !== workOrder.id)
  ) {
    throw new ContractValidationError('M03 work order assignment');
  }
}

function splitOptionalProjection(
  value: JsonRecord,
  projectionKeys: readonly string[]
): { base: JsonRecord; projections: JsonRecord } {
  const base: JsonRecord = {};
  const projections: JsonRecord = {};
  const projectionSet = new Set(projectionKeys);
  for (const [key, entry] of Object.entries(value)) {
    if (projectionSet.has(key)) projections[key] = entry;
    else base[key] = entry;
  }
  return { base, projections };
}

function parseNeedItem(
  value: unknown,
  organizationId: string,
  facilityId: string
): NeedAdminItem {
  if (!isRecord(value)) throw new ContractValidationError('M03 need');
  const { base, projections } = splitOptionalProjection(value, ['elder']);
  const parsed = needSchema.safeParse(base);
  if (!parsed.success) throw new ContractValidationError('M03 need');
  assertScopedNeed(parsed.data, organizationId, facilityId);

  const elder = parseElderProjection(projections.elder, parsed.data.elderId);
  if (projections.elder !== undefined && elder === undefined) {
    throw new ContractValidationError('M03 elder projection');
  }
  return elder === undefined ? parsed.data : { ...parsed.data, elder };
}

function parseWorkOrderItem(
  value: unknown,
  organizationId: string,
  facilityId: string
): WorkOrderAdminItem {
  if (!isRecord(value)) throw new ContractValidationError('M03 work order');
  const { base, projections } = splitOptionalProjection(value, ['elder', 'assignee']);
  const parsed = workOrderSchema.safeParse(base);
  if (!parsed.success) throw new ContractValidationError('M03 work order');
  assertScopedWorkOrder(parsed.data, organizationId, facilityId);

  const elder = parseElderProjection(projections.elder, parsed.data.elderId);
  const assignee = parseAssigneeProjection(
    projections.assignee,
    parsed.data.currentAssignment?.assigneeStaffProfileId ?? null
  );
  if (projections.elder !== undefined && elder === undefined) {
    throw new ContractValidationError('M03 elder projection');
  }
  if (projections.assignee !== undefined && assignee === undefined) {
    throw new ContractValidationError('M03 assignee projection');
  }
  return {
    ...parsed.data,
    ...(elder === undefined ? {} : { elder }),
    ...(assignee === undefined ? {} : { assignee })
  };
}

function parsePageEnvelope(value: unknown, contractName: string): JsonRecord {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['items', 'pageInfo']) ||
    !Array.isArray(value.items)
  ) {
    throw new ContractValidationError(contractName);
  }
  return value;
}

export function parseNeedsPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<NeedAdminItem> {
  const envelope = parsePageEnvelope(value, 'M03 needs page');
  const items = (envelope.items as unknown[]).map((item) =>
    parseNeedItem(item, organizationId, facilityId)
  );
  const parsed = pageInfoSchema.safeParse(envelope.pageInfo);
  if (!parsed.success) throw new ContractValidationError('M03 needs page');
  return { items, pageInfo: parsed.data };
}

export function parseWorkOrdersPage(
  value: unknown,
  organizationId: string,
  facilityId: string
): ScopedPage<WorkOrderAdminItem> {
  const envelope = parsePageEnvelope(value, 'M03 work orders page');
  const items = (envelope.items as unknown[]).map((item) =>
    parseWorkOrderItem(item, organizationId, facilityId)
  );
  const parsed = pageInfoSchema.safeParse(envelope.pageInfo);
  if (!parsed.success) throw new ContractValidationError('M03 work orders page');
  return { items, pageInfo: parsed.data };
}

export function parseWorkOrderDetail(
  value: unknown,
  organizationId: string,
  facilityId: string,
  workOrderId: string
): WorkOrderAdminDetail {
  if (!UUID_PATTERN.test(workOrderId) || !isRecord(value)) {
    throw new ContractValidationError('M03 work order detail');
  }
  const { base, projections } = splitOptionalProjection(value, [
    'elder',
    'assignee',
    'analysis',
    'ruleResults',
    'familySummary'
  ]);
  const parsed = workOrderDetailSchema.safeParse(base);
  if (!parsed.success || parsed.data.id !== workOrderId) {
    throw new ContractValidationError('M03 work order detail');
  }
  const detail = parsed.data;
  assertScopedWorkOrder(detail, organizationId, facilityId);
  assertScopedNeed(detail.need, organizationId, facilityId);
  if (
    detail.need.id !== detail.primaryNeedId ||
    detail.need.elderId !== detail.elderId ||
    detail.linkedNeeds.some((need) => {
      assertScopedNeed(need, organizationId, facilityId);
      return need.elderId !== detail.elderId;
    }) ||
    detail.assignments.some(
      (assignment) =>
        assignment.organizationId !== organizationId ||
        assignment.facilityId !== facilityId ||
        assignment.workOrderId !== detail.id
    ) ||
    detail.transitions.some(
      (transition) =>
        transition.organizationId !== organizationId ||
        transition.facilityId !== facilityId ||
        transition.workOrderId !== detail.id
    ) ||
    detail.arrivals.some(
      (arrival) =>
        arrival.organizationId !== organizationId ||
        arrival.facilityId !== facilityId ||
        arrival.workOrderId !== detail.id
    ) ||
    (detail.completion !== null &&
      (detail.completion.organizationId !== organizationId ||
        detail.completion.facilityId !== facilityId ||
        detail.completion.workOrderId !== detail.id ||
        detail.completion.elderId !== detail.elderId))
  ) {
    throw new ContractValidationError('M03 work order detail relationships');
  }

  const elder = parseElderProjection(projections.elder, detail.elderId);
  const assignee = parseAssigneeProjection(
    projections.assignee,
    detail.currentAssignment?.assigneeStaffProfileId ?? null
  );
  if (projections.elder !== undefined && elder === undefined) {
    throw new ContractValidationError('M03 elder projection');
  }
  if (projections.assignee !== undefined && assignee === undefined) {
    throw new ContractValidationError('M03 assignee projection');
  }
  let analysis: AIAnalysis | null | undefined;
  if (projections.analysis === null) {
    analysis = null;
  } else if (projections.analysis !== undefined) {
    const parsedAnalysis = aiAnalysisSchema.safeParse(projections.analysis);
    if (
      !parsedAnalysis.success ||
      parsedAnalysis.data.organizationId !== organizationId ||
      parsedAnalysis.data.facilityId !== facilityId ||
      parsedAnalysis.data.elderId !== detail.elderId ||
      parsedAnalysis.data.id !== detail.need.aiAnalysisId
    ) {
      throw new ContractValidationError('M03 AI analysis projection');
    }
    analysis = parsedAnalysis.data;
  }

  let familySummary: FamilySummary | null | undefined;
  if (projections.familySummary === null) {
    familySummary = null;
  } else if (projections.familySummary !== undefined) {
    const parsedSummary = familySummarySchema.safeParse(projections.familySummary);
    if (
      !parsedSummary.success ||
      parsedSummary.data.workOrderId !== detail.id ||
      parsedSummary.data.elderId !== detail.elderId
    ) {
      throw new ContractValidationError('M03 family summary projection');
    }
    familySummary = parsedSummary.data;
  }

  const ruleResults = parseRuleResults(projections.ruleResults);
  if (projections.ruleResults !== undefined && ruleResults === undefined) {
    throw new ContractValidationError('M03 deterministic rule projection');
  }

  return {
    ...detail,
    ...(elder === undefined ? {} : { elder }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(analysis === undefined ? {} : { analysis }),
    ...(familySummary === undefined ? {} : { familySummary }),
    ...(ruleResults === undefined ? {} : { ruleResults })
  };
}

function scopeBase(organizationId: string, facilityId: string): string {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}`;
}

export const M03_API_PATHS = {
  needs: (organizationId: string, facilityId: string) =>
    `${scopeBase(organizationId, facilityId)}/needs`,
  reviewNeed: (organizationId: string, facilityId: string, needId: string) =>
    `${scopeBase(organizationId, facilityId)}/needs/${encodeURIComponent(needId)}/review`,
  workOrders: (organizationId: string, facilityId: string) =>
    `${scopeBase(organizationId, facilityId)}/work-orders`,
  workOrder: (organizationId: string, facilityId: string, workOrderId: string) =>
    `${scopeBase(organizationId, facilityId)}/work-orders/${encodeURIComponent(workOrderId)}`,
  assignWorkOrder: (organizationId: string, facilityId: string, workOrderId: string) =>
    `${scopeBase(organizationId, facilityId)}/work-orders/${encodeURIComponent(workOrderId)}/assign`,
  verifyWorkOrder: (organizationId: string, facilityId: string, workOrderId: string) =>
    `${scopeBase(organizationId, facilityId)}/work-orders/${encodeURIComponent(workOrderId)}/verify`,
  closeWorkOrder: (organizationId: string, facilityId: string, workOrderId: string) =>
    `${scopeBase(organizationId, facilityId)}/work-orders/${encodeURIComponent(workOrderId)}/close`,
  staffCandidates: (organizationId: string, facilityId: string) =>
    `${scopeBase(organizationId, facilityId)}/staff`
} as const;

export function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

export function validateNeedReviewRequest(value: unknown): NeedReviewRequest {
  const parsed = needReviewRequestSchema.safeParse(value);
  if (!parsed.success) throw new ContractValidationError('M03 need review request');
  return parsed.data;
}

export function validateWorkOrderAssignRequest(value: unknown): WorkOrderAssignRequest {
  const parsed = workOrderAssignRequestSchema.safeParse(value);
  if (!parsed.success) throw new ContractValidationError('M03 work order assignment request');
  return parsed.data;
}

export function validateWorkOrderTransitionRequest(value: unknown): WorkOrderTransitionRequest {
  const parsed = workOrderTransitionRequestSchema.safeParse(value);
  if (!parsed.success) throw new ContractValidationError('M03 work order transition request');
  return parsed.data;
}
