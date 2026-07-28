'use client';

import {
  AlertFilled,
  ArrowLeftOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DisconnectOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  LockOutlined,
  PhoneOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ElderEmergencyStatus } from '@eldercare/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';

import {
  createElderEmergency,
  loadCaregiverEmergencies,
  loadCaregiverEmergency,
  loadElderEmergency,
  loadFamilyEmergencyPreference,
  loadFamilyEmergencySummaries,
  resolveCaregiverEmergency,
  transitionCaregiverEmergency,
  updateFamilyEmergencyPreference,
  type FamilyEmergencyPreferenceView,
  type FamilyEmergencySummaryView,
  type MobileEmergencyLocation,
  type MobileEmergencyStatus,
  type MobileEmergencyView
} from './m04-client';
import { loadFamilyElders } from './m02-client';
import { MobileCareRequestError } from './m03-client';

const statusLabels: Record<MobileEmergencyStatus, string> = {
  OPEN: '等待工作人员确认',
  ACKNOWLEDGED: '工作人员已确认',
  RESPONDING: '工作人员正在响应',
  RESOLVED: '现场处置已完成',
  REVIEWED: '主管复盘已完成'
};

const reasonLabels: Readonly<Record<string, string>> = {
  ELDER_BUTTON_PRESSED: '老人主动按下紧急求助',
  IOT_EMERGENCY_BUTTON: '紧急呼叫设备发出信号',
  STAFF_REPORTED_EMERGENCY: '工作人员人工上报',
  VOICE_RISK_CONFIRMED: '语音风险经人工规则确认'
};

const resolutionChecklistLabels: Readonly<Record<string, string>> = {
  ELDER_STATE_CONFIRMED: '已核对老人当前状态并记录现场观察',
  FOLLOW_UP_HANDOFF_CONFIRMED: '已安排后续观察、交接或专业人员接续',
  SCENE_SAFETY_CONFIRMED: '已确认现场环境安全，避免二次风险'
};

const fallbackChecklist = [
  'SCENE_SAFETY_CONFIRMED',
  'ELDER_STATE_CONFIRMED',
  'FOLLOW_UP_HANDOFF_CONFIRMED'
] as const;

const familyStageLabels: Record<FamilyEmergencySummaryView['stage'], string> = {
  OPENED: '事件已登记',
  ACKNOWLEDGED: '工作人员已确认',
  RESPONDING: '工作人员正在处理',
  RESOLVED: '现场处置已完成',
  REVIEWED: '机构复盘已完成'
};

type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'offline' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

function formatWhen(value: string | null): string {
  if (value === null) return '尚未记录';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '时间不可用';
  return new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short'
  }).format(date);
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function requestFailureText(error: unknown): string {
  if (error instanceof MobileCareRequestError) {
    if (error.status === 0) return '网络连接不可用，服务器没有收到本次操作。';
    if (error.status === 401) return '登录状态已失效，请重新进入。';
    if (error.status === 403 || error.status === 404) {
      return '当前账号无权查看或操作这条紧急事件。';
    }
    if (error.status === 409) {
      return '事件已被其他响应人员更新，请刷新后继续。';
    }
    if (error.status === 422) {
      return '当前状态或核对内容不允许执行此操作。';
    }
  }
  return '服务器没有确认本次操作，请稍后重试。';
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => !isOffline());
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}

function WorkflowState({
  kind,
  onRetry,
  title
}: Readonly<{
  kind: 'loading' | 'offline' | 'error' | 'empty';
  onRetry?: () => void;
  title?: string;
}>) {
  const copy = {
    empty: {
      description: '服务器当前没有可显示的紧急事件。',
      icon: <SafetyCertificateOutlined aria-hidden="true" />,
      title: title ?? '当前没有紧急事件'
    },
    error: {
      description: '没有显示旧数据，也没有把任何操作标为成功。',
      icon: <ExclamationCircleOutlined aria-hidden="true" />,
      title: title ?? '这次没有加载成功'
    },
    loading: {
      description: '正在从服务器确认最新事件状态。',
      icon: <LoadingOutlined aria-hidden="true" className="is-spinning" />,
      title: title ?? '正在加载'
    },
    offline: {
      description: '断网时不会恢复缓存中的紧急记录或假装已经发送。',
      icon: <DisconnectOutlined aria-hidden="true" />,
      title: title ?? '当前处于离线状态'
    }
  }[kind];
  return (
    <section
      aria-busy={kind === 'loading'}
      className={`workflow-state-card is-${kind}`}
      role={kind === 'error' || kind === 'offline' ? 'alert' : 'status'}
    >
      <span className="workflow-state-icon">{copy.icon}</span>
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.description}</p>
      </div>
      {onRetry && kind !== 'loading' ? (
        <button
          className="secondary-button workflow-retry"
          onClick={onRetry}
          type="button"
        >
          <ReloadOutlined aria-hidden="true" />重试
        </button>
      ) : null}
    </section>
  );
}

