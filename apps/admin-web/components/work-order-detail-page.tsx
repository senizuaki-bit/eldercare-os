'use client';

import type { CompletionChecklistCode } from '@eldercare/contracts';
import {
  ArrowLeftOutlined,
  AuditOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  LinkOutlined,
  LockOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WarningOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography
} from 'antd';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { apiFetch } from '../lib/api-client';
import { parseStaffPage, type ScopedPage as StaffPage, type StaffProfile } from '../lib/m02-contract';
import {
  M03_API_PATHS,
  parseWorkOrderDetail,
  validateWorkOrderAssignRequest,
  validateWorkOrderTransitionRequest,
  withQuery,
  type DeterministicRuleProjection,
  type WorkOrderAdminDetail
} from '../lib/m03-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  formatDateTime,
  M03FacilityRequiredCard,
  M03FailureCard,
  M03PageHeader,
  M03StaleAlert,
  NEED_CATEGORY_LABELS,
  PRIORITY_LABELS,
  RiskBadge,
  safeShortId,
  SlaBadge,
  WORK_ORDER_STATUS_LABELS,
  WorkOrderStatusBadge
} from './m03-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type TransitionAction = 'verify' | 'close';

const completionChecklistLabels: Record<CompletionChecklistCode, string> = {
  RECIPIENT_STATE_CONFIRMED: '已核对服务对象当前反应，并记录需要继续跟进的信息',
  SERVICE_RESULT_CONFIRMED: '已核对本次服务实际结果与完成说明一致',
  FOLLOW_UP_RISK_REVIEWED: '已核对需要继续交接或升级的风险事项'
};

const fallbackRuleCopy: Record<string, { label: string; explanation: string; severity: DeterministicRuleProjection['severity'] }> = {
  DIZZINESS: {
    label: '疑似眩晕表述',
    explanation: '固定关键词规则要求优先人工核对身体不适与跌倒风险。',
    severity: 'WARNING'
  },
  FALL: {
    label: '跌倒相关表述',
    explanation: '固定规则要求立即复核跌倒或失衡信号，并由人工决定是否升级。',
    severity: 'CRITICAL'
  },
  CHEST_PAIN: {
    label: '胸部不适表述',
    explanation: '固定规则要求立即交由人工判断；AI 不能作出医疗结论。',
    severity: 'CRITICAL'
  },
  BREATHING: {
    label: '呼吸不适表述',
    explanation: '固定规则要求立即人工确认现场情况与应急处置需求。',
    severity: 'CRITICAL'
  },
  EMERGENCY: {
    label: '紧急求助表述',
    explanation: '固定规则要求进入人工应急判断，不由 AI 单独决定升级。',
    severity: 'CRITICAL'
  }
};

function deriveRules(detail: WorkOrderAdminDetail): DeterministicRuleProjection[] {
  if (detail.ruleResults !== undefined) return detail.ruleResults;
  return detail.need.safetyRuleCodes.map((code) => ({
    code,
    ...(fallbackRuleCopy[code] ?? {
      label: '安全规则命中',
      explanation: '该规则由确定性检查产生；具体处置仍需结合现场情况与授权流程。',
      severity: 'WARNING' as const
    })
  }));
}

function ruleColor(severity: DeterministicRuleProjection['severity']): string {
  if (severity === 'CRITICAL') return 'error';
  if (severity === 'WARNING') return 'warning';
  return 'blue';
}

function mutationFailureText(status: number, action: 'assign' | TransitionAction): string {
  const actionLabel = action === 'assign' ? '分配' : action === 'verify' ? '验证' : '关闭';
  if (status === 403) return `当前账号没有${actionLabel}该工单的权限。`;
  if (status === 404) return '该工单已不存在或不在当前授权范围内。';
  if (status === 409) return '工单已被其他人员更新，页面已重新同步。请核对最新状态后再操作。';
  if (status === 422) return `当前状态不允许${actionLabel}，请先完成前置流程。`;
  return `${actionLabel}失败，请稍后重试。`;
}

