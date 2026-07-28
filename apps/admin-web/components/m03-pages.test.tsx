import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AppProviders } from '../app/providers';
import {
  authSessionFixture,
  organizationId,
  qinglanFacilityId
} from '../test/fixtures';
import { AdminShell } from './admin-shell';
import { NeedReviewQueuePage } from './need-review-queue-page';
import { WorkOrderDetailPage } from './work-order-detail-page';
import { WorkOrderListPage } from './work-order-list-page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/work-orders'
}));

const ids = {
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

const elderProjection = {
  id: ids.elder,
  displayName: '周奶奶（虚构）',
  preferredName: '周奶奶',
  recordNumber: 'ELDER-0701',
  roomLabel: '向阳 201 · A 床'
};

const need = {
  id: ids.need,
  organizationId,
  facilityId: qinglanFacilityId,
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
  organizationId,
  facilityId: qinglanFacilityId,
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

const completedWorkOrder = {
  id: ids.workOrder,
  organizationId,
  facilityId: qinglanFacilityId,
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

const detail = {
  ...completedWorkOrder,
  elder: elderProjection,
  assignee: {
    staffProfileId: ids.staff,
    displayName: '陈护工（虚构）',
    jobTitle: '照护专员'
  },
  ruleResults: [
    {
      code: 'DIZZINESS',
      label: '疑似眩晕表述',
      explanation: '固定关键词规则要求优先人工核对身体不适与跌倒风险。',
      severity: 'WARNING'
    }
  ],
  familySummary: null,
  need,
  linkedNeeds: [],
  assignments: [assignment],
  transitions: [
    {
      id: ids.transition,
      organizationId,
      facilityId: qinglanFacilityId,
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
  completion: {
    id: ids.completion,
    organizationId,
    facilityId: qinglanFacilityId,
    elderId: ids.elder,
    workOrderId: ids.workOrder,
    submittedByStaffProfileId: ids.staff,
    noteSource: 'TEXT',
    noteText: '现场确认后已送达温水，并按流程交班。',
    voiceSubmissionId: null,
    confirmedAt: '2026-07-20T01:50:00.000Z',
    completionChecklist: {
      schemaVersion: 1,
      required: true,
      riskReasons: ['NEED_CATEGORY_HEALTH_CONCERN'],
      expectedCodes: [
        'RECIPIENT_STATE_CONFIRMED',
        'SERVICE_RESULT_CONFIRMED',
        'FOLLOW_UP_RISK_REVIEWED'
      ],
      confirmations: [
        { code: 'RECIPIENT_STATE_CONFIRMED', confirmed: true, confirmedAt: '2026-07-20T01:50:00.000Z' },
        { code: 'SERVICE_RESULT_CONFIRMED', confirmed: true, confirmedAt: '2026-07-20T01:50:00.000Z' },
        { code: 'FOLLOW_UP_RISK_REVIEWED', confirmed: true, confirmedAt: '2026-07-20T01:50:00.000Z' }
      ]
    },
    checklistConfirmedAt: '2026-07-20T01:50:00.000Z',
    correlationId: 'corr-M03-completion-0709',
    version: 1,
    createdAt: '2026-07-20T01:50:00.000Z'
  }
} as const;

function response(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new TypeError('unexpected fetch input');
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new TypeError('expected a JSON string request body');
  return init.body;
}

function renderPage(page: ReactNode) {
  return render(
    <AppProviders>
      <AdminShell session={authSessionFixture}>{page}</AdminShell>
    </AppProviders>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'cookie');
});

describe('M03 admin workflow pages', () => {
  it('loads the scoped review queue and submits a versioned human confirmation', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'eldercare_csrf=m03-token'
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(response(null, 204));
      return Promise.resolve(response({ items: [{ ...need, elder: elderProjection }], pageInfo }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<NeedReviewQueuePage />);

    expect(await screen.findByText('老人请求热水并提到有些头晕。')).toBeInTheDocument();
    expect(screen.getByLabelText(/立即复核风险/)).toHaveTextContent('需要主管立即进行人工判断');

    fireEvent.click(screen.getByRole('button', { name: '设置需求表格可见列' }));
    expect(await screen.findByRole('checkbox', { name: '老人' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '确定性规则' }));
    expect(screen.queryByRole('columnheader', { name: '确定性规则' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /复核 周奶奶：老人请求热水/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认需求$/ }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(requestUrl(postCall![0])).toContain(
        `/admin/organizations/${organizationId}/facilities/${qinglanFacilityId}/needs/${ids.need}/review`
      );
      expect(JSON.parse(requestBody(postCall![1]))).toEqual(expect.objectContaining({
        expectedVersion: 1,
        decision: 'CONFIRM',
        priority: 'IMMEDIATE_REVIEW'
      }));
      expect(new Headers(postCall![1]?.headers).get('x-csrf-token')).toBe('m03-token');
    });
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('status=REVIEW_REQUIRED'))).toBe(true);
  });

  it('requires an explicit rejection reason instead of silently rewriting the audit reason', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'eldercare_csrf=m03-token'
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(response(null, 204));
      return Promise.resolve(response({ items: [{ ...need, elder: elderProjection }], pageInfo }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<NeedReviewQueuePage />);

    fireEvent.click(await screen.findByRole('button', { name: /复核 周奶奶：老人请求热水/ }));
    expect(screen.getByRole('button', { name: '驳回需求' })).toBeDisabled();

    fireEvent.mouseDown(screen.getByLabelText('选择复核原因'));
    fireEvent.click(await screen.findByText('规则或草案误报'));
    const rejectButton = screen.getByRole('button', { name: '驳回需求' });
    expect(rejectButton).toBeEnabled();
    fireEvent.click(rejectButton);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(JSON.parse(requestBody(postCall![1]))).toEqual(expect.objectContaining({
        decision: 'REJECT',
        expectedVersion: 1,
        reasonCode: 'FALSE_POSITIVE'
      }));
    });
  });

  it('renders searchable, sortable work orders with owner and SLA context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [{
        ...completedWorkOrder,
        elder: elderProjection,
        assignee: {
          staffProfileId: ids.staff,
          displayName: '陈护工（虚构）',
          jobTitle: '照护专员'
        }
      }],
      pageInfo
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<WorkOrderListPage />);

    expect(await screen.findByText('确认头晕情况并送热水')).toBeInTheDocument();
    expect(screen.getByText('陈护工（虚构）')).toBeInTheDocument();
    expect(screen.getByLabelText(/按时完成/)).toHaveTextContent('完成时间在计划时限内');
    const detailLinks = screen.getAllByRole('link', { name: /详情|确认头晕情况并送热水/ });
    expect(detailLinks.some((link) => link.getAttribute('href') === `/work-orders/${ids.workOrder}`)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '设置工单表格可见列' }));
    expect(await screen.findByRole('checkbox', { name: '工单' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '最近更新' }));
    expect(screen.queryByRole('columnheader', { name: '最近更新' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页面' }), {
      target: { value: '热水' }
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('search=%E7%83%AD%E6%B0%B4'))).toBe(true);
    });
  });

  it('shows the auditable detail sections and posts an allowed verify transition', async () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'eldercare_csrf=m03-token'
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(response(null, 204));
      return Promise.resolve(response(detail));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<WorkOrderDetailPage workOrderId={ids.workOrder} />);

    expect(await screen.findByRole('heading', { name: /请求来源/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /AI 建议/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /确定性风险规则/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /负责人和 SLA/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /不可变状态时间线/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /内部完成记录/ })).toBeInTheDocument();
    expect(screen.getByText('高风险完成清单（版本 1）')).toBeInTheDocument();
    expect(screen.getByText('已核对本次服务实际结果与完成说明一致')).toBeInTheDocument();
    expect(screen.getByText(/清单确认时间/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /家属安全摘要/ })).toBeInTheDocument();
    expect(screen.getByText('AI 输出仅供参考')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '验证完成记录' }));
    fireEvent.click(await screen.findByRole('button', { name: /确认验证$/ }));
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(requestUrl(postCall![0])).toContain(`/work-orders/${ids.workOrder}/verify`);
      expect(JSON.parse(requestBody(postCall![1]))).toEqual({
        expectedVersion: 3,
        targetStatus: 'VERIFIED',
        reasonCode: 'SUPERVISOR_VERIFIED'
      });
    });
  });

  it('fails closed with a scoped forbidden state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null, 403)));
    renderPage(<WorkOrderListPage />);

    expect(await screen.findByText('无权查看工单列表')).toBeInTheDocument();
    expect(screen.getByText('系统不会透露其他机构、院区或授权范围外的记录。')).toBeInTheDocument();
  });
});
