import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelCaregiverCompletionVoice,
  cancelElderVoiceSubmission,
  completeCaregiverWorkOrder,
  createCaregiverCompletionVoiceUploadIntent,
  createDemoVoiceSubmission,
  finalizeCaregiverCompletionVoice,
  loadCaregiverWorkOrder,
  loadCaregiverWorkOrders,
  loadElderServices,
  loadFamilySummaries,
  loadVoiceSubmission,
  rateElderWorkOrder,
  requestHumanHelp,
  subscribeCaregiverTaskUpdates,
  transitionCaregiverWorkOrder,
  uploadCaregiverCompletionVoiceFile,
  type MobileCareRequestError
} from './m03-client';
import {
  finishM03Operation,
  getOrCreateM03OperationKey
} from './m03-operation-key';

const workOrderId = '00000000-0000-4000-8000-000000000301';
const submissionId = '00000000-0000-4000-8000-000000000302';

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    arrivedAt: null,
    code: 'WO-20260721-001',
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  document.cookie = 'eldercare_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('M03 mobile client', () => {
  it('uses the elder portal route and sends a CSRF-protected deterministic demo request', async () => {
    document.cookie = 'eldercare_csrf=m03-csrf; path=/';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        analysis: {},
        needs: [
          {
            id: '00000000-0000-4000-8000-000000000303',
            priority: 'PRIORITY',
            requiresHumanReview: true,
            status: 'REVIEW_REQUIRED',
            summary: '头晕反馈需要人工复核'
          }
        ],
        submission: { id: submissionId, status: 'COMPLETED', version: 3 },
        transcript: {},
        workOrder: workOrder()
      })
    );

    const result = await createDemoVoiceSubmission('voice-demo-test-key');

    expect(result.id).toBe(submissionId);
    expect(result.needs[0]?.requiresHumanReview).toBe(true);
    expect(result.workOrders[0]?.id).toBe(workOrderId);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:4000/elder/voice-submissions/demo');
    expect(init).toEqual(expect.objectContaining({ credentials: 'include', method: 'POST' }));
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('m03-csrf');
    expect(requestBody(init)).toEqual(
      expect.objectContaining({ fixtureKey: 'HOT_WATER_DIZZINESS_V1' })
    );
  });

  it('reuses the persisted voice-request key after a lost response', async () => {
    const requestBodies: unknown[] = [];
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestBodies.push(requestBody(init));
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('response lost'));
      return Promise.resolve(
        Response.json({
          analysis: {},
          needs: [],
          submission: { id: submissionId, status: 'COMPLETED', version: 3 },
          transcript: {},
          workOrder: workOrder()
        })
      );
    });
    const scope = 'test:voice-lost-response';
    const firstKey = getOrCreateM03OperationKey(scope, 'elder-demo-voice');

    await expect(createDemoVoiceSubmission(firstKey)).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE'
    });
    const retryKey = getOrCreateM03OperationKey(scope, 'elder-demo-voice');
    await createDemoVoiceSubmission(retryKey);
    finishM03Operation(scope, retryKey);

    expect(retryKey).toBe(firstKey);
    expect(requestBodies).toEqual([
      {
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey: firstKey,
      },
      {
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
        idempotencyKey: firstKey,
      }
    ]);
  });

  it('cancels an elder voice submission with its authoritative version', async () => {
    document.cookie = 'eldercare_csrf=m03-csrf; path=/';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ id: submissionId, status: 'CANCELLED', version: 4 })
    );

    const result = await cancelElderVoiceSubmission(submissionId, 3);

    expect(result).toEqual(expect.objectContaining({
      id: submissionId,
      status: 'CANCELLED',
      version: 4
    }));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/elder/voice-submissions/${submissionId}/cancel`);
    expect(init).toEqual(expect.objectContaining({ credentials: 'include', method: 'POST' }));
    expect(requestBody(init)).toEqual({
      expectedVersion: 3,
      reasonCode: 'ELDER_CANCELLED_VOICE_REQUEST'
    });
  });

  it('returns the authoritative caregiver voice cancellation state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ id: submissionId, status: 'CANCELLED', version: 2 })
    );

    const result = await cancelCaregiverCompletionVoice(workOrderId, submissionId, 1);

    expect(result).toEqual(expect.objectContaining({
      id: submissionId,
      status: 'CANCELLED',
      version: 2
    }));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      `http://127.0.0.1:4000/caregiver/work-orders/${workOrderId}/voice-submissions/${submissionId}/cancel`
    );
    expect(requestBody(init)).toEqual({
      expectedVersion: 1,
      reasonCode: 'CAREGIVER_CANCELLED_COMPLETION_VOICE'
    });
  });

  it('reuses the persisted manual-need key after a lost human-help response', async () => {
    const requestBodies: unknown[] = [];
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestBodies.push(requestBody(init));
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('response lost'));
      return Promise.resolve(
        Response.json({ humanReviewRequired: true, need: {}, workOrder: null })
      );
    });
    const scope = 'test:manual-need-lost-response';
    const firstKey = getOrCreateM03OperationKey(scope, 'elder-human-help');

    await expect(requestHumanHelp(firstKey)).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE'
    });
    const retryKey = getOrCreateM03OperationKey(scope, 'elder-human-help');
    await requestHumanHelp(retryKey);
    finishM03Operation(scope, retryKey);

    expect(retryKey).toBe(firstKey);
    expect(requestBodies).toEqual([
      {
        idempotencyKey: firstKey,
        reasonCode: 'ELDER_REQUESTED_HUMAN_HELP'
      },
      {
        idempotencyKey: firstKey,
        reasonCode: 'ELDER_REQUESTED_HUMAN_HELP'
      }
    ]);
  });

  it('reuses the persisted rating key after a lost response', async () => {
    const requestBodies: unknown[] = [];
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestBodies.push(requestBody(init));
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('response lost'));
      return Promise.resolve(
        Response.json({ id: '00000000-0000-4000-8000-000000000399', score: 5 })
      );
    });
    const scope = `test:rating-lost-response:${workOrderId}:5`;
    const firstKey = getOrCreateM03OperationKey(scope, 'elder-rating');

    await expect(rateElderWorkOrder(workOrderId, 4, 5, false, firstKey)).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE'
    });
    const retryKey = getOrCreateM03OperationKey(scope, 'elder-rating');
    await rateElderWorkOrder(workOrderId, 4, 5, false, retryKey);
    finishM03Operation(scope, retryKey);

    expect(retryKey).toBe(firstKey);
    expect(requestBodies).toEqual([
      expect.objectContaining({ idempotencyKey: firstKey }),
      expect.objectContaining({ idempotencyKey: firstKey })
    ]);
  });

  it('reuses the persisted caregiver-completion key after a lost response', async () => {
    const requestBodies: unknown[] = [];
    let attempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestBodies.push(requestBody(init));
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('response lost'));
      return Promise.resolve(
        Response.json(workOrder({ completedAt: '2026-07-21T09:30:00.000+08:00', status: 'COMPLETED', version: 6 }))
      );
    });
    const scope = `test:caregiver-completion-lost-response:${workOrderId}:5`;
    const firstKey = getOrCreateM03OperationKey(scope, 'caregiver-completion');
    const completionChecklist = [
      'RECIPIENT_STATE_CONFIRMED',
      'SERVICE_RESULT_CONFIRMED',
      'FOLLOW_UP_RISK_REVIEWED'
    ] as const;

    await expect(
      completeCaregiverWorkOrder(
        workOrderId,
        5,
        '已送达温水并继续观察。',
        firstKey,
        undefined,
        completionChecklist
      )
    ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    const retryKey = getOrCreateM03OperationKey(scope, 'caregiver-completion');
    await completeCaregiverWorkOrder(
      workOrderId,
      5,
      '已送达温水并继续观察。',
      retryKey,
      undefined,
      completionChecklist
    );
    finishM03Operation(scope, retryKey);

    expect(retryKey).toBe(firstKey);
    expect(requestBodies).toEqual([
      {
        expectedVersion: 5,
        idempotencyKey: firstKey,
        noteSource: 'TEXT',
        noteText: '已送达温水并继续观察。',
        reasonCode: 'CAREGIVER_COMPLETED',
        completionChecklist: completionChecklist.map((code) => ({ code, confirmed: true }))
      },
      {
        expectedVersion: 5,
        idempotencyKey: firstKey,
        noteSource: 'TEXT',
        noteText: '已送达温水并继续观察。',
        reasonCode: 'CAREGIVER_COMPLETED',
        completionChecklist: completionChecklist.map((code) => ({ code, confirmed: true }))
      }
    ]);
  });

  it('uses the controlled caregiver completion-audio upload and finalize routes', async () => {
    const file = new File(['voice'], 'completion.wav', { type: 'audio/wav' });
    const uploadUrl = 'http://127.0.0.1:9000/eldercare-voice';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
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
            noteText: '已送达温水，请继续观察。',
            requiresCaregiverReview: true,
            voiceSubmissionId: submissionId,
            workOrderId
          },
          submission: { failureCode: null, id: submissionId, status: 'COMPLETED', version: 3 },
          transcript: {}
        }));
      }
      return Promise.resolve(Response.json({}, { status: 404 }));
    });

    const intent = await createCaregiverCompletionVoiceUploadIntent(
      workOrderId,
      file,
      'caregiver-completion-voice-test-key'
    );
    await uploadCaregiverCompletionVoiceFile(intent, file);
    const result = await finalizeCaregiverCompletionVoice(
      workOrderId,
      intent.submissionId,
      intent.expectedVersion
    );

    expect(result.completionDraft?.noteText).toBe('已送达温水，请继续观察。');
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      `http://127.0.0.1:4000/caregiver/work-orders/${workOrderId}/voice-submissions/upload-intents`,
      uploadUrl,
      `http://127.0.0.1:4000/caregiver/work-orders/${workOrderId}/voice-submissions/${submissionId}/finalize`
    ]);
    expect(requestBody(fetchMock.mock.calls[0]?.[1])).toEqual({
      fixtureKey: 'CARE_COMPLETION_V1',
      idempotencyKey: 'caregiver-completion-voice-test-key',
      mimeType: 'audio/wav',
      sizeBytes: file.size
    });
    const uploadInit = fetchMock.mock.calls[1]?.[1];
    expect(uploadInit).toEqual(expect.objectContaining({ credentials: 'omit', method: 'POST' }));
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect((uploadInit?.body as FormData).get('file')).toBe(file);
    expect(requestBody(fetchMock.mock.calls[2]?.[1])).toEqual({ expectedVersion: 1 });
  });

  it('uses only the existing portal-style endpoint families', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/elder/voice-submissions/human-help')) {
        return Promise.resolve(
          Response.json({ humanReviewRequired: true, need: {}, workOrder: null })
        );
      }
      if (url.endsWith(`/elder/voice-submissions/${submissionId}`)) {
        return Promise.resolve(
          Response.json({ id: submissionId, status: 'PROCESSING', version: 1 })
        );
      }
      if (url.endsWith('/elder/services') || url.endsWith('/caregiver/work-orders')) {
        return Promise.resolve(Response.json({ items: [], pageInfo: {} }));
      }
      if (url.endsWith(`/caregiver/work-orders/${workOrderId}`)) {
        return Promise.resolve(Response.json(workOrder()));
      }
      return Promise.resolve(Response.json({ items: [], pageInfo: {} }));
    });

    await requestHumanHelp('human-help-test-key');
    await loadVoiceSubmission(submissionId);
    await loadElderServices();
    await loadCaregiverWorkOrders();
    await loadCaregiverWorkOrder(workOrderId);
    await loadFamilySummaries();

    expect(fetchMock.mock.calls.map(([url]) => requestUrl(url))).toEqual([
      'http://127.0.0.1:4000/elder/voice-submissions/human-help',
      `http://127.0.0.1:4000/elder/voice-submissions/${submissionId}`,
      'http://127.0.0.1:4000/elder/services',
      'http://127.0.0.1:4000/caregiver/work-orders',
      `http://127.0.0.1:4000/caregiver/work-orders/${workOrderId}`,
      'http://127.0.0.1:4000/family/summaries'
    ]);
    expect(fetchMock.mock.calls.every(([url]) => !requestUrl(url).includes('/api/v1'))).toBe(true);
  });

  it('accepts an audited arrival response without inventing an ARRIVED work-order state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        arrivedAt: '2026-07-21T09:12:00.000+08:00',
        toVersion: 4,
        workOrderId
      })
    );

    await expect(transitionCaregiverWorkOrder(workOrderId, 3, 'arrive')).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`http://127.0.0.1:4000/caregiver/work-orders/${workOrderId}/arrive`);
    expect(requestBody(init)).toEqual({
      expectedVersion: 3,
      reasonCode: 'CAREGIVER_ARRIVED'
    });
  });

  it('subscribes to the scoped caregiver SSE stream and ignores malformed events', () => {
    const close = vi.fn();
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      onerror: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onopen: (() => void) | null = null;
      readonly url: string;
      readonly withCredentials: boolean;

      constructor(url: string | URL, init?: EventSourceInit) {
        this.url = typeof url === 'string' ? url : url.href;
        this.withCredentials = init?.withCredentials ?? false;
        instances.push(this);
      }

      close(): void {
        close();
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onUpdate = vi.fn();
    const onConnectionChange = vi.fn();

    const unsubscribe = subscribeCaregiverTaskUpdates(onUpdate, onConnectionChange);
    const source = instances[0];
    expect(source).toBeDefined();
    expect(source?.url).toBe('http://127.0.0.1:4000/caregiver/task-updates');
    expect(source?.withCredentials).toBe(true);

    source?.onopen?.();
    source?.onmessage?.(new MessageEvent('message', { data: '{not-json' }));
    source?.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ eventId: 'missing-fields' })
      })
    );
    source?.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'task-update-0001',
          eventType: 'WORK_ORDER.ARRIVED',
          occurredAt: '2026-07-21T09:12:00.000+08:00',
          status: 'ACCEPTED',
          version: 4,
          workOrderId
        })
      })
    );

    expect(onConnectionChange).toHaveBeenCalledWith('open');
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'WORK_ORDER.ARRIVED', workOrderId })
    );
    unsubscribe();
    expect(close).toHaveBeenCalledOnce();
  });

  it('projects only published family-safe fields and discards sensitive extras', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000304',
            publishedAt: null,
            serviceCompletedAt: '2026-07-21T08:30:00.000+08:00',
            status: 'DRAFT',
            summary: '不应显示的草稿',
            title: '草稿',
            workOrderId
          },
          {
            caregiverLocation: '三层走廊',
            fullTranscript: '不应进入客户端结果',
            id: '00000000-0000-4000-8000-000000000305',
            publishedAt: '2026-07-21T09:30:00.000+08:00',
            rawAudioUrl: 'https://invalid.example/audio',
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

    const summaries = await loadFamilySummaries();

    expect(summaries).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000305',
        publishedAt: '2026-07-21T09:30:00.000+08:00',
        serviceCompletedAt: '2026-07-21T09:00:00.000+08:00',
        status: 'PUBLISHED',
        summary: '已送达温水，长者确认服务完成。',
        title: '生活照护已完成',
        workOrderId
      }
    ]);
    expect(JSON.stringify(summaries)).not.toMatch(/rawAudio|Transcript|caregiverLocation/);
  });

  it('reports network failure instead of returning fake success data', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(loadCaregiverWorkOrders()).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      status: 0
    } satisfies Partial<MobileCareRequestError>);
  });
});
