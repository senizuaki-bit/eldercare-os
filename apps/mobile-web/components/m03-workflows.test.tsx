import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CaregiverTaskDetail,
  CaregiverTasksPanel,
  ElderServicesPanel,
  ElderVoiceRequestPage,
  FamilySummariesPanel
} from './m03-workflows';

const workOrderId = '00000000-0000-4000-8000-000000000401';
const submissionId = '00000000-0000-4000-8000-000000000402';

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value
  });
}

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    arrivedAt: null,
    code: 'WO-20260721-401',
    completedAt: null,
    dueAt: '2026-07-21T10:00:00.000+08:00',
    id: workOrderId,
    priority: 'PRIORITY',
    status: 'ASSIGNED',
    summary: '送一杯温水，并对头晕反馈进行人工复核。',
    title: '送温水并复核头晕反馈',
    version: 2,
    ...overrides
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new TypeError('Expected a JSON request body');
  return JSON.parse(init.body) as unknown;
}

beforeEach(() => {
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  setOnline(true);
});

describe('M03 mobile workflows', () => {
  it('discloses AI identity and shows human review only after the demo endpoint confirms it', async () => {
    const user = userEvent.setup();
    const onSubmissionCreated = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        analysis: {},
        needs: [
          {
            id: '00000000-0000-4000-8000-000000000403',
            priority: 'PRIORITY',
            requiresHumanReview: true,
            status: 'REVIEW_REQUIRED',
            summary: '头晕反馈需要人工复核'
          },
          {
            id: '00000000-0000-4000-8000-000000000404',
            priority: 'ROUTINE',
            requiresHumanReview: false,
            status: 'CONFIRMED',
            summary: '送一杯温水'
          }
        ],
        submission: { id: submissionId, status: 'COMPLETED', version: 3 },
        transcript: {},
        workOrder: workOrder()
      })
    );

    render(
      <ElderVoiceRequestPage
        onExit={vi.fn()}
        onSubmissionCreated={onSubmissionCreated}
      />
    );

    expect(screen.getByText('这是 AI 关怀助手')).toBeInTheDocument();
    expect(screen.getByText('“我想喝热水，今天有点头晕。”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交演示语句/ })).toHaveAccessibleDescription(
      /头晕.*人工复核/
    );

    await user.click(screen.getByRole('button', { name: /提交演示语句/ }));

    expect(await screen.findByRole('heading', { name: '工作人员正在复核' })).toBeInTheDocument();
    expect(screen.getByText(/AI 没有作出医疗或紧急决定/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结束本次交流' })).toBeEnabled();
    expect(onSubmissionCreated).toHaveBeenCalledWith(submissionId);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/elder/voice-submissions/demo',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('does not submit or announce success while offline', () => {
    setOnline(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    render(<ElderVoiceRequestPage onExit={vi.fn()} onSubmissionCreated={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('当前处于离线状态');
    expect(screen.getByRole('button', { name: /提交演示语句/ })).toBeDisabled();
    expect(screen.queryByText(/成功登记|服务器已确认人工帮助请求/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels an existing non-terminal elder submission before leaving', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json({ id: submissionId, status: 'PROCESSING', version: 2 }));
      }
      if (url.endsWith(`/elder/voice-submissions/${submissionId}/cancel`)) {
        return Promise.resolve(Response.json({ id: submissionId, status: 'CANCELLED', version: 3 }));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(
      <ElderVoiceRequestPage
        initialSubmissionId={submissionId}
        onExit={onExit}
        onSubmissionCreated={vi.fn()}
      />
    );

    const cancelButton = await screen.findByRole('button', { name: '结束并取消本次交流' });
    expect(screen.getByText('服务器状态：正在整理')).toBeInTheDocument();
    await user.click(cancelButton);

    expect(screen.getByText('服务器状态：已取消')).toBeInTheDocument();
    expect(onExit).toHaveBeenCalledTimes(1);
    const cancelCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/cancel'));
    expect(cancelCall).toBeDefined();
    expect(requestBody(cancelCall?.[1])).toEqual({
      expectedVersion: 2,
      reasonCode: 'ELDER_CANCELLED_VOICE_REQUEST'
    });
  });

  it('gives repeated caregiver task actions a task-specific accessible name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        items: [
          workOrder({
            elderDisplayName: '周奶奶',
            locationLabel: '向阳 201 · A 床'
          })
        ],
        pageInfo: {}
      })
    );

    render(<CaregiverTasksPanel onSelect={vi.fn()} />);

    expect(
      await screen.findByRole('button', {
        name: '查看任务：送温水并复核头晕反馈，服务对象 周奶奶'
      })
    ).toBeEnabled();
  });

  it('replays an in-flight demo operation with the same key and cancels it before leaving', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const demoBodies: Array<Record<string, unknown>> = [];
    let demoAttempts = 0;
    let resolveCancellation: ((response: Response) => void) | undefined;
    const cancellationResponse = new Promise<Response>((resolve) => {
      resolveCancellation = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if (url.endsWith('/elder/voice-submissions/demo')) {
        demoBodies.push(requestBody(init) as Record<string, unknown>);
        demoAttempts += 1;
        if (demoAttempts === 1) {
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) {
              reject(new DOMException('aborted', 'AbortError'));
              return;
            }
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true }
            );
          });
        }
        return Promise.resolve(Response.json({
          needs: [],
          submission: { id: submissionId, status: 'PROCESSING', version: 1 },
          workOrders: []
        }));
      }
      if (url.endsWith(`/elder/voice-submissions/${submissionId}/cancel`)) {
        return cancellationResponse;
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<ElderVoiceRequestPage onExit={onExit} onSubmissionCreated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /提交演示语句/ }));
    await user.click(screen.getByRole('button', { name: '返回老人端首页' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith('/cancel'))).toBe(true);
    });
    expect(onExit).not.toHaveBeenCalled();
    resolveCancellation?.(
      Response.json({ id: submissionId, status: 'CANCELLED', version: 2 })
    );
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));

    expect(demoBodies).toHaveLength(2);
    expect(demoBodies[0]?.idempotencyKey).toBe(demoBodies[1]?.idempotencyKey);
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith('/cancel'))).toBe(true);
  });

  it('keeps the elder cancellation action available when the server does not confirm it', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json({ id: submissionId, status: 'PROCESSING', version: 2 }));
      }
      return Promise.resolve(Response.json({}, { status: 503 }));
    });

    render(
      <ElderVoiceRequestPage
        initialSubmissionId={submissionId}
        onExit={onExit}
        onSubmissionCreated={vi.fn()}
      />
    );

    await screen.findByText('服务器状态：正在整理');
    await user.click(screen.getByRole('button', { name: '返回老人端首页' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('尚未确认取消');
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '返回老人端首页' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '结束并取消本次交流' })).toBeEnabled();
  });

  it('completes the caregiver accept-arrive-start-text flow with server-confirmed steps', async () => {
    const user = userEvent.setup();
    let detailLoads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.endsWith(`/caregiver/work-orders/${workOrderId}`)) {
        detailLoads += 1;
        return Promise.resolve(Response.json(
          detailLoads === 1
            ? workOrder({ status: 'ASSIGNED', version: 2 })
            : workOrder({
                arrivedAt: '2026-07-21T09:05:00.000+08:00',
                status: 'ACCEPTED',
                version: 4
              })
        ));
      }
      if (url.endsWith('/accept')) {
        return Promise.resolve(Response.json(workOrder({ status: 'ACCEPTED', version: 3 })));
      }
      if (url.endsWith('/arrive')) {
        return Promise.resolve(Response.json({
          arrivedAt: '2026-07-21T09:05:00.000+08:00',
          toVersion: 4,
          workOrderId
        }));
      }
      if (url.endsWith('/start')) {
        return Promise.resolve(Response.json(
          workOrder({
            arrivedAt: '2026-07-21T09:05:00.000+08:00',
            status: 'IN_PROGRESS',
            version: 5
          })
        ));
      }
      if (url.endsWith('/complete')) {
        return Promise.resolve(Response.json(
          workOrder({
            arrivedAt: '2026-07-21T09:05:00.000+08:00',
            completedAt: '2026-07-21T09:30:00.000+08:00',
            status: 'COMPLETED',
            version: 6
          })
        ));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={vi.fn()} workOrderId={workOrderId} />);

    await user.click(await screen.findByRole('button', { name: '接单' }));
    expect(await screen.findByText('服务器已确认接单。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认到场' }));
    expect(await screen.findByRole('button', { name: '开始处理' })).toBeInTheDocument();
    expect(screen.queryByText('ARRIVED')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '开始处理' }));
    const note = await screen.findByLabelText('文字完成说明');
    expect(screen.getByLabelText('选择语音完成记录')).toBeEnabled();

    await user.type(note, '已送达温水，长者表示稍后由工作人员继续观察。');
    await user.click(screen.getByRole('button', { name: '提交文字完成记录' }));

    expect(await screen.findByText('服务器已保存文字完成记录，等待后续确认。')).toBeInTheDocument();
    expect(screen.getByText('待确认完成')).toBeInTheDocument();
    const mutationBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => requestBody(init));
    expect(mutationBodies.slice(0, 3)).toEqual([
      { expectedVersion: 2, reasonCode: 'CAREGIVER_ACCEPTED', targetStatus: 'ACCEPTED' },
      { expectedVersion: 3, reasonCode: 'CAREGIVER_ARRIVED' },
      { expectedVersion: 4, reasonCode: 'CAREGIVER_STARTED', targetStatus: 'IN_PROGRESS' }
    ]);
    expect(mutationBodies[3]).toEqual(expect.objectContaining({
      expectedVersion: 5,
      noteSource: 'TEXT',
      noteText: '已送达温水，长者表示稍后由工作人员继续观察。',
      reasonCode: 'CAREGIVER_COMPLETED'
    }));
    expect(typeof (mutationBodies[3] as Record<string, unknown>).idempotencyKey).toBe('string');
  });

  it('requires every server-owned high-risk checklist item before text completion', async () => {
    const user = userEvent.setup();
    const completionBodies: Array<Record<string, unknown>> = [];
    const requiredCompletionChecklistCodes = [
      'RECIPIENT_STATE_CONFIRMED',
      'SERVICE_RESULT_CONFIRMED',
      'FOLLOW_UP_RISK_REVIEWED'
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json(workOrder({
          status: 'IN_PROGRESS',
          version: 5,
          completionChecklistRequired: true,
          operationalAttention: ['HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW'],
          requiredCompletionChecklistCodes
        })));
      }
      if (url.endsWith('/complete')) {
        completionBodies.push(requestBody(init) as Record<string, unknown>);
        return Promise.resolve(Response.json(workOrder({
          status: 'COMPLETED',
          version: 6,
          completedAt: '2026-07-21T09:30:00.000+08:00',
          completionChecklistRequired: true,
          requiredCompletionChecklistCodes
        })));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={vi.fn()} workOrderId={workOrderId} />);

    const note = await screen.findByLabelText('文字完成说明');
    await user.type(note, '已完成服务，并记录后续交接事项。');
    const submit = screen.getByRole('button', { name: '提交文字完成记录' });
    expect(screen.getByText('高风险工单完成核对')).toBeInTheDocument();
    expect(screen.getByText('老人提到身体不适，必须继续由工作人员复核并记录')).toBeInTheDocument();
    expect(screen.queryByText('HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW')).not.toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText('已核对服务对象当前反应，并记录需要继续跟进的信息'));
    await user.click(screen.getByLabelText('已核对本次服务实际结果与完成说明一致'));
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText('已核对需要继续交接或升级的风险事项'));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await vi.waitFor(() => expect(completionBodies).toHaveLength(1));
    expect(completionBodies[0]?.completionChecklist).toEqual(
      requiredCompletionChecklistCodes.map((code) => ({ code, confirmed: true }))
    );
  });

  it('retries a lost caregiver completion response with the same operation key and payload', async () => {
    const user = userEvent.setup();
    const completionBodies: Array<Record<string, unknown>> = [];
    let completionAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json(workOrder({ status: 'IN_PROGRESS', version: 5 })));
      }
      if (url.endsWith('/complete')) {
        completionBodies.push(requestBody(init) as Record<string, unknown>);
        completionAttempts += 1;
        if (completionAttempts === 1) return Promise.reject(new TypeError('response lost'));
        return Promise.resolve(Response.json(workOrder({ status: 'COMPLETED', version: 6 })));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={vi.fn()} workOrderId={workOrderId} />);

    const note = await screen.findByLabelText('文字完成说明');
    await user.type(note, '已送达温水，继续观察。');
    await user.click(screen.getByRole('button', { name: '提交文字完成记录' }));
    expect(await screen.findByText(/再次提交会沿用同一个操作编号/)).toBeInTheDocument();
    expect(note).toBeDisabled();
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeDisabled();
    expect(screen.getByText(/完成提交尚未与服务器核对清楚/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试同一次完成提交' }));

    expect(await screen.findByText('服务器已保存文字完成记录，等待后续确认。')).toBeInTheDocument();
    expect(completionBodies).toHaveLength(2);
    expect(completionBodies[0]).toEqual(completionBodies[1]);
    expect(completionBodies[0]?.idempotencyKey).toEqual(expect.any(String));
  });

  it('cancels an unfinished caregiver voice attempt before the top back action leaves', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const uploadUrl = 'http://127.0.0.1:9000/caregiver-cancel-voice';
    let resolveCancellation: ((response: Response) => void) | undefined;
    const cancellationResponse = new Promise<Response>((resolve) => {
      resolveCancellation = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json(workOrder({ status: 'IN_PROGRESS', version: 5 })));
      }
      if (url.endsWith('/voice-submissions/upload-intents')) {
        return Promise.resolve(Response.json({
          acceptedMimeTypes: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'],
          expectedVersion: 1,
          maxSizeBytes: 10 * 1024 * 1024,
          submissionId,
          upload: {
            expiresAt: '2026-07-21T09:05:00.000Z',
            fields: { key: 'voice/object-key', policy: 'signed-policy' },
            method: 'POST',
            url: uploadUrl
          }
        }));
      }
      if (url === uploadUrl) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.endsWith(`/voice-submissions/${submissionId}/cancel`)) {
        return cancellationResponse;
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={onBack} workOrderId={workOrderId} />);
    await user.upload(
      await screen.findByLabelText('选择语音完成记录'),
      new File(['voice'], 'completion.wav', { type: 'audio/wav' })
    );
    expect(await screen.findByText(/已保留本次语音操作/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回任务列表' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith('/cancel'))).toBe(true);
    });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeDisabled();
    expect(screen.getByText(/语音正在受控上传或处理中/)).toBeInTheDocument();
    resolveCancellation?.(
      Response.json({ id: submissionId, status: 'CANCELLED', version: 2 })
    );
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());

    const cancelCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/cancel'));
    expect(requestBody(cancelCall?.[1])).toEqual({
      expectedVersion: 1,
      reasonCode: 'CAREGIVER_CANCELLED_COMPLETION_VOICE'
    });
  });

  it('keeps caregiver task detail open when voice cancellation is not confirmed', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const uploadUrl = 'http://127.0.0.1:9000/caregiver-cancel-failure';
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json(workOrder({ status: 'IN_PROGRESS', version: 5 })));
      }
      if (url.endsWith('/voice-submissions/upload-intents')) {
        return Promise.resolve(Response.json({
          acceptedMimeTypes: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'],
          expectedVersion: 1,
          maxSizeBytes: 10 * 1024 * 1024,
          submissionId,
          upload: {
            expiresAt: '2026-07-21T09:05:00.000Z',
            fields: { key: 'voice/object-key', policy: 'signed-policy' },
            method: 'POST',
            url: uploadUrl
          }
        }));
      }
      if (url === uploadUrl) return Promise.resolve(new Response(null, { status: 503 }));
      if (url.endsWith(`/voice-submissions/${submissionId}/cancel`)) {
        return Promise.resolve(Response.json({}, { status: 503 }));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={onBack} workOrderId={workOrderId} />);
    await user.upload(
      await screen.findByLabelText('选择语音完成记录'),
      new File(['voice'], 'completion.wav', { type: 'audio/wav' })
    );
    expect(await screen.findByText(/已保留本次语音操作/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回任务列表' }));

    expect(await screen.findByText(/语音记录尚未确认取消/)).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeEnabled();
  });

  it('uploads completion audio and exposes only an editable AI draft for caregiver review', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const uploadUrl = 'http://127.0.0.1:9000/eldercare-voice';
    const requiredCompletionChecklistCodes = [
      'RECIPIENT_STATE_CONFIRMED',
      'SERVICE_RESULT_CONFIRMED',
      'FOLLOW_UP_RISK_REVIEWED'
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(Response.json(workOrder({
          status: 'IN_PROGRESS',
          version: 5,
          completionChecklistRequired: true,
          requiredCompletionChecklistCodes
        })));
      }
      if (url.endsWith('/voice-submissions/upload-intents')) {
        return Promise.resolve(Response.json({
          acceptedMimeTypes: ['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4'],
          expectedVersion: 1,
          maxSizeBytes: 10 * 1024 * 1024,
          submissionId,
          upload: {
            expiresAt: '2026-07-21T09:05:00.000Z',
            fields: { key: 'voice/object-key', policy: 'signed-policy' },
            method: 'POST',
            url: uploadUrl
          }
        }));
      }
      if (url === uploadUrl) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith(`/voice-submissions/${submissionId}/finalize`)) {
        return Promise.resolve(Response.json({
          completionDraft: {
            aiDisclosure: 'AI_DRAFT_REQUIRES_CAREGIVER_REVIEW',
            noteText: '已送达温水，请值班人员继续观察。',
            requiresCaregiverReview: true,
            voiceSubmissionId: submissionId,
            workOrderId
          },
          submission: { failureCode: null, id: submissionId, status: 'COMPLETED', version: 3 },
          transcript: {}
        }));
      }
      if (url.endsWith('/complete')) {
        return Promise.resolve(Response.json(
          workOrder({
            completedAt: '2026-07-21T09:30:00.000+08:00',
            status: 'COMPLETED',
            version: 6,
            completionChecklistRequired: true,
            requiredCompletionChecklistCodes
          })
        ));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<CaregiverTaskDetail onBack={onBack} workOrderId={workOrderId} />);
    expect(await screen.findByRole('complementary', { name: '本地语音演示说明' })).toHaveTextContent(
      '不会把上传音频当作真实转写结果'
    );
    expect(screen.getByLabelText('文字完成说明')).toBeEnabled();
    const voiceInput = await screen.findByLabelText('选择语音完成记录');
    await user.upload(voiceInput, new File(['voice'], 'completion.wav', { type: 'audio/wav' }));

    expect(await screen.findByText('这是 AI 生成的语音转写草稿')).toBeInTheDocument();
    expect(screen.getByText('必须由护工核对和修改；AI 不会直接完成工单。')).toBeInTheDocument();
    expect(screen.getByLabelText('文字完成说明')).toHaveValue('已送达温水，请值班人员继续观察。');
    expect(screen.getByRole('button', { name: '提交已复核的语音完成记录' })).toBeDisabled();
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toContain(uploadUrl);
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeDisabled();
    expect(screen.getByText(/已生成的语音草稿必须保持可达/)).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '清空草稿并重新填写' }));
    expect(screen.getByLabelText('文字完成说明')).toHaveValue('');
    expect(screen.getByText(/完成记录仍与本次受控语音关联/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交已复核的语音完成记录' })).toBeDisabled();

    await user.type(screen.getByLabelText('文字完成说明'), '已人工重新填写完成说明。');
    await user.click(screen.getByLabelText('已核对服务对象当前反应，并记录需要继续跟进的信息'));
    await user.click(screen.getByLabelText('已核对本次服务实际结果与完成说明一致'));
    await user.click(screen.getByLabelText('已核对需要继续交接或升级的风险事项'));
    await user.click(screen.getByRole('button', { name: '提交已复核的语音完成记录' }));

    const completionCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/complete'));
    expect(completionCall).toBeDefined();
    expect(requestBody(completionCall?.[1])).toEqual(expect.objectContaining({
      noteSource: 'VOICE',
      noteText: '已人工重新填写完成说明。',
      voiceSubmissionId: submissionId,
      completionChecklist: requiredCompletionChecklistCodes.map((code) => ({
        code,
        confirmed: true
      }))
    }));
    expect(screen.getByRole('button', { name: '返回任务列表' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '返回任务列表' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('offers elder verification and rating only from server-backed post-completion state', async () => {
    const user = userEvent.setup();
    let serviceLoads = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/elder/services')) {
        serviceLoads += 1;
        return Promise.resolve(Response.json({
          items: [
            serviceLoads === 1
              ? workOrder({ completedAt: '2026-07-21T09:00:00.000+08:00', status: 'COMPLETED', version: 5 })
              : workOrder({ completedAt: '2026-07-21T09:00:00.000+08:00', status: 'VERIFIED', version: 6 })
          ],
          pageInfo: {}
        }));
      }
      if (url.endsWith('/verify')) {
        return Promise.resolve(Response.json(
          workOrder({ completedAt: '2026-07-21T09:00:00.000+08:00', status: 'VERIFIED', version: 6 })
        ));
      }
      if (url.endsWith('/ratings')) {
        return Promise.resolve(
          Response.json({ id: '00000000-0000-4000-8000-000000000405', score: 5 })
        );
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    render(<ElderServicesPanel />);

    await user.click(await screen.findByRole('button', { name: '确认服务已完成' }));
    expect(await screen.findByRole('button', { name: '5 分' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '5 分' }));
    await user.click(screen.getByRole('button', { name: '提交评价' }));

    expect(await screen.findByText('已评价 5 分')).toBeInTheDocument();
    expect(screen.getByText(/低评分只会进入人工质检，不会自动处罚/)).toBeInTheDocument();
  });

  it('renders only published safe summaries in the family panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000406',
            publishedAt: null,
            serviceCompletedAt: '2026-07-21T08:00:00.000+08:00',
            status: 'DRAFT',
            summary: '内部草稿内容',
            title: '未发布草稿',
            workOrderId
          },
          {
            caregiverLocation: '护工当前位置：三层',
            fullTranscript: '完整对话不应展示',
            id: '00000000-0000-4000-8000-000000000407',
            publishedAt: '2026-07-21T09:15:00.000+08:00',
            serviceCompletedAt: '2026-07-21T09:00:00.000+08:00',
            status: 'PUBLISHED',
            summary: '已送达温水，长者确认服务完成。',
            title: '生活照护已完成',
            workOrderId
          }
        ],
        pageInfo: {}
      })
    );

    render(<FamilySummariesPanel />);

    expect(await screen.findByRole('heading', { name: '生活照护已完成' })).toBeInTheDocument();
    expect(screen.queryByText(/内部草稿|完整对话|护工当前位置/)).not.toBeInTheDocument();
  });
});
