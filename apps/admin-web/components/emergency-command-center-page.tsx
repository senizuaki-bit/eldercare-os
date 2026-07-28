'use client';

import {
  AlertFilled,
  ArrowLeftOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  FileDoneOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WarningOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Timeline
} from 'antd';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { apiFetch } from '../lib/api-client';
import {
  parseShiftsPage,
  type ScopedPage as ShiftPage,
  type Shift
} from '../lib/m02-contract';
import { withQuery } from '../lib/m03-contract';
import {
  M04_API_PATHS,
  parseEmergencyAdminDetail,
  type EmergencyAdminDetail
} from '../lib/m04-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  EMERGENCY_SLA_LABELS,
  EMERGENCY_SOURCE_LABELS,
  EMERGENCY_STATUS_LABELS,
  EmergencyLocationBadge,
  EmergencySlaTimer,
  EmergencyStatusBadge,
  emergencyReasonLabel,
  formatEmergencyDateTime,
  HumanDecisionNotice,
  M04FacilityRequiredCard,
  M04FailureCard,
  M04PageHeader,
  M04StaleAlert,
  resolutionChecklistLabel
} from './m04-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type ActionKind = 'assign' | 'resolve' | 'review';

const outcomeOptions = [
  { label: '现场情况已稳定，继续观察', value: 'STABILIZED_MONITORING' },
  { label: '已转交专业急救或医疗人员', value: 'HANDED_OFF_TO_EMERGENCY_SERVICES' },
  { label: '误触但已完成现场核对', value: 'FALSE_ALARM_VERIFIED' },
  { label: '其他人工处置结果', value: 'OTHER_HUMAN_RESOLUTION' }
];

