import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AppProviders } from '../app/providers';
import {
  authSessionFixture,
  organizationId,
  qinglanFacilityId
} from '../test/fixtures';
import { AdminShell } from './admin-shell';
import { EmergencyCommandCenterPage } from './emergency-command-center-page';
import { EmergencyListPage } from './emergency-list-page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/emergencies'
}));

const ids = {
  elder: '00000000-0000-4000-8000-000000000801',
  emergency: '00000000-0000-4000-8000-000000000802',
  milestone: '00000000-0000-4000-8000-000000000803',
  staff: '00000000-0000-4000-8000-000000000804',
  transition: '00000000-0000-4000-8000-000000000805'
} as const;

const checklist = [
  'SCENE_SAFETY_CONFIRMED',
  'ELDER_STATE_CONFIRMED',
  'FOLLOW_UP_HANDOFF_CONFIRMED'
] as const;
const openedAt = '2026-07-28T01:00:00.000Z';
const updatedAt = '2026-07-28T01:04:00.000Z';

function emergencyItem(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    acknowledgedAt: '2026-07-28T01:01:00.000Z',
    activeSla: {
      dueAt: '2026-07-28T01:10:00.000Z',
      stage: 'RESOLUTION',
      status: 'SCHEDULED'
    },
    correlationId: 'corr-m04-emergency-802',
    currentDeadlineAt: '2026-07-28T01:10:00.000Z',
    currentResponder: {
      acknowledgedAt: '2026-07-28T01:01:00.000Z',
      assignedAt: '2026-07-28T01:00:30.000Z',
      displayName: '陈护工（虚构）',
      elevationExpiresAt: null,
      id: '00000000-0000-4000-8000-000000000806',
      isEmergencyElevation: false,
      jobTitle: '照护专员',
      staffProfileId: ids.staff,
      status: 'ACKNOWLEDGED'
    },
    elder: {
      displayName: '周奶奶（虚构）',
      id: ids.elder,
      preferredName: '周奶奶',
      roomLabel: '向阳 201 · A 床'
    },
    elderId: ids.elder,
    escalationCount: 1,
    facilityId: qinglanFacilityId,
    id: ids.emergency,
    location: {
      accuracyMeters: null,
      expiresAt: '2026-07-28T01:02:00.000Z',
      fallbackReasonCode: 'SAMPLE_EXPIRED',
      label: '向阳 201 · A 床',
      observedAt: '2026-07-28T01:00:20.000Z',
      source: 'ROOM_DIRECTORY',
      state: 'STALE'
    },
    onSiteAt: '2026-07-28T01:03:00.000Z',
    openedAt,
    organizationId,
    reasonCode: 'ELDER_BUTTON_PRESSED',
    resolvedAt: null,
    respondingAt: '2026-07-28T01:02:00.000Z',
    reviewedAt: null,
    sourceKind: 'ELDER_BUTTON',
    status: 'RESPONDING',
    updatedAt,
    version: 4,
    ...overrides
  };
}

function emergencyDetail(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...emergencyItem(),
    acknowledgement: {
      acknowledgedAt: '2026-07-28T01:01:00.000Z',
      actorLabel: '陈护工（虚构）',
      clientObservedAt: '2026-07-28T01:00:58.000Z',
      staffProfileId: ids.staff
    },
    escalations: [
      {
        dueAt: '2026-07-28T01:00:45.000Z',
        id: '00000000-0000-4000-8000-000000000807',
        stage: 'ACKNOWLEDGEMENT',
        status: 'TRIGGERED',
        triggeredAt: '2026-07-28T01:00:46.000Z'
      }
    ],
    milestones: [
      {
        actorLabel: '陈护工（虚构）',
        clientObservedAt: '2026-07-28T01:02:58.000Z',
        id: ids.milestone,
        kind: 'ON_SITE',
        occurredAt: '2026-07-28T01:03:00.000Z',
        staffProfileId: ids.staff
      }
    ],
    relatedEvents: [],
    requiredResolutionChecklistCodes: checklist,
    resolution: null,
    responders: [
      (emergencyItem().currentResponder as Record<string, unknown>)
    ],
    review: null,
    transitions: [
      {
        actorLabel: '紧急设备',
        actorType: 'DEVICE',
        fromStatus: null,
        fromVersion: 0,
        id: ids.transition,
        occurredAt: openedAt,
        reasonCode: 'ELDER_BUTTON_PRESSED',
        toStatus: 'OPEN',
        toVersion: 1
      }
    ],
    ...overrides
  };
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('expected JSON body');
  return JSON.parse(init.body) as Record<string, unknown>;
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
  vi.restoreAllMocks();
});

