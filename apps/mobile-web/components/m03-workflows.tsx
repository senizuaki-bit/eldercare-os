'use client';

import {
  ArrowLeftOutlined,
  AudioOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CustomerServiceOutlined,
  DisconnectOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LoadingOutlined,
  LockOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  StarFilled,
  WarningOutlined
} from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelElderVoiceSubmission,
  cancelCaregiverCompletionVoice,
  completeCaregiverWorkOrder,
  createCaregiverCompletionVoiceUploadIntent,
  createDemoVoiceSubmission,
  finalizeCaregiverCompletionVoice,
  loadCaregiverWorkOrder,
  loadCaregiverWorkOrders,
  loadElderServices,
  loadFamilySummaries,
  loadVoiceSubmission,
  MobileCareRequestError,
  rateElderWorkOrder,
  requestHumanHelp,
  subscribeCaregiverTaskUpdates,
  transitionCaregiverWorkOrder,
  uploadCaregiverCompletionVoiceFile,
  verifyElderWorkOrder,
  type CaregiverCompletionVoiceUploadIntentView,
  type CompletionChecklistCode,
  type ElderServiceView,
  type ElderVoiceSubmissionView,
  type FamilySummaryView,
  type MobileWorkOrderView
} from './m03-client';
import {
  cancelM03Operation,
  finishM03Operation,
  getOrCreateM03OperationKey
} from './m03-operation-key';

const ELDER_VOICE_DEMO_SCOPE = 'elder:voice-demo';
const ELDER_HUMAN_HELP_SCOPE = 'elder:human-help';
const COMPLETION_VOICE_MAX_BYTES = 10 * 1024 * 1024;
const COMPLETION_VOICE_ACCEPT = 'audio/webm,audio/wav,audio/mpeg,audio/mp4';
const VOICE_TERMINAL_STATUSES: ReadonlySet<ElderVoiceSubmissionView['status']> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED'
]);

const completionChecklistLabels: Record<CompletionChecklistCode, string> = {
  RECIPIENT_STATE_CONFIRMED: '已核对服务对象当前反应，并记录需要继续跟进的信息',
  SERVICE_RESULT_CONFIRMED: '已核对本次服务实际结果与完成说明一致',
  FOLLOW_UP_RISK_REVIEWED: '已核对需要继续交接或升级的风险事项'
};

const operationalAttentionLabels: Readonly<Record<string, string>> = {
  EMERGENCY_CONCERN_REQUIRES_DETERMINISTIC_REVIEW:
    '疑似紧急情况必须按确定性应急规则升级，不由 AI 决定',
  HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW:
    '老人提到身体不适，必须继续由工作人员复核并记录'
};

function operationalAttentionLabel(code: string): string {
  return operationalAttentionLabels[code] ?? '请按机构安全规则完成现场复核与交接';
}

type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'error'; readonly code: string }
  | { readonly status: 'ready'; readonly data: T };

const priorityLabels: Record<MobileWorkOrderView['priority'], string> = {
  IMMEDIATE_REVIEW: '立即人工复核',
  PRIORITY: '优先处理',
  ROUTINE: '常规'
};

const workOrderStatusLabels: Record<MobileWorkOrderView['status'], string> = {
  ACCEPTED: '已接单',
  ASSIGNED: '待接单',
  CANCELLED: '已取消',
  CLOSED: '已关闭',
  COMPLETED: '待确认完成',
  IN_PROGRESS: '处理中',
  NEW: '待分配',
  VERIFIED: '已确认完成'
};

const voiceSubmissionStatusLabels: Record<ElderVoiceSubmissionView['status'], string> = {
  UPLOAD_PENDING: '等待安全上传',
  UPLOADED: '已安全上传',
  PROCESSING: '正在整理',
  COMPLETED: '处理完成',
  FAILED: '处理失败',
  CANCELLED: '已取消'
};

function formatWhen(value: string | null): string {
  if (!value) return '时间待确认';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  }).format(date);
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isVoiceSubmissionTerminal(submission: ElderVoiceSubmissionView): boolean {
  return VOICE_TERMINAL_STATUSES.has(submission.status);
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => !isBrowserOffline());

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}

