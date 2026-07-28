import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaregiverEmergencyDetail,
  ElderEmergencyPage,
  FamilyEmergencyPanel
} from './m04-workflows';

const ids = {
  elder: '00000000-0000-4000-8000-000000000901',
  emergency: '00000000-0000-4000-8000-000000000902',
  summary: '00000000-0000-4000-8000-000000000903'
} as const;
const checklist = [
  'SCENE_SAFETY_CONFIRMED',
  'ELDER_STATE_CONFIRMED',
  'FOLLOW_UP_HANDOFF_CONFIRMED'
] as const;

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
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

function caregiverEmergency(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    acknowledgedAt: null,
    activeSla: {
      dueAt: '2026-07-28T02:10:00.000Z',
      stage: 'ACKNOWLEDGEMENT',
      status: 'SCHEDULED'
    },
    assignedToMe: true,
    currentDeadlineAt: '2026-07-28T02:10:00.000Z',
    elder: {
      displayName: '周奶奶（虚构）',
      id: ids.elder,
      preferredName: '周奶奶',
      roomLabel: '向阳 201 · A 床'
    },
    elderId: ids.elder,
    escalationCount: 0,
    id: ids.emergency,
    location: {
      accuracyMeters: 4.2,
      expiresAt: '2026-07-28T02:12:00.000Z',
      fallbackReasonCode: null,
      label: '向阳楼二层走廊',
      observedAt: '2026-07-28T02:08:30.000Z',
      source: 'BLE_TAG',
      state: 'CURRENT'
    },
    onSiteAt: null,
    openedAt: '2026-07-28T02:08:00.000Z',
    reasonCode: 'ELDER_BUTTON_PRESSED',
    requiredResolutionChecklistCodes: checklist,
    resolvedAt: null,
    respondingAt: null,
    sourceKind: 'ELDER_BUTTON',
    status: 'OPEN',
    updatedAt: '2026-07-28T02:08:30.000Z',
    version: 1,
    ...overrides
  };
}

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  setOnline(true);
});