describe('M04 admin emergency surfaces', () => {
  it('renders the risk queue before analytics with scoped filters and configurable columns', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({
        items: [emergencyItem()],
        pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
      })
    );

    renderPage(<EmergencyListPage />);

    expect(await screen.findByText('老人主动按下紧急求助')).toBeInTheDocument();
    expect(screen.getByText('周奶奶')).toBeInTheDocument();
    expect(screen.getByText('位置已过期')).toBeInTheDocument();
    expect(screen.getByText('已触发 1 次服务端升级')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /进入指挥/ })
    ).toHaveAttribute('href', `/emergencies/${ids.emergency}`);

    fireEvent.click(
      screen.getByRole('button', { name: '设置紧急事件表格可见列' })
    );
    expect(await screen.findByRole('checkbox', { name: '紧急事件' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '当前响应人' }));
    expect(
      screen.queryByRole('columnheader', { name: '当前响应人' })
    ).not.toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = requestUrl(input);
        return (
          url.includes(`/facilities/${qinglanFacilityId}/emergencies`) &&
          url.includes('sortBy=openedAt') &&
          url.includes('sortDirection=desc')
        );
      })
    ).toBe(true);
  });

  it('requires the full human checklist before posting a versioned resolution', async () => {
    const detail = emergencyDetail();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input, init) => {
        if (init?.method === 'POST') return Promise.resolve(response(detail));
        return Promise.resolve(response(detail));
      }
    );

    renderPage(<EmergencyCommandCenterPage emergencyId={ids.emergency} />);

    expect(
      await screen.findByRole('heading', { name: /位置与人工确认路径/ })
    ).toBeInTheDocument();
    expect(screen.getByText('不要把最后位置当作实时位置')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /确认现场处置/ })
    );

    const submit = await screen.findByRole('button', { name: '确认处置完成' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('填写紧急事件处置摘要'), {
      target: { value: '现场已由工作人员确认安全，并安排继续观察和交接。' }
    });
    for (const label of [
      '已确认现场环境安全，避免二次风险',
      '已核对老人当前状态并记录现场观察',
      '已安排后续观察、交接或专业人员接续'
    ]) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }));
    }
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeDefined();
      expect(requestUrl(call![0])).toContain(`/emergencies/${ids.emergency}/resolve`);
      const body = requestBody(call![1]);
      expect(typeof body.idempotencyKey).toBe('string');
      expect(body).toEqual({
        completionChecklist: checklist.map((code) => ({
          code,
          confirmed: true
        })),
        expectedVersion: 4,
        familyNotify: true,
        idempotencyKey: body.idempotencyKey,
        outcomeCode: 'STABILIZED_MONITORING',
        summary: '现场已由工作人员确认安全，并安排继续观察和交接。'
      });
    });
  });

  it('posts a separate supervisor review only after a resolved event', async () => {
    const resolved = emergencyDetail({
      activeSla: null,
      currentDeadlineAt: null,
      currentResponder: null,
      onSiteAt: '2026-07-28T01:03:00.000Z',
      resolution: {
        completionChecklist: checklist,
        familyNotify: true,
        outcomeCode: 'STABILIZED_MONITORING',
        resolvedAt: '2026-07-28T01:08:00.000Z',
        resolvedByLabel: '陈护工（虚构）',
        summary: '现场已稳定，并完成后续交接。'
      },
      resolvedAt: '2026-07-28T01:08:00.000Z',
      status: 'RESOLVED',
      version: 5
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        Promise.resolve(init?.method === 'POST' ? response(resolved) : response(resolved))
    );

    renderPage(<EmergencyCommandCenterPage emergencyId={ids.emergency} />);
    fireEvent.click(
      await screen.findByRole('button', { name: /完成主管复盘/ })
    );
    fireEvent.change(await screen.findByLabelText('填写主管复盘总结'), {
      target: { value: '复盘确认响应及时，后续巡视频次已经交接给当班主管。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '确认完成复盘' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeDefined();
      expect(requestUrl(call![0])).toContain(`/emergencies/${ids.emergency}/review`);
      const body = requestBody(call![1]);
      expect(typeof body.idempotencyKey).toBe('string');
      expect(body).toEqual({
        expectedVersion: 5,
        idempotencyKey: body.idempotencyKey,
        kind: 'COMPLETED',
        summary: '复盘确认响应及时，后续巡视频次已经交接给当班主管。'
      });
    });
  });

  it('fails closed when the scoped queue is forbidden', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 })
    );
    renderPage(<EmergencyListPage />);

    expect(await screen.findByText('无权查看紧急事件队列')).toBeInTheDocument();
    expect(
      screen.getByText('系统不会透露其他机构、院区或授权范围外的紧急记录。')
    ).toBeInTheDocument();
  });
});
