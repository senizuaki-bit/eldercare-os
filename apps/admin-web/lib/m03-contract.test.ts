import { ContractValidationError } from './auth-contract';
import {
  M03_API_PATHS,
  parseNeedsPage,
  parseWorkOrderDetail,
  parseWorkOrdersPage,
  validateNeedReviewRequest,
  validateWorkOrderTransitionRequest
} from './m03-contract';

const ids = {
  organization: '00000000-0000-4000-8000-000000000001',
  facility: '00000000-0000-4000-8000-000000000101',
  otherFacility: '00000000-0000-4000-8000-000000000102',
  elder: '00000000-0000-4000-8000-000000000701',
  need: '00000000-0000-4000-8000-000000000702',
  voice: '00000000-0000-4000-8000-000000000703',
  workOrder: '00000000-0000-4000-8000-000000000704',
  assignment: '00000000-0000-4000-8000-000000000705',
  staff: '00000000-0000-4000-8000-000000000706',
  user: '00000000-0000-4000-8000-000000000707',
  transition: '00000000-0000-4000-8000-000000000708',
  completion: '00000000-0000-4000-8000-000000000709'
} as const;

const createdAt = '2026-07-20T01:00:00.000Z';
const updatedAt = '2026-07-20T03:00:00.000Z';
const pageInfo = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

const need = {
  id: ids.need,
  organizationId: ids.organization,
  facilityId: ids.facility,
  elderId: ids.elder,
  voiceSubmissionId: ids.voice,
  aiAnalysisId: null,
  source: 'VOICE',
  summary: '老人请求热水并提到有些头晕。',
  category: 'HEALTH_CONCERN',
  urgencySuggestion: 'PRIORITY',
  priority: 'IMMEDIATE_REVIEW',
  requiresHumanReview: true,
  safetyRuleCodes: ['DIZZINESS'],
  status: 'REVIEW_REQUIRED',
  reviewedByUserId: null,
  reviewedAt: null,
  reviewReasonCode: null,
  correlationId: 'corr-M03-need-0702',
  version: 1,
  createdAt,
  updatedAt
} as const;

const assignment = {
  id: ids.assignment,
  organizationId: ids.organization,
  facilityId: ids.facility,
  workOrderId: ids.workOrder,
  targetTeamId: null,
  assigneeStaffProfileId: ids.staff,
  shiftAssignmentId: null,
  status: 'CLAIMED',
  assignedByUserId: ids.user,
  assignedAt: '2026-07-20T01:15:00.000Z',
  claimedAt: '2026-07-20T01:20:00.000Z',
  releasedAt: null,
  reasonCode: 'SUPERVISOR_ASSIGNMENT',
  version: 1
} as const;

const workOrder = {
  id: ids.workOrder,
  organizationId: ids.organization,
  facilityId: ids.facility,
  elderId: ids.elder,
  primaryNeedId: ids.need,
  code: 'WO-20260720-0704',
  title: '确认头晕情况并送热水',
  summary: '先确认现场安全情况，再按需送温水。',
  priority: 'IMMEDIATE_REVIEW',
  status: 'COMPLETED',
  dueAt: '2026-07-20T02:00:00.000Z',
  acceptedAt: '2026-07-20T01:20:00.000Z',
  arrivedAt: null,
  startedAt: '2026-07-20T01:25:00.000Z',
  completedAt: '2026-07-20T01:50:00.000Z',
  verifiedAt: null,
  closedAt: null,
  cancelledAt: null,
  currentAssignment: assignment,
  correlationId: 'corr-M03-order-0704',
  version: 3,
  createdAt,
  updatedAt
} as const;

const completion = {
  id: ids.completion,
  organizationId: ids.organization,
  facilityId: ids.facility,
  elderId: ids.elder,
  workOrderId: ids.workOrder,
  submittedByStaffProfileId: ids.staff,
  noteSource: 'TEXT',
  noteText: '现场确认后已送达温水，并按流程交班。',
  voiceSubmissionId: null,
  confirmedAt: '2026-07-20T01:50:00.000Z',
  correlationId: 'corr-M03-completion-0709',
  version: 1,
  createdAt: '2026-07-20T01:50:00.000Z'
} as const;

const detail = {
  ...workOrder,
  need,
  linkedNeeds: [],
  assignments: [assignment],
  transitions: [
    {
      id: ids.transition,
      organizationId: ids.organization,
      facilityId: ids.facility,
      workOrderId: ids.workOrder,
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      fromVersion: 2,
      toVersion: 3,
      actorUserId: ids.user,
      reasonCode: 'CAREGIVER_COMPLETED',
      correlationId: 'corr-M03-transition-0708',
      occurredAt: '2026-07-20T01:50:00.000Z'
    }
  ],
  arrivals: [],
  completion
} as const;

describe('M03 admin contract boundary', () => {
  it('accepts scoped optional display projections while preserving strict base contracts', () => {
    const elder = { id: ids.elder, displayName: '周奶奶（虚构）', roomLabel: '向阳 201 · A 床' };
    const needs = parseNeedsPage(
      { items: [{ ...need, elder }], pageInfo },
      ids.organization,
      ids.facility
    );
    const orders = parseWorkOrdersPage(
      {
        items: [{
          ...workOrder,
          elder,
          assignee: { staffProfileId: ids.staff, displayName: '陈护工（虚构）', jobTitle: '照护专员' }
        }],
        pageInfo
      },
      ids.organization,
      ids.facility
    );

    expect(needs.items[0]?.elder?.roomLabel).toBe('向阳 201 · A 床');
    expect(orders.items[0]?.assignee?.displayName).toBe('陈护工（虚构）');
  });

  it('fails closed for cross-facility records and relationship mismatches', () => {
    expect(() => parseNeedsPage(
      { items: [{ ...need, facilityId: ids.otherFacility }], pageInfo },
      ids.organization,
      ids.facility
    )).toThrow(ContractValidationError);

    expect(() => parseWorkOrderDetail(
      {
        ...detail,
        assignments: [{ ...assignment, facilityId: ids.otherFacility }]
      },
      ids.organization,
      ids.facility,
      ids.workOrder
    )).toThrow(ContractValidationError);
  });

  it('centralizes tenant-scoped paths and validates optimistic transition requests', () => {
    expect(M03_API_PATHS.verifyWorkOrder(ids.organization, ids.facility, ids.workOrder)).toBe(
      `/admin/organizations/${ids.organization}/facilities/${ids.facility}/work-orders/${ids.workOrder}/verify`
    );
    expect(validateWorkOrderTransitionRequest({
      expectedVersion: 3,
      targetStatus: 'VERIFIED',
      reasonCode: 'SUPERVISOR_VERIFIED'
    })).toEqual({ expectedVersion: 3, targetStatus: 'VERIFIED', reasonCode: 'SUPERVISOR_VERIFIED' });
    expect(() => validateNeedReviewRequest({
      expectedVersion: 1,
      decision: 'CONFIRM',
      reasonCode: 'HUMAN_CONFIRMED'
    })).toThrow(ContractValidationError);
  });
});