describe('M04 mobile emergency workflows', () => {
  it('shows pending immediately and announces success only after server confirmation', async () => {
    const user = userEvent.setup();
    const onEmergencyCreated = vi.fn();
    let resolveRequest: ((response: Response) => void) | undefined;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(responsePromise);

    render(
      <ElderEmergencyPage
        onEmergencyCreated={onEmergencyCreated}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '正在发送求助' })).toBeInTheDocument();
    expect(screen.queryByText('求助已经登记')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '拨打 120' })).toHaveAttribute(
      'href',
      'tel:120'
    );

    resolveRequest?.(
      Response.json({
        assistanceMessage: '工作人员正在确认并赶来',
        fallbackPhoneNumber: '120',
        humanResponseStartedAt: null,
        id: ids.emergency,
        openedAt: '2026-07-28T02:08:00.000Z',
        status: 'OPEN'
      })
    );

    expect(await screen.findByText('求助已经登记')).toBeInTheDocument();
    expect(screen.getByText('工作人员正在确认并赶来')).toBeInTheDocument();
    expect(onEmergencyCreated).toHaveBeenCalledWith(ids.emergency);
    const body = requestBody(fetchMock.mock.calls[0]?.[1]);
    expect(typeof body.clientObservedAt).toBe('string');
    expect(typeof body.externalEventId).toBe('string');
    expect(body).toEqual({
      clientObservedAt: body.clientObservedAt,
      externalEventId: body.externalEventId,
      idempotencyKey: body.externalEventId,
      reasonCode: 'ELDER_BUTTON_PRESSED'
    });

    await user.click(screen.getByRole('button', { name: '更新响应进度' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never fakes a sent state while offline and keeps an honest phone fallback', () => {
    setOnline(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(
      <ElderEmergencyPage
        onEmergencyCreated={vi.fn()}
        onExit={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '网络未连接，求助尚未发送'
    );
    expect(screen.queryByText('求助已经登记')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '拨打 120' })).toHaveAttribute(
      'href',
      'tel:120'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces acknowledge, en-route, on-site and full checklist before resolution', async () => {
    const user = userEvent.setup();
    const mutationBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input, init) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return Promise.resolve(Response.json(caregiverEmergency()));
        }
        const body = requestBody(init);
        mutationBodies.push(body);
        const url = requestUrl(input);
        if (url.endsWith('/acknowledge')) {
          return Promise.resolve(
            Response.json(
              caregiverEmergency({
                acknowledgedAt: '2026-07-28T02:09:00.000Z',
                status: 'ACKNOWLEDGED',
                version: 2
              })
            )
          );
        }
        if (url.endsWith('/milestones') && body.kind === 'EN_ROUTE') {
          return Promise.resolve(
            Response.json(
              caregiverEmergency({
                acknowledgedAt: '2026-07-28T02:09:00.000Z',
                activeSla: {
                  dueAt: '2026-07-28T02:15:00.000Z',
                  stage: 'ARRIVAL',
                  status: 'SCHEDULED'
                },
                respondingAt: '2026-07-28T02:10:00.000Z',
                status: 'RESPONDING',
                version: 3
              })
            )
          );
        }
        if (url.endsWith('/milestones') && body.kind === 'ON_SITE') {
          return Promise.resolve(
            Response.json(
              caregiverEmergency({
                acknowledgedAt: '2026-07-28T02:09:00.000Z',
                activeSla: {
                  dueAt: '2026-07-28T02:30:00.000Z',
                  stage: 'RESOLUTION',
                  status: 'SCHEDULED'
                },
                onSiteAt: '2026-07-28T02:12:00.000Z',
                respondingAt: '2026-07-28T02:10:00.000Z',
                status: 'RESPONDING',
                version: 4
              })
            )
          );
        }
        if (url.endsWith('/resolve')) {
          return Promise.resolve(
            Response.json(
              caregiverEmergency({
                acknowledgedAt: '2026-07-28T02:09:00.000Z',
                activeSla: null,
                currentDeadlineAt: null,
                onSiteAt: '2026-07-28T02:12:00.000Z',
                resolvedAt: '2026-07-28T02:18:00.000Z',
                respondingAt: '2026-07-28T02:10:00.000Z',
                status: 'RESOLVED',
                version: 5
              })
            )
          );
        }
        return Promise.resolve(Response.json({}, { status: 404 }));
      }
    );

    render(
      <CaregiverEmergencyDetail
        emergencyId={ids.emergency}
        onBack={vi.fn()}
      />
    );

    await user.click(
      await screen.findByRole('button', { name: '确认由我负责' })
    );
    await user.click(
      await screen.findByRole('button', { name: '我已出发' })
    );
    await user.click(
      await screen.findByRole('button', { name: '我已到场' })
    );

    const resolve = await screen.findByRole('button', {
      name: '提交人工处置结果'
    });
    expect(resolve).toBeDisabled();
    await user.type(
      screen.getByLabelText('填写现场处置摘要'),
      '现场情况已经稳定，并完成后续交接和观察安排。'
    );
    for (const label of [
      '已确认现场环境安全，避免二次风险',
      '已核对老人当前状态并记录现场观察',
      '已安排后续观察、交接或专业人员接续'
    ]) {
      await user.click(screen.getByRole('checkbox', { name: label }));
    }
    expect(resolve).toBeEnabled();
    await user.click(resolve);

    expect(
      await screen.findByText('现场处置已完成，等待主管复盘')
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).endsWith(`/caregiver/emergencies/${ids.emergency}/milestones`)
      )
    ).toBe(true);
    expect(mutationBodies[1]).toEqual(
      expect.objectContaining({ expectedVersion: 2, kind: 'EN_ROUTE' })
    );
    expect(mutationBodies[2]).toEqual(
      expect.objectContaining({ expectedVersion: 3, kind: 'ON_SITE' })
    );
    const resolutionBody = mutationBodies[3];
    expect(typeof resolutionBody?.idempotencyKey).toBe('string');
    expect(resolutionBody).toEqual({
      completionChecklist: checklist.map((code) => ({
        code,
        confirmed: true
      })),
      expectedVersion: 4,
      familyNotify: true,
      idempotencyKey: resolutionBody?.idempotencyKey,
      outcomeCode: 'STABILIZED_MONITORING',
      summary: '现场情况已经稳定，并完成后续交接和观察安排。'
    });
  });

  it('shows only family-safe summaries and saves an elder-scoped preference', async () => {
    const user = userEvent.setup();
    const preferenceBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith('/family/emergencies')) {
          return Promise.resolve(
            Response.json({
              items: [
                {
                  elderDisplayName: '周奶奶',
                  elderId: ids.elder,
                  emergencyEventId: ids.emergency,
                  id: ids.summary,
                  publishedAt: '2026-07-28T02:20:00.000Z',
                  stage: 'RESOLVED',
                  summary: '现场处置已完成，后续仍由工作人员按流程跟进。',
                  title: '紧急事件现场处置完成'
                }
              ],
              pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
            })
          );
        }
        if (url.endsWith('/family/elders')) {
          return Promise.resolve(
            Response.json({
              items: [
                {
                  displayName: '周奶奶（虚构）',
                  id: ids.elder,
                  preferredName: '周奶奶',
                  sharedFields: ['PREFERRED_NAME']
                }
              ],
              pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
            })
          );
        }
        if (
          url.endsWith(
            `/family/elders/${ids.elder}/emergency-notification-preference`
          )
        ) {
          if (init?.method === 'PUT') preferenceBodies.push(requestBody(init));
          return Promise.resolve(
            Response.json({
              channel: 'IN_APP',
              elderId: ids.elder,
              enabled: init?.method === 'PUT' ? false : true,
              id: '00000000-0000-4000-8000-000000000904',
              notifyOnOpened: false,
              notifyOnResolved: true,
              updatedAt: '2026-07-28T02:00:00.000Z',
              version: init?.method === 'PUT' ? 2 : 1
            })
          );
        }
        return Promise.resolve(Response.json({}, { status: 404 }));
      }
    );

    render(<FamilyEmergencyPanel />);

    expect(
      await screen.findByRole('heading', {
        name: '紧急事件现场处置完成'
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '只显示机构发布的必要阶段摘要；不会显示精确位置、响应人员轨迹、内部备注或现场清单。'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/精确坐标|护工当前位置|内部清单/)).not.toBeInTheDocument();
    expect(await screen.findByText('当前设置：周奶奶')).toBeInTheDocument();

    await user.click(
      screen.getByRole('checkbox', { name: '接收紧急事件通知' })
    );
    await waitFor(() => expect(preferenceBodies).toHaveLength(1));
    const preferenceBody = preferenceBodies[0];
    expect(typeof preferenceBody?.idempotencyKey).toBe('string');
    expect(preferenceBody).toEqual({
      channel: 'IN_APP',
      enabled: false,
      expectedVersion: 1,
      idempotencyKey: preferenceBody?.idempotencyKey,
      notifyOnOpened: false,
      notifyOnResolved: true
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).includes(`/family/elders/${ids.elder}/`)
      )
    ).toBe(true);
  });
});