function mutationIdempotencyKey(action: ActionKind): string {
  const random =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-emergency-${action}:${random}`;
}

function mutationFailure(status: number, action: ActionKind): string {
  const label =
    action === 'assign' ? '分配响应人员' : action === 'resolve' ? '提交处置结果' : '完成复盘';
  if (status === 403) return `当前账号没有${label}的权限。`;
  if (status === 404) return '事件不存在或已超出当前授权范围。';
  if (status === 409) return '事件已被其他人员更新，页面将重新同步。';
  if (status === 422) return `当前状态或填写内容不允许${label}，请核对前置步骤。`;
  return `${label}失败，服务器没有确认本次操作。`;
}

function timelineItems(detail: EmergencyAdminDetail) {
  const transitions = detail.transitions.map((transition) => ({
    occurredAt: transition.occurredAt,
    item: {
      color:
        transition.toStatus === 'REVIEWED'
          ? 'green'
          : transition.toStatus === 'RESOLVED'
            ? 'blue'
            : transition.toStatus === 'OPEN'
              ? 'red'
              : 'orange',
      content: (
        <div className="m04-timeline-entry">
          <strong>
            {transition.fromStatus === null
              ? '创建紧急事件'
              : `${EMERGENCY_STATUS_LABELS[transition.fromStatus]} → ${EMERGENCY_STATUS_LABELS[transition.toStatus]}`}
          </strong>
          <span>{formatEmergencyDateTime(transition.occurredAt)}</span>
          <small>
            {transition.actorLabel ?? transition.actorType} · {transition.reasonCode} ·
            版本 {transition.fromVersion} → {transition.toVersion}
          </small>
        </div>
      )
    }
  }));
  const milestones = detail.milestones.map((milestone) => ({
    occurredAt: milestone.occurredAt,
    item: {
      color: milestone.kind === 'ON_SITE' ? 'green' : 'blue',
      content: (
        <div className="m04-timeline-entry">
          <strong>{milestone.kind === 'EN_ROUTE' ? '响应人员已出发' : '响应人员已到场'}</strong>
          <span>{formatEmergencyDateTime(milestone.occurredAt)}</span>
          <small>
            {milestone.actorLabel ?? `工作人员 …${milestone.staffProfileId.slice(-8)}`}
            {milestone.clientObservedAt
              ? ` · 客户端时间 ${formatEmergencyDateTime(milestone.clientObservedAt)}`
              : ''}
          </small>
        </div>
      )
    }
  }));
  const escalations = detail.escalations
    .filter((escalation) => escalation.status === 'TRIGGERED')
    .map((escalation) => ({
      occurredAt: escalation.triggeredAt ?? escalation.dueAt,
      item: {
        color: 'red',
        content: (
          <div className="m04-timeline-entry">
            <strong>{EMERGENCY_SLA_LABELS[escalation.stage]}已触发升级</strong>
            <span>{formatEmergencyDateTime(escalation.triggeredAt ?? escalation.dueAt)}</span>
            <small>服务端幂等升级 · 引用 …{escalation.id.slice(-8)}</small>
          </div>
        )
      }
    }));
  return [...transitions, ...milestones, ...escalations]
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() -
        new Date(right.occurredAt).getTime()
    )
    .map(({ item }) => item);
}

export function EmergencyCommandCenterPage({
  emergencyId
}: Readonly<{ emergencyId: string }>) {
  const { message } = AntApp.useApp();
  const { session } = useAdminShellSearch();
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [activeAction, setActiveAction] = useState<ActionKind | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [outcomeCode, setOutcomeCode] = useState('STABILIZED_MONITORING');
  const [familyNotify, setFamilyNotify] = useState(true);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [reviewKind, setReviewKind] = useState<'COMPLETED' | 'WAIVED'>('COMPLETED');
  const [reviewSummary, setReviewSummary] = useState('');
  const [waiverReasonCode, setWaiverReasonCode] = useState('REVIEW_NOT_REQUIRED_BY_POLICY');

  const detailUrl =
    facilityId === null
      ? ''
      : M04_API_PATHS.emergency(organizationId, facilityId, emergencyId);
  const parseDetail = useCallback(
    (value: unknown): EmergencyAdminDetail =>
      parseEmergencyAdminDetail(
        value,
        organizationId,
        facilityId ?? '',
        emergencyId
      ),
    [emergencyId, facilityId, organizationId]
  );
  const directory = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseDetail,
    url: detailUrl
  });
  const detail = directory.data;

  const shiftParams = useMemo(() => {
    const now = Date.now();
    return new URLSearchParams({
      direction: 'asc',
      from: new Date(now - 12 * 60 * 60 * 1_000).toISOString(),
      page: '1',
      pageSize: '100',
      sort: 'startsAt',
      to: new Date(now + 12 * 60 * 60 * 1_000).toISOString()
    });
  }, []);
  const shiftUrl =
    facilityId === null
      ? ''
      : withQuery(
          `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/shifts`,
          shiftParams
        );
  const parseShifts = useCallback(
    (value: unknown): ShiftPage<Shift> =>
      parseShiftsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const shiftDirectory = useScopedDirectory({
    enabled: facilityId !== null && activeAction === 'assign',
    parse: parseShifts,
    url: shiftUrl
  });
  const assignmentOptions = useMemo(
    () =>
      (shiftDirectory.data?.items ?? []).flatMap((shift) =>
        shift.assignments
          .filter((assignment) => assignment.status !== 'CANCELLED')
          .map((assignment) => ({
            assignment,
            label: `${assignment.staffDisplayName} · ${shift.name}`,
            value: assignment.id
          }))
      ),
    [shiftDirectory.data]
  );

  const checklistCodes =
    detail?.requiredResolutionChecklistCodes.length
      ? detail.requiredResolutionChecklistCodes
      : [
          'SCENE_SAFETY_CONFIRMED',
          'ELDER_STATE_CONFIRMED',
          'FOLLOW_UP_HANDOFF_CONFIRMED'
        ];

  const openResolve = () => {
    setMutationError(null);
    setResolutionSummary(detail?.resolution?.summary ?? '');
    setOutcomeCode(detail?.resolution?.outcomeCode ?? 'STABILIZED_MONITORING');
    setFamilyNotify(detail?.resolution?.familyNotify ?? true);
    setChecklist([]);
    setActiveAction('resolve');
  };

  const openReview = () => {
    setMutationError(null);
    setReviewKind('COMPLETED');
    setReviewSummary('');
    setWaiverReasonCode('REVIEW_NOT_REQUIRED_BY_POLICY');
    setActiveAction('review');
  };

  const submit = async () => {
    if (detail === null || facilityId === null || activeAction === null) return;
    setMutationPending(true);
    setMutationError(null);
    let path: string;
    let body: Record<string, unknown>;
    if (activeAction === 'assign') {
      const selection = assignmentOptions.find(
        (option) => option.value === assignmentId
      );
      if (selection === undefined) {
        setMutationPending(false);
        return;
      }
      path = M04_API_PATHS.responders(
        organizationId,
        facilityId,
        detail.id
      );
      body = {
        expectedVersion: detail.version,
        idempotencyKey: mutationIdempotencyKey('assign'),
        reasonCode: 'SUPERVISOR_DISPATCH',
        shiftAssignmentId: selection.assignment.id,
        staffProfileId: selection.assignment.staffProfileId
      };
    } else if (activeAction === 'resolve') {
      path = M04_API_PATHS.resolve(organizationId, facilityId, detail.id);
      body = {
        completionChecklist: checklistCodes.map((code) => ({
          code,
          confirmed: checklist.includes(code)
        })),
        expectedVersion: detail.version,
        familyNotify,
        idempotencyKey: mutationIdempotencyKey('resolve'),
        outcomeCode,
        summary: resolutionSummary.trim()
      };
    } else {
      path = M04_API_PATHS.review(organizationId, facilityId, detail.id);
      body = {
        expectedVersion: detail.version,
        idempotencyKey: mutationIdempotencyKey('review'),
        kind: reviewKind,
        ...(reviewKind === 'COMPLETED'
          ? { summary: reviewSummary.trim() }
          : { waiverReasonCode })
      };
    }

    try {
      const response = await apiFetch(path, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      });
      if (!response.ok) {
        const failure = mutationFailure(response.status, activeAction);
        if (response.status === 409) directory.retry();
        setMutationError(failure);
        return;
      }
      void message.success(
        activeAction === 'assign'
          ? '响应人员已由服务器确认分配。'
          : activeAction === 'resolve'
            ? '现场处置结果已保存，事件仍需主管复盘。'
            : '主管复盘已保存，紧急事件完成闭环。'
      );
      setActiveAction(null);
      directory.retry();
    } catch {
      setMutationError(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? '当前处于离线状态，本次操作没有提交。'
          : '服务器没有确认本次操作，请保留当前页面并重试。'
      );
    } finally {
      setMutationPending(false);
    }
  };

  const resolveAllowed =
    detail?.status === 'RESPONDING' &&
    detail.milestones.some((milestone) => milestone.kind === 'ON_SITE');
  const reviewAllowed = detail?.status === 'RESOLVED';
  const checklistComplete = checklistCodes.every((code) =>
    checklist.includes(code)
  );
  const resolveValid =
    resolutionSummary.trim().length >= 10 && checklistComplete;
  const reviewValid =
    reviewKind === 'COMPLETED'
      ? reviewSummary.trim().length >= 10
      : waiverReasonCode.length > 0;

  return (
    <div className="m04-page emergency-command-center-page">
      <M04PageHeader
        actions={
          <Space wrap>
            <Link className="ant-btn ant-btn-default" href="/emergencies">
              <ArrowLeftOutlined />返回紧急事件
            </Link>
            <Button
              disabled={
                detail === null ||
                ['RESOLVED', 'REVIEWED'].includes(detail.status) ||
                directory.stale
              }
              icon={<UserSwitchOutlined />}
              onClick={() => {
                setMutationError(null);
                setAssignmentId(null);
                setActiveAction('assign');
              }}
            >
              分配响应人员
            </Button>
            <Button
              danger
              disabled={!resolveAllowed || directory.stale}
              icon={<CheckCircleOutlined />}
              onClick={openResolve}
              type="primary"
            >
              确认现场处置
            </Button>
            <Button
              disabled={!reviewAllowed || directory.stale}
              icon={<AuditOutlined />}
              onClick={openReview}
              type="primary"
            >
              完成主管复盘
            </Button>
          </Space>
        }
        description="在同一事件视图中确认服务对象、位置时效、响应人员、SLA、处置结果和复盘；所有状态变化由服务端校验并记录。"
        section="风险与事件 / 紧急事件"
        title="紧急响应指挥"
      />

      {facilityId === null ? (
        <M04FacilityRequiredCard />
      ) : directory.failure !== null && detail === null ? (
        <M04FailureCard
          failure={directory.failure}
          onRetry={directory.retry}
          resourceName="紧急事件详情"
        />
      ) : detail === null ? (
        <Card className="m04-surface-card m04-detail-loading" aria-live="polite">
          <Spin description="正在读取紧急事件详情" size="large" />
        </Card>
      ) : (
        <>
          {directory.stale ? <M04StaleAlert onRetry={directory.retry} /> : null}
          {mutationError === null ? null : (
            <Alert
              className="m04-action-alert"
              closable
              onClose={() => setMutationError(null)}
              showIcon
              title={mutationError}
              type="error"
            />
          )}

          <Card className="m04-command-strip">
            <div className="m04-command-identity">
              <span className="m04-emergency-icon" aria-hidden="true">
                <AlertFilled />
              </span>
              <div>
                <small>事件 …{detail.id.slice(-8)}</small>
                <strong>
                  {detail.elder.preferredName ?? detail.elder.displayName}
                </strong>
                <span>{detail.elder.roomLabel ?? '房间待人工确认'}</span>
              </div>
            </div>
            <EmergencyStatusBadge status={detail.status} />
            <EmergencyLocationBadge location={detail.location} />
            <EmergencySlaTimer
              deadlineAt={detail.currentDeadlineAt}
              stage={detail.activeSla?.stage}
            />
          </Card>

          <HumanDecisionNotice />

          <div className="m04-command-grid">
            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <WarningOutlined aria-hidden="true" /> 触发原因与事件事实
                </h2>
              }
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="触发原因">
                  {emergencyReasonLabel(detail.reasonCode)}
                </Descriptions.Item>
                <Descriptions.Item label="来源">
                  {EMERGENCY_SOURCE_LABELS[detail.sourceKind]}
                </Descriptions.Item>
                <Descriptions.Item label="发生时间">
                  {formatEmergencyDateTime(detail.openedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="确认时间">
                  {formatEmergencyDateTime(detail.acknowledgedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="响应时间">
                  {formatEmergencyDateTime(detail.respondingAt)}
                </Descriptions.Item>
                <Descriptions.Item label="到场时间">
                  {formatEmergencyDateTime(detail.onSiteAt)}
                </Descriptions.Item>
                <Descriptions.Item label="关联审计">
                  …{detail.correlationId.slice(-12)}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <EnvironmentOutlined aria-hidden="true" /> 位置与人工确认路径
                </h2>
              }
            >
              <EmergencyLocationBadge location={detail.location} />
              <Descriptions className="m04-card-descriptions" column={1} size="small">
                <Descriptions.Item label="位置说明">
                  {detail.location.label ?? '尚未收到有效位置'}
                </Descriptions.Item>
                <Descriptions.Item label="来源">
                  {detail.location.source}
                </Descriptions.Item>
                <Descriptions.Item label="采样时间">
                  {formatEmergencyDateTime(detail.location.observedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="失效时间">
                  {formatEmergencyDateTime(detail.location.expiresAt)}
                </Descriptions.Item>
                <Descriptions.Item label="精度">
                  {detail.location.accuracyMeters === null
                    ? '未提供'
                    : `约 ${detail.location.accuracyMeters} 米`}
                </Descriptions.Item>
              </Descriptions>
              {detail.location.state === 'CURRENT' ? null : (
                <Alert
                  showIcon
                  title="不要把最后位置当作实时位置"
                  description="请使用当前入住房间、现场电话和人工巡视确认；家属端不会收到工作人员位置。"
                  type="warning"
                />
              )}
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <TeamOutlined aria-hidden="true" /> 响应人员
                </h2>
              }
            >
              {detail.responders.length === 0 ? (
                <Empty
                  description="尚未分配响应人员"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <ul className="m04-responder-list">
                  {detail.responders.map((responder) => (
                    <li key={responder.id}>
                      <div>
                        <strong>{responder.displayName ?? '工作人员'}</strong>
                        <small>
                          {responder.jobTitle ?? '岗位未提供'} · 分配于{' '}
                          {formatEmergencyDateTime(responder.assignedAt)}
                        </small>
                      </div>
                      <Tag
                        color={
                          responder.status === 'ACKNOWLEDGED'
                            ? 'success'
                            : responder.status === 'RELEASED'
                              ? 'default'
                              : 'warning'
                        }
                      >
                        {responder.status === 'ACKNOWLEDGED'
                          ? '已确认'
                          : responder.status === 'RELEASED'
                            ? '已释放'
                            : '待确认'}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
              {detail.acknowledgement === null ? null : (
                <Alert
                  className="m04-card-note"
                  showIcon
                  title={`由 ${detail.acknowledgement.actorLabel ?? '当班工作人员'} 确认负责`}
                  description={`服务器时间 ${formatEmergencyDateTime(detail.acknowledgement.acknowledgedAt)}${
                    detail.acknowledgement.clientObservedAt
                      ? `；客户端时间 ${formatEmergencyDateTime(detail.acknowledgement.clientObservedAt)}`
                      : ''
                  }`}
                  type="success"
                />
              )}
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <ClockCircleOutlined aria-hidden="true" /> SLA 与升级
                </h2>
              }
            >
              <EmergencySlaTimer
                deadlineAt={detail.currentDeadlineAt}
                stage={detail.activeSla?.stage}
              />
              {detail.escalations.length === 0 ? (
                <Empty
                  description="响应中尚无升级记录"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <ul className="m04-escalation-list">
                  {detail.escalations.map((escalation) => (
                    <li key={escalation.id}>
                      <Tag
                        color={
                          escalation.status === 'TRIGGERED'
                            ? 'error'
                            : escalation.status === 'CANCELLED'
                              ? 'default'
                              : 'warning'
                        }
                      >
                        {escalation.status === 'TRIGGERED'
                          ? '已触发'
                          : escalation.status === 'CANCELLED'
                            ? '已取消'
                            : escalation.status === 'FAILED'
                              ? '执行失败'
                              : '已排程'}
                      </Tag>
                      <div>
                        <strong>{EMERGENCY_SLA_LABELS[escalation.stage]}</strong>
                        <small>
                          阈值 {formatEmergencyDateTime(escalation.dueAt)}
                          {escalation.triggeredAt
                            ? ` · 触发 ${formatEmergencyDateTime(escalation.triggeredAt)}`
                            : ''}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <small className="m04-muted">
                相同阈值的升级由服务端幂等执行；刷新或任务重跑不会重复通知。
              </small>
            </Card>

            <Card
              className="m04-detail-card m04-timeline-card"
              extra={<Tag icon={<SafetyCertificateOutlined />}>仅追加审计</Tag>}
              title={
                <h2>
                  <AuditOutlined aria-hidden="true" /> 响应时间线
                </h2>
              }
            >
              {detail.transitions.length === 0 &&
              detail.milestones.length === 0 &&
              detail.escalations.length === 0 ? (
                <Empty
                  description="响应中尚无时间线记录"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <Timeline items={timelineItems(detail)} />
              )}
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <FileDoneOutlined aria-hidden="true" /> 现场处置结果
                </h2>
              }
            >
              {detail.resolution === null ? (
                <Empty
                  description="尚未提交人工现场处置结果"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="结果">
                    {outcomeOptions.find(
                      (option) => option.value === detail.resolution?.outcomeCode
                    )?.label ?? detail.resolution.outcomeCode}
                  </Descriptions.Item>
                  <Descriptions.Item label="处置摘要">
                    {detail.resolution.summary}
                  </Descriptions.Item>
                  <Descriptions.Item label="处置人员">
                    {detail.resolution.resolvedByLabel ?? '有权限工作人员'}
                  </Descriptions.Item>
                  <Descriptions.Item label="完成时间">
                    {formatEmergencyDateTime(detail.resolution.resolvedAt)}
                  </Descriptions.Item>
                  <Descriptions.Item label="家属通知">
                    {detail.resolution.familyNotify
                      ? '按偏好生成隐私过滤摘要'
                      : '本次不请求家属通知'}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <SafetyCertificateOutlined aria-hidden="true" /> 主管复盘
                </h2>
              }
            >
              {detail.review === null ? (
                <Alert
                  showIcon
                  title={
                    detail.status === 'RESOLVED'
                      ? '处置已完成，但不能跳过主管复盘'
                      : '等待现场处置完成后复盘'
                  }
                  description="复盘需要主管明确提交总结，或选择带原因的政策豁免；系统不会自动把事件标为已复盘。"
                  type={detail.status === 'RESOLVED' ? 'warning' : 'info'}
                />
              ) : (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="复盘类型">
                    {detail.review.kind === 'COMPLETED' ? '已完成复盘' : '按政策豁免'}
                  </Descriptions.Item>
                  <Descriptions.Item label="复盘内容">
                    {detail.review.summary ??
                      `豁免原因：${detail.review.waiverReasonCode ?? '未提供'}`}
                  </Descriptions.Item>
                  <Descriptions.Item label="复盘人员">
                    {detail.review.reviewedByLabel ?? '有权限主管'}
                  </Descriptions.Item>
                  <Descriptions.Item label="复盘时间">
                    {formatEmergencyDateTime(detail.review.reviewedAt)}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </Card>

            <Card
              className="m04-detail-card"
              title={
                <h2>
                  <LinkOutlined aria-hidden="true" /> 关联重复信号
                </h2>
              }
            >
              {detail.relatedEvents.length === 0 ? (
                <Empty
                  description="没有关联的新事件信号"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <ul className="m04-related-list">
                  {detail.relatedEvents.map((event) => (
                    <li key={event.id}>
                      <Link href={`/emergencies/${encodeURIComponent(event.id)}`}>
                        事件 …{event.id.slice(-8)}
                      </Link>
                      <EmergencyStatusBadge status={event.status} />
                      <small>
                        {formatEmergencyDateTime(event.openedAt)} · {event.reasonCode}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
              <Alert
                className="m04-card-note"
                showIcon
                title="新 eventId 会保留为独立事件"
                description="完全相同的 eventId 幂等复用；相近的新信号只做关联，不会静默丢弃。"
                type="info"
              />
            </Card>
          </div>
        </>
      )}

      <Modal
        cancelText="取消"
        confirmLoading={mutationPending}
        okButtonProps={{
          disabled:
            assignmentId === null ||
            shiftDirectory.failure !== null ||
            shiftDirectory.loading
        }}
        okText="确认分配"
        onCancel={() => {
          if (!mutationPending) setActiveAction(null);
        }}
        onOk={() => void submit()}
        open={activeAction === 'assign'}
        title="分配紧急响应人员"
      >
        <div className="m04-action-form">
          <Alert
            showIcon
            title="服务端会验证有效班次、院区和响应范围"
            description="分配不会授予无限访问；任何紧急临时授权都必须关联本事件、原因和到期时间。"
            type="warning"
          />
          {mutationError === null ? null : (
            <Alert showIcon title={mutationError} type="error" />
          )}
          <label className="m04-field">
            <span>响应人员</span>
            <Select
              aria-label="选择紧急响应人员"
              loading={shiftDirectory.loading}
              notFoundContent={
                shiftDirectory.loading ? <Spin size="small" /> : '没有当前班次可分配人员'
              }
              onChange={setAssignmentId}
              optionFilterProp="label"
              options={assignmentOptions.map(({ label, value }) => ({
                label,
                value
              }))}
              placeholder="选择当前院区有效班次人员"
              showSearch
              value={assignmentId}
            />
          </label>
        </div>
      </Modal>

      <Modal
        cancelText="取消"
        confirmLoading={mutationPending}
        okButtonProps={{ danger: true, disabled: !resolveValid }}
        okText="确认处置完成"
        onCancel={() => {
          if (!mutationPending) setActiveAction(null);
        }}
        onOk={() => void submit()}
        open={activeAction === 'resolve'}
        title="提交人工现场处置结果"
      >
        <div className="m04-action-form">
          <HumanDecisionNotice />
          {mutationError === null ? null : (
            <Alert showIcon title={mutationError} type="error" />
          )}
          <label className="m04-field">
            <span>处置结果</span>
            <Select
              aria-label="选择紧急事件处置结果"
              onChange={setOutcomeCode}
              options={outcomeOptions}
              value={outcomeCode}
            />
          </label>
          <label className="m04-field">
            <span>人工处置摘要</span>
            <Input.TextArea
              aria-label="填写紧急事件处置摘要"
              autoSize={{ minRows: 4, maxRows: 7 }}
              maxLength={1_000}
              onChange={(event) => setResolutionSummary(event.target.value)}
              placeholder="至少 10 个字；只记录现场处置事实和后续安排，不填写诊断。"
              showCount
              value={resolutionSummary}
            />
          </label>
          <fieldset className="m04-checklist">
            <legend>处置完成核对</legend>
            {checklistCodes.map((code) => (
              <Checkbox
                checked={checklist.includes(code)}
                key={code}
                onChange={() =>
                  setChecklist((current) =>
                    current.includes(code)
                      ? current.filter((item) => item !== code)
                      : [...current, code]
                  )
                }
              >
                {resolutionChecklistLabel(code)}
              </Checkbox>
            ))}
          </fieldset>
          <Checkbox
            checked={familyNotify}
            onChange={(event) => setFamilyNotify(event.target.checked)}
          >
            按家属偏好请求发布隐私过滤摘要
          </Checkbox>
          <small className="m04-muted">
            家属摘要不会包含原始信号、精确位置、响应人员位置、内部备注或处置清单。
          </small>
        </div>
      </Modal>

      <Modal
        cancelText="取消"
        confirmLoading={mutationPending}
        okButtonProps={{ disabled: !reviewValid }}
        okText="确认完成复盘"
        onCancel={() => {
          if (!mutationPending) setActiveAction(null);
        }}
        onOk={() => void submit()}
        open={activeAction === 'review'}
        title="主管复盘"
      >
        <div className="m04-action-form">
          <Alert
            showIcon
            title="复盘是独立状态，不能静默跳过"
            description="选择完成复盘时必须提交总结；选择政策豁免时必须留下明确原因。"
            type="warning"
          />
          {mutationError === null ? null : (
            <Alert showIcon title={mutationError} type="error" />
          )}
          <label className="m04-field">
            <span>复盘方式</span>
            <Select
              aria-label="选择主管复盘方式"
              onChange={setReviewKind}
              options={[
                { label: '完成主管复盘', value: 'COMPLETED' },
                { label: '按政策记录豁免', value: 'WAIVED' }
              ]}
              value={reviewKind}
            />
          </label>
          {reviewKind === 'COMPLETED' ? (
            <label className="m04-field">
              <span>复盘总结</span>
              <Input.TextArea
                aria-label="填写主管复盘总结"
                autoSize={{ minRows: 4, maxRows: 7 }}
                maxLength={1_000}
                onChange={(event) => setReviewSummary(event.target.value)}
                placeholder="至少 10 个字；记录流程改进、交接和跟进事项。"
                showCount
                value={reviewSummary}
              />
            </label>
          ) : (
            <label className="m04-field">
              <span>豁免原因</span>
              <Select
                aria-label="选择复盘豁免原因"
                onChange={setWaiverReasonCode}
                options={[
                  {
                    label: '机构政策允许无需额外复盘',
                    value: 'REVIEW_NOT_REQUIRED_BY_POLICY'
                  },
                  {
                    label: '已在关联重大事件中统一复盘',
                    value: 'COVERED_BY_RELATED_INCIDENT_REVIEW'
                  }
                ]}
                value={waiverReasonCode}
              />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