function detailTimeline(detail: WorkOrderAdminDetail) {
  const transitions = detail.transitions.map((transition) => ({
    occurredAt: transition.occurredAt,
    item: {
      color: transition.toStatus === 'CANCELLED' ? 'gray' : transition.toStatus === 'CLOSED' ? 'green' : 'blue',
      content: (
        <div className="m03-timeline-entry">
          <strong>{transition.fromStatus === null ? '创建工单' : `${WORK_ORDER_STATUS_LABELS[transition.fromStatus]} → ${WORK_ORDER_STATUS_LABELS[transition.toStatus]}`}</strong>
          <span>{formatDateTime(transition.occurredAt)}</span>
          <small>原因 {transition.reasonCode} · 操作者 {safeShortId(transition.actorUserId)} · 版本 {transition.fromVersion} → {transition.toVersion}</small>
        </div>
      )
    }
  }));
  const arrivals = detail.arrivals.map((arrival) => ({
    occurredAt: arrival.arrivedAt,
    item: {
      color: 'green',
      content: (
        <div className="m03-timeline-entry">
          <strong>照护人员已到达现场（非状态迁移）</strong>
          <span>{formatDateTime(arrival.arrivedAt)}</span>
          <small>原因 {arrival.reasonCode} · 操作者 {safeShortId(arrival.actorUserId)} · 版本 {arrival.fromVersion} → {arrival.toVersion}</small>
        </div>
      )
    }
  }));
  return [...transitions, ...arrivals]
    .sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())
    .map(({ item }) => item);
}