function LocationStatus({
  location,
  compact = false
}: Readonly<{ compact?: boolean; location: MobileEmergencyLocation }>) {
  const current = location.state === 'CURRENT';
  const stale = location.state === 'STALE';
  const fallback = location.state === 'ROOM_FALLBACK';
  const title = current
    ? '位置当前有效'
    : stale
      ? '位置已过期'
      : fallback
        ? '使用房间回退'
        : '位置未知';
  const description = current
    ? `${location.label ?? '已取得现场位置'} · ${location.source}`
    : stale
      ? '最后位置不是实时位置，请按房间或人工确认'
      : fallback
        ? `${location.label ?? '房间待确认'} · 未使用实时定位`
        : '尚未收到有效位置，请联系现场人员确认';
  return (
    <div
      aria-label={`${title}：${description}`}
      className={`emergency-location-state state-${location.state.toLowerCase()}${compact ? ' is-compact' : ''}`}
    >
      <EnvironmentOutlined aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {!compact && location.observedAt ? (
          <small>
            采样 {formatWhen(location.observedAt)}
            {location.accuracyMeters === null
              ? ''
              : ` · 精度约 ${location.accuracyMeters} 米`}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function MobileEmergencyTimer({
  deadlineAt
}: Readonly<{ deadlineAt: string | null }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineAt === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  if (deadlineAt === null) {
    return (
      <span className="mobile-emergency-timer is-complete">
        <CheckCircleOutlined aria-hidden="true" />
        当前没有待执行时限
      </span>
    );
  }
  const deadline = new Date(deadlineAt).getTime();
  const seconds = Number.isFinite(deadline)
    ? Math.ceil((deadline - now) / 1_000)
    : 0;
  const overdue = seconds < 0;
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remaining = absolute % 60;
  return (
    <span
      aria-label={overdue ? '当前响应时限已超时' : '当前响应时限倒计时'}
      className={`mobile-emergency-timer${overdue ? ' is-overdue' : ''}`}
    >
      <ClockCircleOutlined aria-hidden="true" />
      {overdue ? '已超时' : '剩余'} {minutes} 分 {remaining} 秒
    </span>
  );
}

function fallbackPhoneActions(phoneNumber = '120') {
  const normalized = phoneNumber.replace(/[^\d+]/g, '');
  const callableNumber = normalized.length >= 3 ? normalized : '120';
  return (
    <div className="emergency-phone-actions" aria-label="电话和现场呼救">
      <a
        className="primary-button emergency-phone-button"
        href={`tel:${callableNumber}`}
      >
        <PhoneOutlined aria-hidden="true" />
        拨打 {phoneNumber}
      </a>
      <p>如存在直接生命危险，请立即拨打急救电话，并大声呼叫附近人员。</p>
    </div>
  );
}

const EMERGENCY_SOURCE_EVENT_KEY =
  'eldercare:m04:elder-emergency-source-event';
const EMERGENCY_SOURCE_OBSERVED_AT_KEY =
  'eldercare:m04:elder-emergency-source-observed-at';

function emergencySourceOperation(): Readonly<{
  externalEventId: string;
  clientObservedAt: string;
}> {
  const existingEventId = window.sessionStorage.getItem(
    EMERGENCY_SOURCE_EVENT_KEY
  );
  const externalEventId =
    existingEventId ??
    (typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `elder-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const existingObservedAt = window.sessionStorage.getItem(
    EMERGENCY_SOURCE_OBSERVED_AT_KEY
  );
  const clientObservedAt =
    existingObservedAt !== null &&
    !Number.isNaN(Date.parse(existingObservedAt))
      ? existingObservedAt
      : new Date().toISOString();
  window.sessionStorage.setItem(
    EMERGENCY_SOURCE_EVENT_KEY,
    externalEventId
  );
  window.sessionStorage.setItem(
    EMERGENCY_SOURCE_OBSERVED_AT_KEY,
    clientObservedAt
  );
  return { clientObservedAt, externalEventId };
}

export function ElderEmergencyPage({
  initialEmergencyId,
  onEmergencyCreated,
  onExit,
  onNavigationBlockChange
}: Readonly<{
  initialEmergencyId?: string | undefined;
  onEmergencyCreated: (emergencyId: string) => void;
  onExit: () => void;
  onNavigationBlockChange?: ((blocked: boolean) => void) | undefined;
}>) {
  const online = useOnlineStatus();
  const [state, setState] = useState<LoadState<ElderEmergencyStatus>>({
    status: 'loading'
  });
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const createdRef = useRef(false);
  const onEmergencyCreatedRef = useRef(onEmergencyCreated);
  const onNavigationBlockChangeRef = useRef(onNavigationBlockChange);
  onEmergencyCreatedRef.current = onEmergencyCreated;
  onNavigationBlockChangeRef.current = onNavigationBlockChange;

  const submitOrLoad = useCallback(
    async (signal: AbortSignal) => {
      if (!online) {
        setState({ status: 'offline' });
        return;
      }
      setState({ status: 'loading' });
      try {
        let event: ElderEmergencyStatus;
        if (initialEmergencyId === undefined) {
          const operation = emergencySourceOperation();
          event = await createElderEmergency(
            operation.externalEventId,
            operation.clientObservedAt,
            signal
          );
        } else {
          event = await loadElderEmergency(initialEmergencyId, signal);
        }
        setState({ data: event, status: 'ready' });
        if (initialEmergencyId === undefined && !createdRef.current) {
          createdRef.current = true;
          window.sessionStorage.removeItem(EMERGENCY_SOURCE_EVENT_KEY);
          window.sessionStorage.removeItem(
            EMERGENCY_SOURCE_OBSERVED_AT_KEY
          );
          onEmergencyCreatedRef.current(event.id);
        }
      } catch (error) {
        if (signal.aborted) return;
        setState({ message: requestFailureText(error), status: 'error' });
      }
    },
    [initialEmergencyId, online]
  );

  useEffect(() => {
    const controller = new AbortController();
    void submitOrLoad(controller.signal);
    return () => controller.abort();
  }, [retryKey, submitOrLoad]);

  useEffect(() => {
    const blocked = state.status === 'loading';
    onNavigationBlockChangeRef.current?.(blocked);
    return () => onNavigationBlockChangeRef.current?.(false);
  }, [state.status]);

  const refresh = async () => {
    if (state.status !== 'ready' || refreshing || !online) return;
    setRefreshing(true);
    try {
      setState({
        data: await loadElderEmergency(state.data.id),
        status: 'ready'
      });
    } catch (error) {
      setState({ message: requestFailureText(error), status: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="role-page elder-emergency-page">
      <section className="role-intro emergency-role-intro" aria-labelledby="elder-emergency-title">
        <p className="eyebrow">老人端 · 紧急求助</p>
        <h1 id="elder-emergency-title">紧急求助</h1>
        <p>系统会立即登记信号并通知工作人员；服务器确认前不会显示“已发送”。</p>
      </section>

      {state.status === 'loading' ? (
        <section className="elder-emergency-pending" role="status" aria-live="assertive">
          <span className="elder-emergency-pulse" aria-hidden="true">
            <LoadingOutlined className="is-spinning" />
          </span>
          <h2>正在发送求助</h2>
          <p>请留在安全位置，同时大声呼叫附近人员。</p>
          {fallbackPhoneActions()}
        </section>
      ) : state.status === 'offline' ? (
        <section className="elder-emergency-fallback" role="alert">
          <DisconnectOutlined aria-hidden="true" />
          <h2>网络未连接，求助尚未发送</h2>
          <p>请不要等待网络恢复。立即呼叫附近人员，必要时拨打急救电话。</p>
          {fallbackPhoneActions()}
          <button
            className="secondary-button elder-touch"
            disabled={!online}
            onClick={() => setRetryKey((value) => value + 1)}
            type="button"
          >
            <ReloadOutlined aria-hidden="true" />网络恢复后重试同一次求助
          </button>
        </section>
      ) : state.status === 'error' ? (
        <section className="elder-emergency-fallback" role="alert">
          <ExclamationCircleOutlined aria-hidden="true" />
          <h2>服务器尚未确认收到</h2>
          <p>{state.message}</p>
          {fallbackPhoneActions()}
          <button
            className="secondary-button elder-touch"
            onClick={() => setRetryKey((value) => value + 1)}
            type="button"
          >
            <ReloadOutlined aria-hidden="true" />重试同一次求助
          </button>
        </section>
      ) : (
        <section className="elder-emergency-confirmed" aria-live="polite">
          <span className="elder-emergency-confirmed-icon" aria-hidden="true">
            <CheckCircleOutlined />
          </span>
          <p className="eyebrow">服务器已确认</p>
          <h2>求助已经登记</h2>
          <p>{state.data.assistanceMessage}</p>
          <div className="elder-emergency-status-card">
            <strong>{statusLabels[state.data.status]}</strong>
            <span>事件编号 …{state.data.id.slice(-8)}</span>
            <span>登记时间 {formatWhen(state.data.openedAt)}</span>
            <span>
              人工响应{' '}
              {state.data.humanResponseStartedAt === null
                ? '尚未开始'
                : formatWhen(state.data.humanResponseStartedAt)}
            </span>
          </div>
          <p className="elder-emergency-stay-note">
            如果情况加重，请继续大声呼救或拨打 120。不要因为页面显示已登记而停止寻求现场帮助。
          </p>
          {fallbackPhoneActions(state.data.fallbackPhoneNumber)}
          <div className="elder-emergency-footer-actions">
            <button
              className="secondary-button elder-touch"
              disabled={refreshing}
              onClick={() => void refresh()}
              type="button"
            >
              <ReloadOutlined aria-hidden="true" />
              {refreshing ? '正在更新' : '更新响应进度'}
            </button>
            <button
              className="text-action elder-emergency-home"
              onClick={onExit}
              type="button"
            >
              返回首页
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function CaregiverEmergenciesPanel({
  compact = false,
  onOpenAll,
  onSelect
}: Readonly<{
  compact?: boolean;
  onOpenAll?: (() => void) | undefined;
  onSelect: (emergencyId: string) => void;
}>) {
  const [state, setState] = useState<LoadState<MobileEmergencyView[]>>({
    status: 'loading'
  });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (isOffline()) {
        setState({ status: 'offline' });
        return;
      }
      setState({ status: 'loading' });
      try {
        const events = await loadCaregiverEmergencies(controller.signal);
        const rank: Record<MobileEmergencyStatus, number> = {
          OPEN: 0,
          ACKNOWLEDGED: 1,
          RESPONDING: 2,
          RESOLVED: 3,
          REVIEWED: 4
        };
        setState({
          data: [...events].sort(
            (left, right) =>
              rank[left.status] - rank[right.status] ||
              new Date(right.openedAt).getTime() -
                new Date(left.openedAt).getTime()
          ),
          status: 'ready'
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ message: requestFailureText(error), status: 'error' });
      }
    };
    void load();
    return () => controller.abort();
  }, [retryKey]);

  return (
    <section className="emergency-panel" aria-labelledby="caregiver-emergency-panel-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">最高优先级</p>
          <h2 id="caregiver-emergency-panel-title">当前紧急任务</h2>
        </div>
        {onOpenAll ? (
          <button className="text-action" onClick={onOpenAll} type="button">
            查看全部<RightOutlined aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {state.status === 'loading' ? (
        <WorkflowState kind="loading" title="正在读取紧急任务" />
      ) : state.status === 'offline' ? (
        <WorkflowState
          kind="offline"
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      ) : state.status === 'error' ? (
        <WorkflowState
          kind="error"
          onRetry={() => setRetryKey((value) => value + 1)}
          title={state.message}
        />
      ) : state.data.length === 0 ? (
        <WorkflowState kind="empty" title="当前没有分配给您的紧急任务" />
      ) : (
        <div className="caregiver-emergency-list">
          {state.data.slice(0, compact ? 1 : undefined).map((event) => (
            <button
              aria-label={`查看紧急事件：${event.elderDisplayName ?? '服务对象'}，${statusLabels[event.status]}`}
              className={`caregiver-emergency-card status-${event.status.toLowerCase()}`}
              key={event.id}
              onClick={() => onSelect(event.id)}
              type="button"
            >
              <span className="caregiver-emergency-icon" aria-hidden="true">
                <AlertFilled />
              </span>
              <div>
                <div className="caregiver-emergency-title-row">
                  <strong>{event.elderDisplayName ?? '服务对象'}</strong>
                  <span>{statusLabels[event.status]}</span>
                </div>
                <p>{reasonLabels[event.reasonCode] ?? '紧急事件需要现场响应'}</p>
                <LocationStatus compact location={event.location} />
                <MobileEmergencyTimer deadlineAt={event.currentDeadlineAt} />
              </div>
              <RightOutlined aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function CaregiverEmergencyDetail({
  emergencyId,
  onBack,
  onNavigationBlockChange
}: Readonly<{
  emergencyId: string;
  onBack: () => void;
  onNavigationBlockChange?: ((blocked: boolean) => void) | undefined;
}>) {
  const [state, setState] = useState<LoadState<MobileEmergencyView>>({
    status: 'loading'
  });
  const [retryKey, setRetryKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [outcomeCode, setOutcomeCode] = useState('STABILIZED_MONITORING');
  const [familyNotify, setFamilyNotify] = useState(true);
  const [checklist, setChecklist] = useState<string[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (isOffline()) {
      setState({ status: 'offline' });
      return;
    }
    setState({ status: 'loading' });
    try {
      setState({
        data: await loadCaregiverEmergency(emergencyId, signal),
        status: 'ready'
      });
    } catch (loadError) {
      if (signal?.aborted) return;
      setState({ message: requestFailureText(loadError), status: 'error' });
    }
  }, [emergencyId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retryKey]);

  useEffect(() => {
    const blocked = pendingAction !== null;
    onNavigationBlockChange?.(blocked);
    return () => onNavigationBlockChange?.(false);
  }, [onNavigationBlockChange, pendingAction]);

  const event = state.status === 'ready' ? state.data : null;
  const checklistCodes =
    event?.requiredResolutionChecklistCodes.length
      ? event.requiredResolutionChecklistCodes
      : fallbackChecklist;
  const hasEnRoute = event?.milestones.includes('EN_ROUTE') ?? false;
  const hasOnSite = event?.milestones.includes('ON_SITE') ?? false;

  const performTransition = async (
    action: 'acknowledge' | 'en-route' | 'on-site'
  ) => {
    if (event === null || pendingAction !== null) return;
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const updated = await transitionCaregiverEmergency(
        event.id,
        event.version,
        action
      );
      setState({ data: updated, status: 'ready' });
      setNotice(
        action === 'acknowledge'
          ? '服务器已确认由您负责响应。'
          : action === 'en-route'
            ? '服务器已记录您正在前往现场。'
            : '服务器已记录您到达现场。'
      );
    } catch (actionError) {
      setError(requestFailureText(actionError));
      if (actionError instanceof MobileCareRequestError && actionError.status === 409) {
        void load();
      }
    } finally {
      setPendingAction(null);
    }
  };

  const submitResolution = async () => {
    if (event === null || pendingAction !== null) return;
    setPendingAction('resolve');
    setError(null);
    setNotice(null);
    try {
      const updated = await resolveCaregiverEmergency(event.id, {
        completionChecklist: checklist,
        expectedVersion: event.version,
        familyNotify,
        outcomeCode,
        summary: summary.trim()
      });
      setState({ data: updated, status: 'ready' });
      setNotice('服务器已保存现场处置结果；事件仍等待主管复盘。');
    } catch (actionError) {
      setError(requestFailureText(actionError));
      if (actionError instanceof MobileCareRequestError && actionError.status === 409) {
        void load();
      }
    } finally {
      setPendingAction(null);
    }
  };

  const resolveReady =
    summary.trim().length >= 10 &&
    checklistCodes.every((code) => checklist.includes(code));

  return (
    <div className="role-page caregiver-emergency-detail">
      <section className="role-intro emergency-role-intro" aria-labelledby="caregiver-emergency-title">
        <button
          className="icon-text-button back-action"
          disabled={pendingAction !== null}
          onClick={onBack}
          type="button"
        >
          <ArrowLeftOutlined aria-hidden="true" />返回紧急任务
        </button>
        <p className="eyebrow">护工端 · 最高优先级</p>
        <h1 id="caregiver-emergency-title">紧急任务详情</h1>
        <p>先确认、再出发、到场和处置；每一步都以服务端记录为准。</p>
      </section>

      {state.status === 'loading' ? (
        <WorkflowState kind="loading" />
      ) : state.status === 'offline' ? (
        <>
          <WorkflowState
            kind="offline"
            onRetry={() => setRetryKey((value) => value + 1)}
          />
          {fallbackPhoneActions()}
        </>
      ) : state.status === 'error' ? (
        <WorkflowState
          kind="error"
          onRetry={() => setRetryKey((value) => value + 1)}
          title={state.message}
        />
      ) : (
        <>
          {notice ? (
            <div className="workflow-alert workflow-alert-success" role="status">
              <CheckCircleOutlined aria-hidden="true" />
              <span>{notice}</span>
            </div>
          ) : null}
          {error ? (
            <div className="workflow-alert workflow-alert-error" role="alert">
              <ExclamationCircleOutlined aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="caregiver-emergency-hero" aria-label="紧急事件当前状态">
            <div className="caregiver-emergency-hero-title">
              <span aria-hidden="true"><AlertFilled /></span>
              <div>
                <small>事件 …{state.data.id.slice(-8)}</small>
                <h2>{state.data.elderDisplayName ?? '服务对象'}</h2>
                <p>{reasonLabels[state.data.reasonCode] ?? '紧急事件需要现场响应'}</p>
              </div>
            </div>
            <strong className={`emergency-status-pill status-${state.data.status.toLowerCase()}`}>
              {statusLabels[state.data.status]}
            </strong>
            <MobileEmergencyTimer deadlineAt={state.data.currentDeadlineAt} />
          </section>

          <LocationStatus location={state.data.location} />

          <section className="caregiver-emergency-steps" aria-labelledby="response-steps-title">
            <h2 id="response-steps-title">响应步骤</h2>
            <ol>
              <li className={state.data.status !== 'OPEN' ? 'is-complete' : 'is-current'}>
                <span>{state.data.status !== 'OPEN' ? <CheckCircleOutlined /> : '1'}</span>
                <div><strong>确认负责</strong><small>{formatWhen(state.data.acknowledgedAt)}</small></div>
              </li>
              <li className={hasEnRoute ? 'is-complete' : state.data.status === 'ACKNOWLEDGED' ? 'is-current' : ''}>
                <span>{hasEnRoute ? <CheckCircleOutlined /> : '2'}</span>
                <div><strong>正在前往</strong><small>{formatWhen(state.data.respondingAt)}</small></div>
              </li>
              <li className={hasOnSite ? 'is-complete' : hasEnRoute ? 'is-current' : ''}>
                <span>{hasOnSite ? <CheckCircleOutlined /> : '3'}</span>
                <div><strong>确认到场</strong><small>{formatWhen(state.data.onSiteAt)}</small></div>
              </li>
              <li className={['RESOLVED', 'REVIEWED'].includes(state.data.status) ? 'is-complete' : hasOnSite ? 'is-current' : ''}>
                <span>{['RESOLVED', 'REVIEWED'].includes(state.data.status) ? <CheckCircleOutlined /> : '4'}</span>
                <div><strong>提交现场处置</strong><small>{formatWhen(state.data.resolvedAt)}</small></div>
              </li>
            </ol>
          </section>

          <section className="caregiver-emergency-actions" aria-label="紧急响应操作">
            {state.data.status === 'OPEN' ? (
              <button
                className="primary-button emergency-primary-action"
                disabled={pendingAction !== null}
                onClick={() => void performTransition('acknowledge')}
                type="button"
              >
                {pendingAction === 'acknowledge' ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <TeamOutlined aria-hidden="true" />
                )}
                确认由我负责
              </button>
            ) : state.data.status === 'ACKNOWLEDGED' && !hasEnRoute ? (
              <button
                className="primary-button emergency-primary-action"
                disabled={pendingAction !== null}
                onClick={() => void performTransition('en-route')}
                type="button"
              >
                {pendingAction === 'en-route' ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <SendOutlined aria-hidden="true" />
                )}
                我已出发
              </button>
            ) : state.data.status === 'RESPONDING' && !hasOnSite ? (
              <button
                className="primary-button emergency-primary-action"
                disabled={pendingAction !== null}
                onClick={() => void performTransition('on-site')}
                type="button"
              >
                {pendingAction === 'on-site' ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <EnvironmentOutlined aria-hidden="true" />
                )}
                我已到场
              </button>
            ) : null}
            <div className="caregiver-call-actions">
              <a className="secondary-button" href="tel:120">
                <PhoneOutlined aria-hidden="true" />呼叫 120
              </a>
              <button
                className="secondary-button"
                onClick={() =>
                  setNotice(
                    '请使用机构值班电话或对讲机联系主管；此动作不会改变系统事件状态。'
                  )
                }
                type="button"
              >
                <TeamOutlined aria-hidden="true" />联系值班主管
              </button>
            </div>
            <small>电话动作不会改变系统事件状态；返回后仍需完成服务端记录。</small>
          </section>

          {state.data.status === 'RESPONDING' && hasOnSite ? (
            <section className="caregiver-resolution-form" aria-labelledby="resolution-form-title">
              <div>
                <p className="eyebrow">人工决定</p>
                <h2 id="resolution-form-title">提交现场处置结果</h2>
                <p>AI 不能代替您确认处置完成；主管复盘仍是下一独立步骤。</p>
              </div>
              <label>
                <span>处置结果</span>
                <select
                  aria-label="选择现场处置结果"
                  onChange={(event) => setOutcomeCode(event.target.value)}
                  value={outcomeCode}
                >
                  <option value="STABILIZED_MONITORING">现场情况已稳定，继续观察</option>
                  <option value="HANDED_OFF_TO_EMERGENCY_SERVICES">已转交专业急救或医疗人员</option>
                  <option value="FALSE_ALARM_VERIFIED">误触但已完成现场核对</option>
                  <option value="OTHER_HUMAN_RESOLUTION">其他人工处置结果</option>
                </select>
              </label>
              <label>
                <span>人工处置摘要</span>
                <textarea
                  aria-label="填写现场处置摘要"
                  maxLength={1_000}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="至少 10 个字；记录现场事实和后续安排，不填写诊断。"
                  rows={5}
                  value={summary}
                />
                <small>{summary.length}/1000</small>
              </label>
              <fieldset>
                <legend>处置完成核对</legend>
                {checklistCodes.map((code) => (
                  <label className="emergency-check-item" key={code}>
                    <input
                      checked={checklist.includes(code)}
                      onChange={() =>
                        setChecklist((current) =>
                          current.includes(code)
                            ? current.filter((item) => item !== code)
                            : [...current, code]
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      {resolutionChecklistLabels[code] ??
                        '已完成服务端要求的现场核对项'}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="emergency-check-item">
                <input
                  checked={familyNotify}
                  onChange={(event) => setFamilyNotify(event.target.checked)}
                  type="checkbox"
                />
                <span>按家属偏好请求发布隐私过滤摘要</span>
              </label>
              <button
                className="primary-button emergency-resolve-button"
                disabled={!resolveReady || pendingAction !== null}
                onClick={() => void submitResolution()}
                type="button"
              >
                {pendingAction === 'resolve' ? (
                  <LoadingOutlined aria-hidden="true" className="is-spinning" />
                ) : (
                  <SafetyCertificateOutlined aria-hidden="true" />
                )}
                提交人工处置结果
              </button>
            </section>
          ) : null}

          {state.data.status === 'RESOLVED' ? (
            <section className="emergency-review-waiting" role="status">
              <AuditOutlined aria-hidden="true" />
              <div>
                <strong>现场处置已完成，等待主管复盘</strong>
                <p>事件尚未进入最终状态，系统不会自动跳过复盘。</p>
              </div>
            </section>
          ) : state.data.status === 'REVIEWED' ? (
            <section className="emergency-review-waiting is-complete" role="status">
              <CheckCircleOutlined aria-hidden="true" />
              <div>
                <strong>紧急事件已完成闭环</strong>
                <p>主管复盘已保存，完整审计记录由管理端保留。</p>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function FamilyEmergencyPanel() {
  const [summaryState, setSummaryState] = useState<
    LoadState<FamilyEmergencySummaryView[]>
  >({ status: 'loading' });
  const [preferenceState, setPreferenceState] = useState<
    LoadState<FamilyEmergencyPreferenceView>
  >({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [preferencePending, setPreferencePending] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (isOffline()) {
        setSummaryState({ status: 'offline' });
        setPreferenceState({ status: 'offline' });
        return;
      }
      setSummaryState({ status: 'loading' });
      setPreferenceState({ status: 'loading' });
      const [summaries, elders] = await Promise.allSettled([
        loadFamilyEmergencySummaries(controller.signal),
        loadFamilyElders(controller.signal)
      ]);
      if (controller.signal.aborted) return;
      setSummaryState(
        summaries.status === 'fulfilled'
          ? { data: summaries.value, status: 'ready' }
          : { message: requestFailureText(summaries.reason), status: 'error' }
      );
      if (elders.status === 'rejected') {
        setPreferenceState({
          message: requestFailureText(elders.reason),
          status: 'error'
        });
        return;
      }
      const elder = elders.value[0];
      if (elder === undefined) {
        setPreferenceState({
          message: '当前没有可设置通知偏好的授权老人。',
          status: 'error'
        });
        return;
      }
      try {
        const preference = await loadFamilyEmergencyPreference(
          elder.id,
          elder.preferredName ?? elder.displayName,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setPreferenceState({ data: preference, status: 'ready' });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setPreferenceState({
            message: requestFailureText(error),
            status: 'error'
          });
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [retryKey]);

  const savePreference = async (next: FamilyEmergencyPreferenceView) => {
    if (preferencePending) return;
    setPreferencePending(true);
    setPreferenceError(null);
    setPreferenceNotice(null);
    try {
      const saved = await updateFamilyEmergencyPreference(next);
      setPreferenceState({ data: saved, status: 'ready' });
      setPreferenceNotice('服务器已保存紧急事件通知偏好。');
    } catch (error) {
      setPreferenceError(requestFailureText(error));
      if (error instanceof MobileCareRequestError && error.status === 409) {
        setRetryKey((value) => value + 1);
      }
    } finally {
      setPreferencePending(false);
    }
  };

  return (
    <section className="family-emergency-section" aria-labelledby="family-emergency-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">授权动态</p>
          <h2 id="family-emergency-title">紧急事件摘要</h2>
        </div>
      </div>
      <div className="family-emergency-privacy">
        <LockOutlined aria-hidden="true" />
        <p>只显示机构发布的必要阶段摘要；不会显示精确位置、响应人员轨迹、内部备注或现场清单。</p>
      </div>
      {summaryState.status === 'loading' ? (
        <WorkflowState kind="loading" />
      ) : summaryState.status === 'offline' ? (
        <WorkflowState
          kind="offline"
          onRetry={() => setRetryKey((value) => value + 1)}
        />
      ) : summaryState.status === 'error' ? (
        <WorkflowState
          kind="error"
          onRetry={() => setRetryKey((value) => value + 1)}
          title={summaryState.message}
        />
      ) : summaryState.data.length === 0 ? (
        <WorkflowState kind="empty" title="当前没有已发布的紧急事件摘要" />
      ) : (
        <div className="family-emergency-list">
          {summaryState.data.map((summary) => (
            <article className="family-emergency-card" key={summary.id}>
              <span className="family-emergency-icon" aria-hidden="true">
                {summary.stage === 'RESOLVED' || summary.stage === 'REVIEWED' ? (
                  <CheckCircleOutlined />
                ) : (
                  <AlertFilled />
                )}
              </span>
              <div>
                <div className="family-emergency-card-title">
                  <h3>{summary.title}</h3>
                  <span>{familyStageLabels[summary.stage]}</span>
                </div>
                <p>{summary.summary}</p>
                <small>发布于 {formatWhen(summary.publishedAt)}</small>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="family-emergency-preferences">
        <div>
          <h3>通知偏好</h3>
          <p>可选择在事件登记或处置完成时接收机构的隐私过滤通知。</p>
        </div>
        {preferenceError ? (
          <div className="workflow-alert workflow-alert-error" role="alert">
            <ExclamationCircleOutlined aria-hidden="true" />
            <span>{preferenceError}</span>
          </div>
        ) : null}
        {preferenceNotice ? (
          <div className="workflow-alert workflow-alert-success" role="status">
            <CheckCircleOutlined aria-hidden="true" />
            <span>{preferenceNotice}</span>
          </div>
        ) : null}
        {preferenceState.status === 'ready' ? (
          <div className="family-preference-controls">
            <p className="family-preference-subject">
              当前设置：{preferenceState.data.elderDisplayName}
            </p>
            <label className="emergency-check-item">
              <input
                checked={preferenceState.data.enabled}
                disabled={preferencePending}
                onChange={(event) =>
                  void savePreference({
                    ...preferenceState.data,
                    enabled: event.target.checked
                  })
                }
                type="checkbox"
              />
              <span>接收紧急事件通知</span>
            </label>
            <label className="emergency-check-item">
              <input
                checked={preferenceState.data.notifyOnOpened}
                disabled={
                  preferencePending || !preferenceState.data.enabled
                }
                onChange={(event) =>
                  void savePreference({
                    ...preferenceState.data,
                    notifyOnOpened: event.target.checked
                  })
                }
                type="checkbox"
              />
              <span>事件登记后通知我</span>
            </label>
            <label className="emergency-check-item">
              <input
                checked={preferenceState.data.notifyOnResolved}
                disabled={
                  preferencePending || !preferenceState.data.enabled
                }
                onChange={(event) =>
                  void savePreference({
                    ...preferenceState.data,
                    notifyOnResolved: event.target.checked
                  })
                }
                type="checkbox"
              />
              <span>现场处置完成后通知我</span>
            </label>
            <label>
              <span>通知渠道</span>
              <select
                aria-label="选择紧急事件通知渠道"
                disabled={preferencePending || !preferenceState.data.enabled}
                onChange={(event) =>
                  void savePreference({
                    ...preferenceState.data,
                    channel: event.target.value as FamilyEmergencyPreferenceView['channel']
                  })
                }
                value={preferenceState.data.channel}
              >
                <option value="IN_APP">应用内通知</option>
                <option value="SMS">短信</option>
                <option value="PHONE">电话</option>
                <option value="EMAIL">电子邮件</option>
              </select>
            </label>
          </div>
        ) : preferenceState.status === 'loading' ? (
          <WorkflowState kind="loading" title="正在读取通知偏好" />
        ) : (
          <WorkflowState
            kind={preferenceState.status === 'offline' ? 'offline' : 'error'}
            onRetry={() => setRetryKey((value) => value + 1)}
          />
        )}
      </div>
    </section>
  );
}