function useSensitiveNavigationGuard(
  blocked: boolean,
  onNavigationBlockChange?: (blocked: boolean) => void
): void {
  useEffect(() => {
    onNavigationBlockChange?.(blocked);
  }, [blocked, onNavigationBlockChange]);

  useEffect(
    () => () => {
      onNavigationBlockChange?.(false);
    },
    [onNavigationBlockChange]
  );

  useEffect(() => {
    if (!blocked) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [blocked]);
}

function LoadStateCard({
  kind,
  onRetry,
  role = 'status'
}: Readonly<{
  kind: 'loading' | 'offline' | 'error' | 'empty';
  onRetry?: () => void;
  role?: 'alert' | 'status';
}>) {
  const content = {
    empty: {
      description: '服务器当前没有可显示的记录。',
      icon: <FileTextOutlined aria-hidden="true" />,
      title: '暂时没有内容'
    },
    error: {
      description: '没有显示旧数据，也没有把操作标成成功。请稍后重试。',
      icon: <ExclamationCircleOutlined aria-hidden="true" />,
      title: '这次没有加载成功'
    },
    loading: {
      description: '正在从服务器确认最新状态。',
      icon: <LoadingOutlined aria-hidden="true" className="is-spinning" />,
      title: '正在加载'
    },
    offline: {
      description: '断网时不会提交或恢复缓存中的照护结果。连接网络后再试。',
      icon: <DisconnectOutlined aria-hidden="true" />,
      title: '当前处于离线状态'
    }
  }[kind];

  return (
    <section
      aria-busy={kind === 'loading'}
      className={`workflow-state-card is-${kind}`}
      role={kind === 'error' || kind === 'offline' ? 'alert' : role}
    >
      <span className="workflow-state-icon">{content.icon}</span>
      <div>
        <strong>{content.title}</strong>
        <p>{content.description}</p>
      </div>
      {onRetry && kind !== 'loading' ? (
        <button className="secondary-button workflow-retry" onClick={onRetry} type="button">
          <ReloadOutlined aria-hidden="true" />
          重试
        </button>
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof MobileCareRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新进入。';
    if (error.status === 403 || error.status === 404) return '当前账号无权查看或操作这条记录。';
    if (error.status === 409) return '状态刚刚发生变化，请刷新后再操作。';
    if (error.status === 0) return '网络连接不可用，操作没有提交成功。';
  }
  return '服务器没有确认本次操作，请稍后重试。';
}

interface ElderVoiceRequestPageProps {
  readonly initialSubmissionId?: string;
  readonly onExit: () => void;
  readonly onNavigationBlockChange?: (blocked: boolean) => void;
  readonly onSubmissionCreated: (submissionId: string) => void;
}

function voiceOutcome(submission: ElderVoiceSubmissionView): {
  readonly description: string;
  readonly kind: 'processing' | 'review' | 'success' | 'failed' | 'cancelled';
  readonly title: string;
} {
  if (submission.status === 'FAILED') {
    return {
      description: '分析没有完成，系统没有伪造需求或工单。您可以联系工作人员人工登记。',
      kind: 'failed',
      title: '这次没有处理成功'
    };
  }
  if (submission.status === 'CANCELLED') {
    return {
      description: '服务器已确认取消，没有把它标成已提交需求。',
      kind: 'cancelled',
      title: '本次请求已取消'
    };
  }
  if (submission.status !== 'COMPLETED') {
    return {
      description: '语音示例已交给服务器，正在生成可由工作人员复核的结构化草稿。',
      kind: 'processing',
      title: '正在整理您的需求'
    };
  }
  if (
    submission.needs.some(
      (need) => need.requiresHumanReview || need.status === 'REVIEW_REQUIRED'
    )
  ) {
    return {
      description: '确定性安全规则已要求工作人员复核。AI 没有作出医疗或紧急决定。',
      kind: 'review',
      title: '工作人员正在复核'
    };
  }
  return {
    description:
      submission.workOrders.length > 0
        ? '服务器已建立可追踪工单，工作人员可以按权限接单处理。'
        : '服务器已保存可复核需求，后续状态请以工作人员处理结果为准。',
    kind: 'success',
    title: submission.workOrders.length > 0 ? '需求已经成功登记' : '需求草稿已经生成'
  };
}

export function ElderVoiceRequestPage({
  initialSubmissionId,
  onExit,
  onNavigationBlockChange,
  onSubmissionCreated
}: ElderVoiceRequestPageProps) {
  const online = useOnlineStatus();
  const createController = useRef<AbortController | null>(null);
  const createOperationKey = useRef<string | null>(null);
  const endingRef = useRef(false);
  const [submission, setSubmission] = useState<ElderVoiceSubmissionView | null>(null);
  const [loading, setLoading] = useState(Boolean(initialSubmissionId));
  const [submitting, setSubmitting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const [humanHelpState, setHumanHelpState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const navigationBlocked =
    loading ||
    submitting ||
    ending ||
    (submission !== null && !isVoiceSubmissionTerminal(submission));

  useSensitiveNavigationGuard(navigationBlocked, onNavigationBlockChange);

  const refreshSubmission = useCallback(
    async (submissionId: string, signal?: AbortSignal) => {
      try {
        const result = await loadVoiceSubmission(submissionId, signal);
        setSubmission(result);
        setError('');
      } catch (loadError) {
        if (!(loadError instanceof DOMException && loadError.name === 'AbortError')) {
          setError(errorMessage(loadError));
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!initialSubmissionId) return;
    const controller = new AbortController();
    void refreshSubmission(initialSubmissionId, controller.signal);
    return () => controller.abort();
  }, [initialSubmissionId, refreshSubmission]);

  useEffect(() => {
    if (!submission || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(submission.status)) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void refreshSubmission(submission.id, controller.signal);
    }, 1_500);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [refreshSubmission, submission]);

  useEffect(() => () => createController.current?.abort(), []);

  const submitDemo = async () => {
    if (!online) {
      setError('当前离线，演示语句没有上传或提交。');
      return;
    }
    createController.current?.abort();
    const controller = new AbortController();
    createController.current = controller;
    setSubmitting(true);
    setError('');
    const operationKey = getOrCreateM03OperationKey(
      ELDER_VOICE_DEMO_SCOPE,
      'elder-demo-voice'
    );
    createOperationKey.current = operationKey;
    try {
      const created = await createDemoVoiceSubmission(operationKey, controller.signal);
      if (endingRef.current) return;
      finishM03Operation(ELDER_VOICE_DEMO_SCOPE, operationKey);
      createOperationKey.current = null;
      setSubmission(created);
      onSubmissionCreated(created.id);
    } catch (createError) {
      if (!(createError instanceof DOMException && createError.name === 'AbortError')) {
        setError(errorMessage(createError));
      }
    } finally {
      if (createController.current === controller) createController.current = null;
      setSubmitting(false);
    }
  };

  const sendHumanHelp = async () => {
    if (!online) {
      setError('当前离线，人工帮助请求没有发送。');
      return;
    }
    setHumanHelpState('sending');
    setError('');
    const operationKey = getOrCreateM03OperationKey(
      ELDER_HUMAN_HELP_SCOPE,
      'elder-human-help'
    );
    try {
      await requestHumanHelp(operationKey);
      finishM03Operation(ELDER_HUMAN_HELP_SCOPE, operationKey);
      setHumanHelpState('sent');
    } catch (helpError) {
      setHumanHelpState('idle');
      setError(errorMessage(helpError));
    }
  };

  const cancelOrConfirmTerminal = async (
    currentSubmission: ElderVoiceSubmissionView
  ): Promise<ElderVoiceSubmissionView> => {
    let authoritative = currentSubmission;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (isVoiceSubmissionTerminal(authoritative)) return authoritative;
      try {
        return await cancelElderVoiceSubmission(authoritative.id, authoritative.version);
      } catch (cancelError) {
        if (!(cancelError instanceof MobileCareRequestError) || cancelError.status !== 409) {
          throw cancelError;
        }
        authoritative = await loadVoiceSubmission(authoritative.id);
      }
    }
    if (isVoiceSubmissionTerminal(authoritative)) return authoritative;
    throw new MobileCareRequestError(409, 'VOICE_CANCELLATION_NOT_CONFIRMED');
  };

  const endInteraction = async () => {
    if (endingRef.current) return;

    const pendingOperationKey = createOperationKey.current;
    const needsServerConfirmation =
      (submission !== null && !isVoiceSubmissionTerminal(submission)) ||
      (submission === null && (submitting || pendingOperationKey !== null));
    if (needsServerConfirmation && !online) {
      setError('当前离线，无法向服务器确认取消。本次请求仍可能处理中，请联网后重试。');
      return;
    }

    endingRef.current = true;
    setEnding(true);
    setError('');
    createController.current?.abort();
    createController.current = null;

    try {
      let authoritative = submission;
      if (authoritative === null && pendingOperationKey !== null) {
        authoritative = await createDemoVoiceSubmission(pendingOperationKey);
      }
      if (authoritative !== null) {
        authoritative = await cancelOrConfirmTerminal(authoritative);
        if (!isVoiceSubmissionTerminal(authoritative)) {
          throw new MobileCareRequestError(409, 'VOICE_CANCELLATION_NOT_CONFIRMED');
        }
        setSubmission(authoritative);
      }
      if (pendingOperationKey !== null) {
        finishM03Operation(ELDER_VOICE_DEMO_SCOPE, pendingOperationKey);
        createOperationKey.current = null;
      } else if (authoritative === null) {
        cancelM03Operation(ELDER_VOICE_DEMO_SCOPE);
      }
      cancelM03Operation(ELDER_HUMAN_HELP_SCOPE);
      setSubmitting(false);
      onNavigationBlockChange?.(false);
      onExit();
    } catch (cancelError) {
      endingRef.current = false;
      setEnding(false);
      setError(`${errorMessage(cancelError)} 尚未确认取消，请重试或联系工作人员。`);
    }
  };

  const outcome = submission ? voiceOutcome(submission) : null;
  const cancellationRequired =
    submitting || (submission !== null && !isVoiceSubmissionTerminal(submission));

  return (
    <div className="role-page elder-page voice-request-page">
      <div className="workflow-page-heading">
        <button
          aria-label="返回老人端首页"
          className="icon-button"
          disabled={ending}
          onClick={() => void endInteraction()}
          type="button"
        >
          <ArrowLeftOutlined aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">老人端 · 语音需求</p>
          <h1>说出您的需要</h1>
          <p>慢慢说，清楚一点就好。</p>
        </div>
      </div>

      <section className="ai-disclosure" aria-label="AI 身份说明">
        <RobotOutlined className="disclosure-icon" aria-hidden="true" />
        <div>
          <strong>这是 AI 关怀助手</strong>
          <p>AI 只整理需求草稿；安全规则和工作人员负责复核，不提供诊断。</p>
        </div>
      </section>

      {!online ? <LoadStateCard kind="offline" /> : null}

      {!submission && !loading ? (
        <button
          aria-describedby="demo-phrase"
          className="voice-action voice-submit-action"
          disabled={submitting || !online}
          onClick={() => void submitDemo()}
          type="button"
        >
          <span className="voice-icon-wrap" aria-hidden="true">
            {submitting ? <LoadingOutlined className="is-spinning" /> : <AudioOutlined />}
          </span>
          <span className="voice-action-copy">
            <strong>{submitting ? '正在安全上传' : '提交演示语句'}</strong>
            <small>{submitting ? '等待服务器确认，请不要重复点击' : '服务器确认后才会显示成功'}</small>
          </span>
        </button>
      ) : null}

      {loading && !submission ? <LoadStateCard kind="loading" /> : null}

      {submission && outcome ? (
        <section
          className={`voice-outcome-card is-${outcome.kind}`}
          aria-live="polite"
          aria-labelledby="voice-outcome-title"
        >
          <span className="voice-outcome-icon" aria-hidden="true">
            {outcome.kind === 'processing' ? (
              <LoadingOutlined className="is-spinning" />
            ) : outcome.kind === 'failed' || outcome.kind === 'cancelled' ? (
              <CloseCircleOutlined />
            ) : outcome.kind === 'review' ? (
              <SafetyCertificateOutlined />
            ) : (
              <CheckCircleOutlined />
            )}
          </span>
          <div>
            <span className="status-label info-label">
              服务器状态：{voiceSubmissionStatusLabels[submission.status]}
            </span>
            <h2 id="voice-outcome-title">{outcome.title}</h2>
            <p>{outcome.description}</p>
            {submission.needs.length > 0 ? (
              <ul className="voice-need-list" aria-label="服务器生成的需求摘要">
                {submission.needs.map((need) => (
                  <li key={need.id}>
                    <strong>{need.summary}</strong>
                    <span>{need.requiresHumanReview ? '需要人工复核' : '等待工作人员处理'}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {outcome.kind === 'review' || outcome.kind === 'failed' ? (
            <button
              className="secondary-button elder-touch full-width-button"
              onClick={() => void refreshSubmission(submission.id)}
              type="button"
            >
              <ReloadOutlined aria-hidden="true" />
              刷新服务器状态
            </button>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="workflow-alert workflow-alert-error" role="alert">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {humanHelpState === 'sent' ? (
        <div className="workflow-alert workflow-alert-success" role="status">
          <CheckCircleOutlined aria-hidden="true" />
          <span>服务器已确认人工帮助请求。请留意工作人员联系。</span>
        </div>
      ) : null}

      <div className="voice-secondary-actions" aria-label="结束或转人工">
        <button
          className="secondary-button elder-touch"
          disabled={ending}
          onClick={() => void endInteraction()}
          type="button"
        >
          {ending ? (
            <LoadingOutlined aria-hidden="true" className="is-spinning" />
          ) : (
            <CloseCircleOutlined aria-hidden="true" />
          )}
          {ending
            ? '正在向服务器确认取消'
            : cancellationRequired
              ? '结束并取消本次交流'
              : submission
                ? '结束本次交流'
                : '取消并返回'}
        </button>
        <button
          className="human-help-button elder-touch"
          disabled={ending || humanHelpState === 'sending' || humanHelpState === 'sent'}
          onClick={() => void sendHumanHelp()}
          type="button"
        >
          {humanHelpState === 'sending' ? (
            <LoadingOutlined aria-hidden="true" className="is-spinning" />
          ) : (
            <CustomerServiceOutlined aria-hidden="true" />
          )}
          {humanHelpState === 'sent' ? '已联系工作人员' : '联系工作人员'}
        </button>
      </div>

      <section className="privacy-footnote" aria-label="语音隐私说明">
        <LockOutlined aria-hidden="true" />
        <p>演示语句仅用于本次服务请求；真实音频需在同意后通过受控上传处理。</p>
      </section>

      {!submission && !loading ? (
        <section className="demo-phrase-card" id="demo-phrase" aria-label="演示语句">
          <span className="status-label info-label">确定性演示语句</span>
          <blockquote>“我想喝热水，今天有点头晕。”</blockquote>
          <p>“头晕”会进入优先人工复核，不由 AI 判定是否紧急。</p>
        </section>
      ) : null}
    </div>
  );
}

function ElderServiceCard({
  service,
  onChanged
}: Readonly<{ service: ElderServiceView; onChanged: () => void }>) {
  const [score, setScore] = useState<number | null>(null);
  const [recordedScore, setRecordedScore] = useState<number | null>(service.ratingScore);
  const [busy, setBusy] = useState<'verify' | 'rate' | null>(null);
  const [feedback, setFeedback] = useState('');

  const verify = async () => {
    setBusy('verify');
    setFeedback('');
    try {
      await verifyElderWorkOrder(service.id, service.version);
      setFeedback('服务器已确认您认可本次服务完成。');
      onChanged();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const submitRating = async () => {
    if (score === null) return;
    const operationScope = `elder:rating:${service.id}:${service.version}:${score}`;
    const operationKey = getOrCreateM03OperationKey(operationScope, 'elder-rating');
    setBusy('rate');
    setFeedback('');
    try {
      await rateElderWorkOrder(
        service.id,
        service.version,
        score,
        score <= 2,
        operationKey
      );
      finishM03Operation(operationScope, operationKey);
      setRecordedScore(score);
      setFeedback('评价已由服务器记录；低评分只会进入人工质检，不会自动处罚。');
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="service-card elder-service-card">
      <div className="card-title-row">
        <div>
          <span className="status-label success-label">{workOrderStatusLabels[service.status]}</span>
          <h3>{service.title}</h3>
        </div>
        <span className="service-time">{formatWhen(service.completedAt)}</span>
      </div>
      <p>{service.summary}</p>

      {service.canVerify ? (
        <button
          className="primary-button elder-touch full-width-button"
          disabled={busy !== null}
          onClick={() => void verify()}
          type="button"
        >
          {busy === 'verify' ? (
            <LoadingOutlined aria-hidden="true" className="is-spinning" />
          ) : (
            <CheckCircleOutlined aria-hidden="true" />
          )}
          确认服务已完成
        </button>
      ) : null}

      {recordedScore !== null ? (
        <p className="rating-recorded">
          <StarFilled aria-hidden="true" />
          已评价 {recordedScore} 分
        </p>
      ) : service.canRate ? (
        <fieldset className="rating-fieldset">
          <legend>您对这次服务满意吗？</legend>
          <div className="rating-options">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                aria-label={`${value} 分`}
                aria-pressed={score === value}
                className="rating-button"
                key={value}
                onClick={() => setScore(value)}
                type="button"
              >
                <StarFilled aria-hidden="true" />
                <span>{value}</span>
              </button>
            ))}
          </div>
          <p>1 分表示需要跟进，5 分表示非常满意。评分不会自动处罚工作人员。</p>
          <button
            className="primary-button elder-touch full-width-button"
            disabled={score === null || busy !== null}
            onClick={() => void submitRating()}
            type="button"
          >
            {busy === 'rate' ? (
              <LoadingOutlined aria-hidden="true" className="is-spinning" />
            ) : (
              <StarFilled aria-hidden="true" />
            )}
            提交评价
          </button>
        </fieldset>
      ) : null}

      {feedback ? (
        <div className="service-feedback" aria-live="polite" role="status">
          {feedback}
        </div>
      ) : null}
    </article>
  );
}

export function ElderServicesPanel() {
  const online = useOnlineStatus();
  const [state, setState] = useState<LoadState<ElderServiceView[]>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = () => setRequestVersion((value) => value + 1);

  useEffect(() => {
    if (!online) {
      setState({ status: 'offline' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadElderServices(controller.signal)
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ code: errorMessage(error), status: 'error' });
        }
      });
    return () => controller.abort();
  }, [online, requestVersion]);

  return (
    <section className="content-section" aria-labelledby="elder-services-title">
      <div className="section-heading">
        <h2 id="elder-services-title">最近服务</h2>
      </div>
      {state.status === 'loading' ? <LoadStateCard kind="loading" /> : null}
      {state.status === 'offline' ? <LoadStateCard kind="offline" onRetry={retry} /> : null}
      {state.status === 'error' ? <LoadStateCard kind="error" onRetry={retry} /> : null}
      {state.status === 'ready' && state.data.length === 0 ? <LoadStateCard kind="empty" /> : null}
      {state.status === 'ready'
        ? state.data.map((service) => (
            <ElderServiceCard key={service.id} onChanged={retry} service={service} />
          ))
        : null}
    </section>
  );
}

interface CaregiverTasksPanelProps {
  readonly compact?: boolean;
  readonly onOpenAll?: () => void;
  readonly onSelect: (workOrderId: string) => void;
}

function sortedTasks(tasks: readonly MobileWorkOrderView[]): MobileWorkOrderView[] {
  const weights: Record<MobileWorkOrderView['priority'], number> = {
    IMMEDIATE_REVIEW: 0,
    PRIORITY: 1,
    ROUTINE: 2
  };
  return [...tasks].sort((left, right) => {
    const priorityDifference = weights[left.priority] - weights[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    return (left.dueAt ?? '').localeCompare(right.dueAt ?? '');
  });
}

export function CaregiverTasksPanel({ compact = false, onOpenAll, onSelect }: CaregiverTasksPanelProps) {
  const online = useOnlineStatus();
  const [state, setState] = useState<LoadState<MobileWorkOrderView[]>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = () => setRequestVersion((value) => value + 1);

  useEffect(() => {
    if (!online) {
      setState({ status: 'offline' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadCaregiverWorkOrders(controller.signal)
      .then((data) => setState({ data: sortedTasks(data), status: 'ready' }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ code: errorMessage(error), status: 'error' });
        }
      });
    return () => controller.abort();
  }, [online, requestVersion]);

  useEffect(
    () =>
      subscribeCaregiverTaskUpdates(() => {
        setRequestVersion((value) => value + 1);
      }),
    []
  );

  const tasks = state.status === 'ready' && compact ? state.data.slice(0, 2) : state.status === 'ready' ? state.data : [];

  return (
    <section className="content-section" aria-labelledby={compact ? 'caregiver-priority-title' : 'caregiver-tasks-title'}>
      <div className="section-heading">
        <h2 id={compact ? 'caregiver-priority-title' : 'caregiver-tasks-title'}>
          {compact ? '优先任务' : '我的任务'}
        </h2>
        {compact && onOpenAll ? (
          <button className="text-action" onClick={onOpenAll} type="button">
            查看全部
            <RightOutlined aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {state.status === 'loading' ? <LoadStateCard kind="loading" /> : null}
      {state.status === 'offline' ? <LoadStateCard kind="offline" onRetry={retry} /> : null}
      {state.status === 'error' ? <LoadStateCard kind="error" onRetry={retry} /> : null}
      {state.status === 'ready' && tasks.length === 0 ? <LoadStateCard kind="empty" /> : null}
      {tasks.map((task) => (
        <article className={`caregiver-task-card priority-${task.priority.toLowerCase()}`} key={task.id}>
          <div className="card-title-row">
            <span className="status-label warning-label">
              <WarningOutlined aria-hidden="true" />
              {priorityLabels[task.priority]}
            </span>
            <span className="status-label info-label">{workOrderStatusLabels[task.status]}</span>
          </div>
          <h3>{task.title}</h3>
          <p>{task.summary}</p>
          {task.elderDisplayName ? <p className="task-elder-name">服务对象：{task.elderDisplayName}</p> : null}
          {task.locationLabel ? (
            <p className="task-location-label">
              <EnvironmentOutlined aria-hidden="true" />
              {task.locationLabel}
            </p>
          ) : null}
          <div className="task-card-footer">
            <span>
              <ClockCircleOutlined aria-hidden="true" />
              {formatWhen(task.dueAt)}
            </span>
            <button
              aria-label={`查看任务：${task.title}${
                task.elderDisplayName ? `，服务对象 ${task.elderDisplayName}` : ''
              }`}
              className="primary-button"
              onClick={() => onSelect(task.id)}
              type="button"
            >
              查看任务
              <RightOutlined aria-hidden="true" />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

interface CaregiverTaskDetailProps {
  readonly onBack: () => void;
  readonly onNavigationBlockChange?: (blocked: boolean) => void;
  readonly workOrderId: string;
}

interface PendingCompletionAttempt {
  readonly completionChecklist?: readonly CompletionChecklistCode[];
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly noteText: string;
  readonly scope: string;
  readonly voiceSubmissionId?: string;
}

interface PendingCompletionVoiceAttempt {
  readonly file: File;
  readonly idempotencyKey: string;
  readonly intent: CaregiverCompletionVoiceUploadIntentView | null;
  readonly scope: string;
  readonly uploadConfirmed: boolean;
}

interface CompletionVoiceDraft {
  readonly noteText: string;
  readonly voiceSubmissionId: string;
}

export function CaregiverTaskDetail({
  onBack,
  onNavigationBlockChange,
  workOrderId
}: CaregiverTaskDetailProps) {
  const online = useOnlineStatus();
  const [state, setState] = useState<LoadState<MobileWorkOrderView>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completionNote, setCompletionNote] = useState('');
  const [confirmedChecklistCodes, setConfirmedChecklistCodes] =
    useState<CompletionChecklistCode[]>([]);
  const [completionAttempt, setCompletionAttempt] = useState<PendingCompletionAttempt | null>(null);
  const [completionVoiceAttempt, setCompletionVoiceAttempt] =
    useState<PendingCompletionVoiceAttempt | null>(null);
  const [completionVoiceDraft, setCompletionVoiceDraft] = useState<CompletionVoiceDraft | null>(null);
  const [completionReconcilePending, setCompletionReconcilePending] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const voiceFileInput = useRef<HTMLInputElement>(null);
  const retry = () => setRequestVersion((value) => value + 1);
  const navigationBlocked =
    voiceBusy ||
    completionAttempt !== null ||
    completionVoiceAttempt !== null ||
    completionVoiceDraft !== null ||
    completionReconcilePending;

  useSensitiveNavigationGuard(navigationBlocked, onNavigationBlockChange);

  useEffect(() => {
    if (!online) {
      setState({ status: 'offline' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadCaregiverWorkOrder(workOrderId, controller.signal)
      .then((data) => {
        setArrived(Boolean(data.arrivedAt));
        setState({ data, status: 'ready' });
        setCompletionReconcilePending(false);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ code: errorMessage(error), status: 'error' });
        }
      });
    return () => controller.abort();
  }, [online, requestVersion, workOrderId]);

  useEffect(
    () =>
      subscribeCaregiverTaskUpdates((update) => {
        if (update.workOrderId === workOrderId) {
          setRequestVersion((value) => value + 1);
        }
      }),
    [workOrderId]
  );

  const task = state.status === 'ready' ? state.data : null;
  const completionChecklistReady = task === null ||
    !task.completionChecklistRequired ||
    task.requiredCompletionChecklistCodes.every((code) => confirmedChecklistCodes.includes(code));

  useEffect(() => {
    setConfirmedChecklistCodes([]);
  }, [workOrderId]);

  useEffect(() => {
    if (
      task === null ||
      completionAttempt === null ||
      !['COMPLETED', 'VERIFIED', 'CLOSED'].includes(task.status)
    ) {
      return;
    }
    finishM03Operation(completionAttempt.scope, completionAttempt.idempotencyKey);
    setCompletionAttempt(null);
    setCompletionNote('');
    setConfirmedChecklistCodes([]);
    setFeedback('已从服务器确认完成状态，本地重试记录已清除。');
  }, [completionAttempt, task]);

  const runTransition = async (action: 'accept' | 'arrive' | 'start') => {
    if (!task || !online) return;
    setBusy(true);
    setFeedback('');
    try {
      const updated = await transitionCaregiverWorkOrder(task.id, task.version, action);
      if (action === 'arrive') {
        setArrived(true);
        setFeedback('服务器已记录到场；工单状态仍保持“已接单”，可以继续开始处理。');
      } else {
        setFeedback(action === 'accept' ? '服务器已确认接单。' : '服务器已确认开始处理。');
      }
      if (updated) setState({ data: updated, status: 'ready' });
      else retry();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const continueCompletionVoice = async (attempt: PendingCompletionVoiceAttempt) => {
    if (!task || task.status !== 'IN_PROGRESS' || !online) return;
    setVoiceBusy(true);
    setFeedback('');
    try {
      let current = attempt;
      if (!current.uploadConfirmed) {
        const intent = await createCaregiverCompletionVoiceUploadIntent(
          task.id,
          current.file,
          current.idempotencyKey
        );
        current = { ...current, intent };
        setCompletionVoiceAttempt(current);
        await uploadCaregiverCompletionVoiceFile(intent, current.file);
        current = { ...current, uploadConfirmed: true };
        setCompletionVoiceAttempt(current);
      }
      if (current.intent === null) {
        throw new MobileCareRequestError(502, 'VOICE_UPLOAD_INTENT_MISSING');
      }
      const result = await finalizeCaregiverCompletionVoice(
        task.id,
        current.intent.submissionId,
        current.intent.expectedVersion
      );
      if (result.status === 'FAILED' || result.status === 'CANCELLED') {
        finishM03Operation(current.scope, current.idempotencyKey);
        setCompletionVoiceAttempt(null);
        if (voiceFileInput.current) voiceFileInput.current.value = '';
        setFeedback(
          result.status === 'FAILED'
            ? '服务器确认语音处理失败，没有生成完成草稿。您可以重新录音或改用文字。'
            : '服务器确认本次语音已取消。您可以重新录音或改用文字。'
        );
        return;
      }
      if (result.status !== 'COMPLETED' || result.completionDraft === null) {
        throw new MobileCareRequestError(422, result.failureCode ?? 'VOICE_DRAFT_NOT_READY');
      }
      finishM03Operation(current.scope, current.idempotencyKey);
      const draft = {
        noteText: result.completionDraft.noteText,
        voiceSubmissionId: result.completionDraft.voiceSubmissionId
      };
      setCompletionVoiceDraft(draft);
      setCompletionNote(draft.noteText);
      setCompletionVoiceAttempt(null);
      if (voiceFileInput.current) voiceFileInput.current.value = '';
      setFeedback('AI 已生成完成说明草稿，请核对并修改后再提交。');
    } catch (error) {
      setFeedback(`${errorMessage(error)} 已保留本次语音操作，可重试或取消。`);
    } finally {
      setVoiceBusy(false);
    }
  };

  const selectCompletionVoice = (file: File | undefined) => {
    if (
      !task ||
      file === undefined ||
      voiceBusy ||
      completionAttempt !== null ||
      completionVoiceAttempt !== null ||
      completionVoiceDraft !== null
    ) {
      return;
    }
    if (!COMPLETION_VOICE_ACCEPT.split(',').includes(file.type) || file.size < 1) {
      setFeedback('请选择 webm、wav、mp3 或 mp4 格式的有效语音文件。');
      return;
    }
    if (file.size > COMPLETION_VOICE_MAX_BYTES) {
      setFeedback('语音文件不能超过 10 MB。');
      return;
    }
    const scope = `caregiver:completion-voice:${task.id}:${task.version}:${file.type}:${file.size}`;
    const attempt: PendingCompletionVoiceAttempt = {
      file,
      idempotencyKey: getOrCreateM03OperationKey(scope, 'caregiver-completion-voice'),
      intent: null,
      scope,
      uploadConfirmed: false
    };
    setCompletionVoiceAttempt(attempt);
    void continueCompletionVoice(attempt);
  };

  const cancelCompletionVoice = async (): Promise<boolean> => {
    if (!task || completionVoiceAttempt === null) return false;
    if (!online) {
      setFeedback('当前离线，无法向服务器确认取消。请联网后重试。');
      return false;
    }
    setVoiceBusy(true);
    setFeedback('');
    try {
      const intent = completionVoiceAttempt.intent ??
        await createCaregiverCompletionVoiceUploadIntent(
          task.id,
          completionVoiceAttempt.file,
          completionVoiceAttempt.idempotencyKey
        );
      const cancelled = await cancelCaregiverCompletionVoice(
        task.id,
        intent.submissionId,
        intent.expectedVersion
      );
      if (cancelled.status !== 'CANCELLED') {
        throw new MobileCareRequestError(409, 'VOICE_CANCELLATION_NOT_CONFIRMED');
      }
      cancelM03Operation(completionVoiceAttempt.scope);
      setCompletionVoiceAttempt(null);
      if (voiceFileInput.current) voiceFileInput.current.value = '';
      setFeedback('服务器已确认取消本次语音上传。');
      return true;
    } catch (error) {
      setFeedback(`${errorMessage(error)} 语音记录尚未确认取消，请稍后重试。`);
      return false;
    } finally {
      setVoiceBusy(false);
    }
  };

  const leaveTaskDetail = async () => {
    if (voiceBusy) {
      setFeedback('语音正在受控上传或处理中，请等待完成后提交，或在失败后取消本次语音。');
      return;
    }
    if (completionAttempt !== null || completionReconcilePending) {
      setFeedback('完成提交尚未与服务器核对清楚，请先放弃本地重试并等待状态刷新。');
      return;
    }
    if (completionVoiceDraft !== null) {
      setFeedback('已生成的语音草稿仍与受控语音记录关联，请核对并提交完成记录后再返回。');
      return;
    }
    if (completionVoiceAttempt !== null && !(await cancelCompletionVoice())) return;
    onNavigationBlockChange?.(false);
    onBack();
  };

  const completeTask = async () => {
    if (!task || !online) return;
    if (completionVoiceAttempt !== null) {
      setFeedback('请先重试或取消当前语音上传，再提交完成记录。');
      return;
    }
    if (!completionChecklistReady) {
      setFeedback('这是安全规则标记的高风险工单，请逐项核对完成清单后再提交。');
      return;
    }
    let attempt = completionAttempt;
    if (attempt === null) {
      const noteText = completionNote.trim();
      if (noteText.length === 0) return;
      const voiceSubmissionId = completionVoiceDraft?.voiceSubmissionId;
      const scope = `caregiver:completion:${task.id}:${task.version}:${voiceSubmissionId ?? 'text'}`;
      attempt = {
        ...(task.completionChecklistRequired
          ? { completionChecklist: [...task.requiredCompletionChecklistCodes] }
          : {}),
        expectedVersion: task.version,
        idempotencyKey: getOrCreateM03OperationKey(scope, 'caregiver-completion'),
        noteText,
        scope,
        ...(voiceSubmissionId === undefined ? {} : { voiceSubmissionId })
      };
      setCompletionAttempt(attempt);
    }
    setBusy(true);
    setFeedback('');
    try {
      const updated = await completeCaregiverWorkOrder(
        task.id,
        attempt.expectedVersion,
        attempt.noteText,
        attempt.idempotencyKey,
        attempt.voiceSubmissionId,
        attempt.completionChecklist
      );
      finishM03Operation(attempt.scope, attempt.idempotencyKey);
      setCompletionAttempt(null);
      setFeedback(
        attempt.voiceSubmissionId
          ? '服务器已保存经护工复核的语音完成记录，等待后续确认。'
          : '服务器已保存文字完成记录，等待后续确认。'
      );
      setCompletionNote('');
      setConfirmedChecklistCodes([]);
      setCompletionVoiceDraft(null);
      if (updated) setState({ data: updated, status: 'ready' });
      else retry();
    } catch (error) {
      setFeedback(`${errorMessage(error)} 再次提交会沿用同一个操作编号。`);
    } finally {
      setBusy(false);
    }
  };

  const cancelCompletionRetry = () => {
    if (completionAttempt === null) return;
    cancelM03Operation(completionAttempt.scope);
    setCompletionAttempt(null);
    setCompletionReconcilePending(true);
    setFeedback('已放弃本地重试，正在重新核对服务器状态。');
    retry();
  };

  const backDisabledReason = voiceBusy
    ? '语音正在受控上传或处理中，请等待完成；如果失败，请先取消本次语音。'
    : completionAttempt !== null || completionReconcilePending
      ? '完成提交尚未与服务器核对清楚，请先放弃本地重试并等待状态刷新。'
      : completionVoiceDraft !== null
        ? '已生成的语音草稿必须保持可达。请核对并提交完成记录后再返回。'
        : null;

  return (
    <div className="role-page caregiver-task-detail">
      <div className="workflow-page-heading">
        <button
          aria-describedby={backDisabledReason ? 'caregiver-back-guidance' : undefined}
          aria-label="返回任务列表"
          className="icon-button"
          disabled={backDisabledReason !== null}
          onClick={() => void leaveTaskDetail()}
          type="button"
        >
          <ArrowLeftOutlined aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">护工端 · 任务详情</p>
          <h1>任务详情</h1>
          <p>每一步都需要服务器确认。</p>
        </div>
      </div>

      {backDisabledReason ? (
        <div
          className="workflow-alert workflow-alert-info"
          id="caregiver-back-guidance"
          role="status"
        >
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>{backDisabledReason}</span>
        </div>
      ) : null}

      {state.status === 'loading' ? <LoadStateCard kind="loading" /> : null}
      {state.status === 'offline' ? <LoadStateCard kind="offline" onRetry={retry} /> : null}
      {state.status === 'error' ? <LoadStateCard kind="error" onRetry={retry} /> : null}

      {task ? (
        <article className="task-detail-card">
          <div className="card-title-row">
            <span className="status-label warning-label">{priorityLabels[task.priority]}</span>
            <span className="status-label info-label">{workOrderStatusLabels[task.status]}</span>
          </div>
          <h2>{task.title}</h2>
          <p className="task-detail-summary">{task.summary}</p>
          <dl className="task-detail-facts">
            {task.elderDisplayName ? (
              <div>
                <dt>服务对象</dt>
                <dd>{task.elderDisplayName}</dd>
              </div>
            ) : null}
            {task.locationLabel ? (
              <div>
                <dt>房间信息</dt>
                <dd>{task.locationLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>处理时限</dt>
              <dd>{formatWhen(task.dueAt)}</dd>
            </div>
            <div>
              <dt>工单编号</dt>
              <dd>{task.code ?? task.id.slice(0, 8)}</dd>
            </div>
          </dl>

          {task.operationalAttention.length > 0 ? (
            <section className="task-attention" aria-labelledby="task-attention-title">
              <SafetyCertificateOutlined aria-hidden="true" />
              <div>
                <h3 id="task-attention-title">完成任务所需注意事项</h3>
                <ul>
                  {task.operationalAttention.map((item) => (
                    <li key={item} title={item}>{operationalAttentionLabel(item)}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {task.status === 'ASSIGNED' ? (
            <button
              className="primary-button full-width-button"
              disabled={busy || !online}
              onClick={() => void runTransition('accept')}
              type="button"
            >
              {busy ? (
                <LoadingOutlined aria-hidden="true" className="is-spinning" />
              ) : (
                <CheckCircleOutlined aria-hidden="true" />
              )}
              接单
            </button>
          ) : null}

          {task.status === 'ACCEPTED' && !arrived ? (
            <button
              className="primary-button full-width-button"
              disabled={busy || !online}
              onClick={() => void runTransition('arrive')}
              type="button"
            >
              {busy ? (
                <LoadingOutlined aria-hidden="true" className="is-spinning" />
              ) : (
                <EnvironmentOutlined aria-hidden="true" />
              )}
              确认到场
            </button>
          ) : null}

          {task.status === 'ACCEPTED' && arrived ? (
            <button
              className="primary-button full-width-button"
              disabled={busy || !online}
              onClick={() => void runTransition('start')}
              type="button"
            >
              {busy ? (
                <LoadingOutlined aria-hidden="true" className="is-spinning" />
              ) : (
                <ClockCircleOutlined aria-hidden="true" />
              )}
              开始处理
            </button>
          ) : null}

          {task.status === 'IN_PROGRESS' ? (
            <section className="completion-form" aria-labelledby="completion-title">
              <h3 id="completion-title">提交完成记录</h3>
              {task.completionChecklistRequired ? (
                <fieldset className="completion-checklist">
                  <legend>高风险工单完成核对</legend>
                  <p>请按现场事实逐项核对。清单用于交接与审计，不替代医学判断或应急处置。</p>
                  {task.requiredCompletionChecklistCodes.map((code) => (
                    <label key={code}>
                      <input
                        checked={confirmedChecklistCodes.includes(code)}
                        disabled={busy || completionAttempt !== null}
                        onChange={(event) => {
                          setConfirmedChecklistCodes((current) => event.target.checked
                            ? [...current, code]
                            : current.filter((item) => item !== code));
                        }}
                        type="checkbox"
                      />
                      <span>{completionChecklistLabels[code]}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label htmlFor="completion-note">文字完成说明</label>
              <textarea
                disabled={
                  completionAttempt !== null || completionVoiceAttempt !== null || voiceBusy
                }
                id="completion-note"
                maxLength={2000}
                onChange={(event) => setCompletionNote(event.target.value)}
                placeholder="请说明已完成的服务和需要继续跟进的事项"
                rows={5}
                value={completionNote}
              />
              {completionVoiceDraft ? (
                <div className="completion-ai-draft" role="status">
                  <RobotOutlined aria-hidden="true" />
                  <div>
                    <strong>这是 AI 生成的语音转写草稿</strong>
                    <p>必须由护工核对和修改；AI 不会直接完成工单。</p>
                    <button
                      className="text-action"
                      disabled={busy}
                      onClick={() => {
                        setCompletionNote('');
                        setFeedback(
                          '已清空 AI 草稿。完成记录仍与本次受控语音关联，请重新填写并提交。'
                        );
                      }}
                      type="button"
                    >
                      清空草稿并重新填写
                    </button>
                  </div>
                </div>
              ) : null}
              <aside
                aria-label="本地语音演示说明"
                className="completion-demo-disclosure"
              >
                <strong>本地演示使用固定示例草稿</strong>
                <p>
                  当前无付费密钥模式只验证受控上传与人工复核流程，不会把上传音频当作真实转写结果。
                  您仍可改用文字，且提交前必须核对并修改草稿。
                </p>
              </aside>
              <label
                className={`secondary-button full-width-button controlled-voice-entry${
                  voiceBusy ||
                  completionAttempt !== null ||
                  completionVoiceAttempt !== null ||
                  completionVoiceDraft !== null
                    ? ' is-disabled'
                    : ''
                }`}
                htmlFor="completion-voice-file"
              >
                {voiceBusy ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <AudioOutlined aria-hidden="true" />
                )}
                {voiceBusy
                  ? '正在受控上传并生成草稿'
                  : completionVoiceAttempt
                    ? '请先重试或取消当前语音'
                    : completionVoiceDraft
                      ? '请先提交当前语音草稿'
                      : '选择语音完成记录'}
              </label>
              <input
                accept={COMPLETION_VOICE_ACCEPT}
                className="completion-voice-file"
                disabled={
                  voiceBusy ||
                  completionAttempt !== null ||
                  completionVoiceAttempt !== null ||
                  completionVoiceDraft !== null
                }
                id="completion-voice-file"
                onChange={(event) => selectCompletionVoice(event.target.files?.[0])}
                ref={voiceFileInput}
                type="file"
              />
              {completionVoiceAttempt ? (
                <div className="completion-retry-actions">
                  <button
                    className="secondary-button"
                    disabled={voiceBusy || !online}
                    onClick={() => void continueCompletionVoice(completionVoiceAttempt)}
                    type="button"
                  >
                    <ReloadOutlined aria-hidden="true" />
                    重试语音上传或处理
                  </button>
                  <button
                    className="text-action"
                    disabled={voiceBusy || !online}
                    onClick={() => void cancelCompletionVoice()}
                    type="button"
                  >
                    取消本次语音上传
                  </button>
                </div>
              ) : null}
              <button
                className="primary-button full-width-button"
                disabled={
                  busy ||
                  voiceBusy ||
                  completionVoiceAttempt !== null ||
                  !completionChecklistReady ||
                  (!completionAttempt && completionNote.trim().length === 0) ||
                  !online
                }
                onClick={() => void completeTask()}
                type="button"
              >
                {busy ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <CheckCircleOutlined aria-hidden="true" />
                )}
                {completionAttempt
                  ? '重试同一次完成提交'
                  : completionVoiceDraft
                    ? '提交已复核的语音完成记录'
                    : '提交文字完成记录'}
              </button>
              {completionAttempt ? (
                <button
                  className="text-action completion-cancel-retry"
                  disabled={busy}
                  onClick={cancelCompletionRetry}
                  type="button"
                >
                  放弃本地重试并刷新服务器状态
                </button>
              ) : null}
            </section>
          ) : null}

          {feedback ? (
            <div className="workflow-alert workflow-alert-info" aria-live="polite" role="status">
              <CheckCircleOutlined aria-hidden="true" />
              <span>{feedback}</span>
            </div>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}

export function FamilySummariesPanel() {
  const online = useOnlineStatus();
  const [state, setState] = useState<LoadState<FamilySummaryView[]>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = () => setRequestVersion((value) => value + 1);

  useEffect(() => {
    if (!online) {
      setState({ status: 'offline' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadFamilySummaries(controller.signal)
      .then((data) => setState({ data, status: 'ready' }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ code: errorMessage(error), status: 'error' });
        }
      });
    return () => controller.abort();
  }, [online, requestVersion]);

  return (
    <section className="content-section" aria-labelledby="family-summaries-title">
      <div className="section-heading">
        <h2 id="family-summaries-title">已发布照护摘要</h2>
      </div>
      {state.status === 'loading' ? <LoadStateCard kind="loading" /> : null}
      {state.status === 'offline' ? <LoadStateCard kind="offline" onRetry={retry} /> : null}
      {state.status === 'error' ? <LoadStateCard kind="error" onRetry={retry} /> : null}
      {state.status === 'ready' && state.data.length === 0 ? (
        <section className="workflow-state-card" role="status">
          <span className="workflow-state-icon"><LockOutlined aria-hidden="true" /></span>
          <div>
            <strong>暂无已发布摘要</strong>
            <p>草稿、已撤回内容以及内部记录不会出现在家属端。</p>
          </div>
        </section>
      ) : null}
      {state.status === 'ready'
        ? state.data.map((summary) => (
            <article className="published-summary-card" key={summary.id}>
              <div className="card-title-row">
                <span className="status-label success-label">
                  <CheckCircleOutlined aria-hidden="true" />
                  已发布安全摘要
                </span>
                <time dateTime={summary.publishedAt}>{formatWhen(summary.publishedAt)}</time>
              </div>
              <h3>{summary.title}</h3>
              <p>{summary.summary}</p>
              <p className="summary-completed-time">
                服务完成：{formatWhen(summary.serviceCompletedAt)}
              </p>
            </article>
          ))
        : null}
    </section>
  );
}