export function WorkOrderDetailPage({ workOrderId }: Readonly<{ workOrderId: string }>) {
  const { message } = AntApp.useApp();
  const { session } = useAdminShellSearch();
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assignReason, setAssignReason] = useState('SUPERVISOR_ASSIGNMENT');
  const [transitionAction, setTransitionAction] = useState<TransitionAction | null>(null);
  const [transitionReason, setTransitionReason] = useState('SUPERVISOR_VERIFIED');
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationFailure, setMutationFailure] = useState<string | null>(null);

  const detailUrl = facilityId === null
    ? ''
    : M03_API_PATHS.workOrder(organizationId, facilityId, workOrderId);
  const parseDetail = useCallback(
    (value: unknown): WorkOrderAdminDetail =>
      parseWorkOrderDetail(value, organizationId, facilityId ?? '', workOrderId),
    [facilityId, organizationId, workOrderId]
  );
  const directory = useScopedDirectory({ enabled: facilityId !== null, parse: parseDetail, url: detailUrl });

  const staffParams = useMemo(
    () => new URLSearchParams({
      page: '1',
      pageSize: '100',
      status: 'ACTIVE',
      sort: 'displayName',
      direction: 'asc'
    }),
    []
  );
  const staffUrl = facilityId === null
    ? ''
    : withQuery(M03_API_PATHS.staffCandidates(organizationId, facilityId), staffParams);
  const parseStaff = useCallback(
    (value: unknown): StaffPage<StaffProfile> =>
      parseStaffPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const staffDirectory = useScopedDirectory({
    enabled: assignOpen && facilityId !== null,
    parse: parseStaff,
    url: staffUrl
  });

  const detail = directory.data;
  const rules = detail === null ? [] : deriveRules(detail);
  const assignmentLocked = detail === null || ['COMPLETED', 'VERIFIED', 'CLOSED', 'CANCELLED'].includes(detail.status);

  const submitAssignment = async () => {
    if (detail === null || facilityId === null || assigneeId === null || mutationPending) return;
    setMutationFailure(null);
    setMutationPending(true);
    try {
      const payload = validateWorkOrderAssignRequest({
        expectedVersion: detail.version,
        assigneeStaffProfileId: assigneeId,
        reasonCode: assignReason
      });
      const response = await apiFetch(
        M03_API_PATHS.assignWorkOrder(organizationId, facilityId, detail.id),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (response.status === 401) {
        window.location.assign('/login?reason=expired');
        return;
      }
      if (!response.ok) {
        setMutationFailure(mutationFailureText(response.status, 'assign'));
        if (response.status === 409) directory.retry();
        return;
      }
      void message.success('工单已分配，服务端已记录负责人、版本和审计原因。');
      setAssignOpen(false);
      setAssigneeId(null);
      directory.retry();
    } catch {
      setMutationFailure(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? '当前处于离线状态，分配没有提交。'
          : '分配信息不完整或服务暂不可用，请重试。'
      );
    } finally {
      setMutationPending(false);
    }
  };

  const submitTransition = async () => {
    if (detail === null || facilityId === null || transitionAction === null || mutationPending) return;
    setMutationFailure(null);
    setMutationPending(true);
    try {
      const targetStatus = transitionAction === 'verify' ? 'VERIFIED' : 'CLOSED';
      const payload = validateWorkOrderTransitionRequest({
        expectedVersion: detail.version,
        targetStatus,
        reasonCode: transitionReason
      });
      const path = transitionAction === 'verify'
        ? M03_API_PATHS.verifyWorkOrder(organizationId, facilityId, detail.id)
        : M03_API_PATHS.closeWorkOrder(organizationId, facilityId, detail.id);
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) {
        window.location.assign('/login?reason=expired');
        return;
      }
      if (!response.ok) {
        setMutationFailure(mutationFailureText(response.status, transitionAction));
        if (response.status === 409) directory.retry();
        return;
      }
      void message.success(transitionAction === 'verify' ? '工单完成记录已验证。' : '工单已关闭。');
      setTransitionAction(null);
      directory.retry();
    } catch {
      setMutationFailure(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? '当前处于离线状态，状态变更没有提交。'
          : '状态变更未提交，请检查原因后重试。'
      );
    } finally {
      setMutationPending(false);
    }
  };

  return (
    <div className="m03-page work-order-detail-page">
      <M03PageHeader
        section="照护运营 / 工单管理"
        title={detail?.title ?? '工单详情'}
        description="在单一审计视图中核对请求来源、AI 建议、确定性规则、负责人、SLA 与后续摘要。"
        actions={
          <Space wrap>
            <Link className="ant-btn ant-btn-default" href="/work-orders"><ArrowLeftOutlined />返回工单列表</Link>
            <Button
              aria-label={detail?.currentAssignment === null ? '分配负责人' : '重新分配'}
              icon={<UserSwitchOutlined />}
              disabled={assignmentLocked || directory.stale}
              onClick={() => {
                setMutationFailure(null);
                setAssigneeId(detail?.currentAssignment?.assigneeStaffProfileId ?? null);
                setAssignOpen(true);
              }}
            >
              {detail?.currentAssignment === null ? '分配负责人' : '重新分配'}
            </Button>
            <Button
              aria-label="验证完成记录"
              type="primary"
              icon={<SafetyCertificateOutlined />}
              disabled={detail?.status !== 'COMPLETED' || directory.stale}
              onClick={() => {
                setMutationFailure(null);
                setTransitionReason('SUPERVISOR_VERIFIED');
                setTransitionAction('verify');
              }}
            >
              验证完成记录
            </Button>
            <Button
              aria-label="关闭工单"
              icon={<LockOutlined />}
              disabled={detail?.status !== 'VERIFIED' || directory.stale}
              onClick={() => {
                setMutationFailure(null);
                setTransitionReason('SUPERVISOR_CLOSED');
                setTransitionAction('close');
              }}
            >
              关闭工单
            </Button>
          </Space>
        }
      />

      {facilityId === null ? <M03FacilityRequiredCard /> : directory.failure !== null && directory.data === null ? (
        <M03FailureCard failure={directory.failure} onRetry={directory.retry} resourceName="工单详情" />
      ) : detail === null ? (
        <Card className="m03-surface-card m03-detail-loading" aria-live="polite">
          <Spin size="large" description="正在读取工单详情" />
        </Card>
      ) : (
        <>
          {directory.stale ? <M03StaleAlert onRetry={directory.retry} /> : null}
          {mutationFailure === null ? null : (
            <Alert
              className="m03-action-alert"
              type="error"
              showIcon
              closable
              title={mutationFailure}
              onClose={() => setMutationFailure(null)}
            />
          )}
          <Card className="m03-summary-card">
            <div className="m03-summary-main">
              <span className="m03-code">{detail.code}</span>
              <div>
                <strong>{detail.elder?.preferredName ?? detail.elder?.displayName ?? `老人 ${safeShortId(detail.elderId)}`}</strong>
                <small>{detail.elder?.roomLabel ?? '房间信息未随响应提供'} · 审计引用 {safeShortId(detail.correlationId)}</small>
              </div>
            </div>
            <WorkOrderStatusBadge status={detail.status} />
            <RiskBadge priority={detail.priority} />
            <SlaBadge completedAt={detail.completedAt} dueAt={detail.dueAt} status={detail.status} />
          </Card>

          <div className="m03-detail-grid">
            <Card
              className="m03-detail-card"
              title={<h2><FileTextOutlined aria-hidden="true" /> 请求来源</h2>}
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="来源">
                  {detail.need.source === 'VOICE' ? '老人语音请求' : '人工录入'}
                </Descriptions.Item>
                <Descriptions.Item label="安全摘要">{detail.need.summary}</Descriptions.Item>
                <Descriptions.Item label="需求类别">{NEED_CATEGORY_LABELS[detail.need.category]}</Descriptions.Item>
                <Descriptions.Item label="接收时间">{formatDateTime(detail.need.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="来源编号">需求 {safeShortId(detail.need.id)}{detail.need.voiceSubmissionId === null ? '' : ` · 语音 ${safeShortId(detail.need.voiceSubmissionId)}`}</Descriptions.Item>
              </Descriptions>
              <Alert
                className="m03-card-note"
                type="info"
                showIcon
                title="最小化展示"
                description="此运营页不展示原始音频或完整转写，避免不必要地扩散敏感内容。"
              />
              {detail.linkedNeeds.length === 0 ? null : (
                <div className="m03-linked-needs">
                  <strong><LinkOutlined /> 关联需求</strong>
                  {detail.linkedNeeds.map((need) => (
                    <Tag key={need.id}>{NEED_CATEGORY_LABELS[need.category]} · {safeShortId(need.id)}</Tag>
                  ))}
                </div>
              )}
            </Card>

            <Card
              className="m03-detail-card"
              title={<h2><RobotOutlined aria-hidden="true" /> AI 建议（非最终决定）</h2>}
            >
              <Alert
                type="warning"
                showIcon
                title="AI 输出仅供参考"
                description="确定性规则与有权限的工作人员决定风险升级、分配、验证和关闭。"
              />
              <Descriptions column={1} size="small" className="m03-card-descriptions">
                <Descriptions.Item label="建议类别">{NEED_CATEGORY_LABELS[detail.need.category]}</Descriptions.Item>
                <Descriptions.Item label="建议紧迫度">{PRIORITY_LABELS[detail.need.urgencySuggestion]}</Descriptions.Item>
                <Descriptions.Item label="人工复核">{detail.need.requiresHumanReview ? '必须人工复核' : '未被 AI 标记为必须复核'}</Descriptions.Item>
                <Descriptions.Item label="置信度">
                  {detail.analysis?.confidence == null ? '响应未提供' : `${Math.round(detail.analysis.confidence * 100)}%`}
                </Descriptions.Item>
                <Descriptions.Item label="模型记录">
                  {detail.analysis === undefined || detail.analysis === null
                    ? '响应未提供分析元数据'
                    : `${detail.analysis.provider} / ${detail.analysis.model} / 提示词 ${detail.analysis.promptVersion}`}
                </Descriptions.Item>
              </Descriptions>
              {detail.analysis?.evidence.length ? (
                <div className="m03-evidence-list">
                  <strong>审计证据摘要</strong>
                  <ul>{detail.analysis.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ) : null}
            </Card>

            <Card
              className="m03-detail-card"
              title={<h2><WarningOutlined aria-hidden="true" /> 确定性风险规则</h2>}
            >
              {rules.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有命中确定性升级规则" />
              ) : (
                <ul className="m03-rule-list">
                  {rules.map((rule) => (
                    <li className="m03-rule-item" key={rule.code}>
                      <div>
                        <Tag color={ruleColor(rule.severity)}>{rule.label}</Tag>
                        <code>{rule.code}</code>
                        <p>{rule.explanation}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="m03-rule-decision">
                <RiskBadge priority={detail.priority} />
                <p>当前工单优先级由服务端规则与人工复核结果确定，不直接采用 LLM 的单独判断。</p>
              </div>
            </Card>

            <Card
              className="m03-detail-card"
              title={<h2><TeamOutlined aria-hidden="true" /> 负责人和 SLA</h2>}
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="当前负责人">
                  {detail.currentAssignment === null
                    ? '尚未分配'
                    : detail.assignee?.displayName ?? `人员 ${safeShortId(detail.currentAssignment.assigneeStaffProfileId ?? detail.currentAssignment.targetTeamId ?? detail.currentAssignment.id)}`}
                </Descriptions.Item>
                <Descriptions.Item label="岗位">
                  {detail.assignee?.jobTitle ?? '响应未提供岗位信息'}
                </Descriptions.Item>
                <Descriptions.Item label="分配状态">
                  {detail.currentAssignment?.status ?? '未分配'}
                </Descriptions.Item>
                <Descriptions.Item label="分配时间">
                  {formatDateTime(detail.currentAssignment?.assignedAt ?? null)}
                </Descriptions.Item>
                <Descriptions.Item label="现场到达">
                  {formatDateTime(detail.arrivedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="计划完成">
                  {formatDateTime(detail.dueAt)}
                </Descriptions.Item>
              </Descriptions>
              <div className="m03-sla-panel"><SlaBadge completedAt={detail.completedAt} dueAt={detail.dueAt} status={detail.status} /></div>
            </Card>

            <Card
              className="m03-detail-card m03-timeline-card"
              title={<h2><AuditOutlined aria-hidden="true" /> 不可变状态时间线</h2>}
              extra={<Tag icon={<LockOutlined />}>仅追加审计</Tag>}
            >
              {detail.transitions.length === 0 && detail.arrivals.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="响应中尚无状态迁移记录" />
              ) : (
                <Timeline items={detailTimeline(detail)} />
              )}
            </Card>

            <Card
              className="m03-detail-card"
              title={<h2><FileProtectOutlined aria-hidden="true" /> 内部完成记录</h2>}
            >
              {detail.completion === null ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="照护人员尚未提交完成记录" />
              ) : (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="记录方式">{detail.completion.noteSource === 'VOICE' ? '语音完成记录' : '文字完成记录'}</Descriptions.Item>
                  <Descriptions.Item label="记录人员">{safeShortId(detail.completion.submittedByStaffProfileId)}</Descriptions.Item>
                  <Descriptions.Item label="确认时间">{formatDateTime(detail.completion.confirmedAt)}</Descriptions.Item>
                  <Descriptions.Item label="内部说明">
                    {detail.completion.noteSource === 'TEXT'
                      ? detail.completion.noteText
                      : '语音记录已受控保存；此页不播放原始音频或显示完整转写。'}
                  </Descriptions.Item>
                  {detail.completion.completionChecklist.required ? (
                    <>
                      <Descriptions.Item label="清单确认时间">
                        {formatDateTime(detail.completion.checklistConfirmedAt)}
                      </Descriptions.Item>
                      <Descriptions.Item
                        label={`高风险完成清单（版本 ${detail.completion.completionChecklist.schemaVersion}）`}
                      >
                        <ul className="m03-completion-checklist-audit" aria-label="已确认的高风险完成清单">
                          {detail.completion.completionChecklist.confirmations.map((item) => (
                            <li key={item.code}>
                              <Tag color="success" icon={<SafetyCertificateOutlined />}>已确认</Tag>
                              <span>{completionChecklistLabels[item.code]}</span>
                              <small>{formatDateTime(item.confirmedAt)}</small>
                            </li>
                          ))}
                        </ul>
                        <small>
                          风险快照：{detail.completion.completionChecklist.riskReasons.join('、')}
                        </small>
                      </Descriptions.Item>
                    </>
                  ) : (
                    <Descriptions.Item label="结构化完成清单">
                      该工单完成时未要求高风险清单。
                    </Descriptions.Item>
                  )}
                </Descriptions>
              )}
            </Card>

            <Card
              className="m03-detail-card"
              title={<h2><SendOutlined aria-hidden="true" /> 家属安全摘要</h2>}
            >
              {detail.familySummary === undefined || detail.familySummary === null ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="尚无已生成的家属安全摘要；系统不会根据内部记录自行拼接内容。"
                />
              ) : (
                <div className="m03-family-summary">
                  <Space wrap>
                    <Tag color={detail.familySummary.status === 'PUBLISHED' ? 'success' : 'blue'}>
                      {detail.familySummary.status === 'PUBLISHED' ? '已发布' : detail.familySummary.status === 'REVOKED' ? '已撤回' : '草稿'}
                    </Tag>
                    <small>服务完成于 {formatDateTime(detail.familySummary.serviceCompletedAt)}</small>
                  </Space>
                  <h3>{detail.familySummary.title}</h3>
                  <p>{detail.familySummary.summary}</p>
                </div>
              )}
              <Alert
                className="m03-card-note"
                type="info"
                showIcon
                title="隐私过滤边界"
                description="家属视图不包含内部照护记录、原始语音、完整转写或工作人员实时位置。"
              />
            </Card>
          </div>
        </>
      )}

      <Modal
        open={assignOpen}
        title="分配工单负责人"
        okText="确认分配"
        cancelText="取消"
        confirmLoading={mutationPending}
        okButtonProps={{ disabled: assigneeId === null || staffDirectory.failure !== null }}
        onOk={() => void submitAssignment()}
        onCancel={() => {
          if (!mutationPending) setAssignOpen(false);
        }}
      >
        <div className="m03-review-form">
          <Alert
            type="info"
            showIcon
            title="仅显示当前院区在职员工"
            description="服务端会再次校验员工范围、当前班次和工单访问关系。"
          />
          {mutationFailure === null ? null : <Alert type="error" showIcon title={mutationFailure} />}
          {staffDirectory.failure === null ? null : (
            <Alert
              type="error"
              showIcon
              title={staffDirectory.failure === 'forbidden' ? '无权读取可分配人员' : '可分配人员暂不可用'}
              action={staffDirectory.failure === 'forbidden' ? undefined : <Button size="small" onClick={staffDirectory.retry}>重试</Button>}
            />
          )}
          <label className="m03-field">
            <span>负责人</span>
            <Select
              showSearch
              aria-label="选择工单负责人"
              loading={staffDirectory.loading}
              value={assigneeId}
              placeholder="选择当前院区在职员工"
              optionFilterProp="label"
              options={(staffDirectory.data?.items ?? []).map((staff) => ({
                value: staff.id,
                label: `${staff.displayName} · ${staff.jobTitle}`
              }))}
              notFoundContent={staffDirectory.loading ? <Spin size="small" /> : '没有可分配员工'}
              onChange={setAssigneeId}
            />
          </label>
          <label className="m03-field">
            <span>审计原因</span>
            <Select
              aria-label="选择分配原因"
              value={assignReason}
              options={[
                { value: 'SUPERVISOR_ASSIGNMENT', label: '主管日常分配' },
                { value: 'SLA_REASSIGNMENT', label: 'SLA 风险重新分配' },
                { value: 'SHIFT_HANDOFF', label: '班次交接' }
              ]}
              onChange={setAssignReason}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={transitionAction !== null}
        title={transitionAction === 'verify' ? '验证完成记录' : '关闭工单'}
        okText={transitionAction === 'verify' ? '确认验证' : '确认关闭'}
        cancelText="取消"
        confirmLoading={mutationPending}
        onOk={() => void submitTransition()}
        onCancel={() => {
          if (!mutationPending) setTransitionAction(null);
        }}
      >
        <div className="m03-review-form">
          <Alert
            type={transitionAction === 'close' ? 'warning' : 'info'}
            showIcon
            title={transitionAction === 'verify' ? '请核对内部完成记录和现场结果' : '关闭后工单进入终态'}
            description="服务端会校验当前版本、允许的状态迁移与操作权限，并写入不可变时间线。"
          />
          {mutationFailure === null ? null : <Alert type="error" showIcon title={mutationFailure} />}
          <label className="m03-field">
            <span>审计原因</span>
            <Select
              aria-label="选择状态变更原因"
              value={transitionReason}
              options={transitionAction === 'verify'
                ? [
                    { value: 'SUPERVISOR_VERIFIED', label: '主管核验完成记录' },
                    { value: 'ELDER_CONFIRMED', label: '老人确认服务结果' }
                  ]
                : [
                    { value: 'SUPERVISOR_CLOSED', label: '主管确认闭环' },
                    { value: 'ELDER_REVIEW_COMPLETE', label: '老人评价流程完成' }
                  ]}
              onChange={setTransitionReason}
            />
          </label>
          <Typography.Paragraph type="secondary">
            当前版本：{detail?.version ?? '—'} · 当前状态：{detail === null ? '—' : WORK_ORDER_STATUS_LABELS[detail.status]}
          </Typography.Paragraph>
        </div>
      </Modal>
    </div>
  );
}
