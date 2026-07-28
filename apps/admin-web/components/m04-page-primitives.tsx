'use client';

import {
  AlertFilled,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DisconnectOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  HomeOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { Alert, Breadcrumb, Button, Card, Result, Tag } from 'antd';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  EmergencyLocationProjection,
  EmergencySlaStage,
  EmergencyStatus
} from '../lib/m04-contract';
import type { DirectoryFailure } from './use-scoped-directory';

export const EMERGENCY_STATUS_LABELS: Record<EmergencyStatus, string> = {
  OPEN: '待确认',
  ACKNOWLEDGED: '已确认',
  RESPONDING: '响应中',
  RESOLVED: '已处置',
  REVIEWED: '已复盘'
};

export const EMERGENCY_SLA_LABELS: Record<EmergencySlaStage, string> = {
  ACKNOWLEDGEMENT: '确认时限',
  ARRIVAL: '到场时限',
  RESOLUTION: '处置时限'
};

export const EMERGENCY_SOURCE_LABELS = {
  ELDER_BUTTON: '老人一键求助',
  IOT_BUTTON: '设备紧急按钮',
  STAFF_MANUAL: '工作人员人工上报',
  VOICE_RISK: '语音风险规则'
} as const;

export const EMERGENCY_REASON_LABELS: Readonly<Record<string, string>> = {
  ELDER_BUTTON_PRESSED: '老人主动按下紧急求助',
  IOT_EMERGENCY_BUTTON: '设备上报紧急按钮信号',
  STAFF_REPORTED_EMERGENCY: '工作人员人工确认紧急情况',
  VOICE_RISK_CONFIRMED: '语音风险经确定性规则转入人工应急流程'
};

export const RESOLUTION_CHECKLIST_LABELS: Readonly<Record<string, string>> = {
  SCENE_SAFETY_CONFIRMED: '已确认现场环境安全，避免二次风险',
  ELDER_STATE_CONFIRMED: '已核对老人当前状态并记录现场观察',
  FOLLOW_UP_HANDOFF_CONFIRMED: '已安排后续观察、交接或专业人员接续'
};

export function emergencyReasonLabel(reasonCode: string): string {
  return EMERGENCY_REASON_LABELS[reasonCode] ?? '按机构应急规则创建并进入人工处置';
}

export function resolutionChecklistLabel(code: string): string {
  return RESOLUTION_CHECKLIST_LABELS[code] ?? '已完成服务端要求的处置核对项';
}

export function formatEmergencyDateTime(value: string | null): string {
  if (value === null) return '尚未记录';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '时间不可用';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

export function M04PageHeader({
  actions,
  description,
  section,
  title
}: Readonly<{
  actions?: ReactNode;
  description: string;
  section: string;
  title: string;
}>) {
  return (
    <>
      <Breadcrumb
        className="page-breadcrumb"
        items={[
          { title: <Link href="/"><HomeOutlined aria-label="首页" /></Link> },
          { title: section },
          { title }
        ]}
      />
      <div className="page-heading-row m04-page-heading">
        <div>
          <div className="heading-title-line">
            <h1>{title}</h1>
            <Tag color="red" icon={<AlertFilled />}>M04 紧急响应</Tag>
          </div>
          <p>{description}</p>
        </div>
        {actions === undefined ? null : <div className="m04-page-actions">{actions}</div>}
      </div>
    </>
  );
}

export function M04FailureCard({
  failure,
  onRetry,
  resourceName
}: Readonly<{
  failure: Exclude<DirectoryFailure, null>;
  onRetry: () => void;
  resourceName: string;
}>) {
  const forbidden = failure === 'forbidden';
  const notFound = failure === 'not-found';
  const offline = failure === 'offline';
  return (
    <Card className="m04-surface-card">
      <Result
        status={forbidden ? '403' : notFound ? '404' : 'error'}
        icon={offline ? <DisconnectOutlined /> : forbidden ? <LockOutlined /> : undefined}
        title={
          forbidden
            ? `无权查看${resourceName}`
            : notFound
              ? `${resourceName}不存在或不可访问`
              : offline
                ? '当前网络不可用'
                : `无法读取${resourceName}`
        }
        subTitle={
          forbidden || notFound
            ? '系统不会透露其他机构、院区或授权范围外的紧急记录。'
            : '没有展示旧事件，也不会把过期信息标为当前状态。'
        }
        extra={
          forbidden ? undefined : (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>重新加载</Button>
          )
        }
      />
    </Card>
  );
}

export function M04FacilityRequiredCard() {
  return (
    <Card className="m04-surface-card">
      <Result
        status="warning"
        title="请先选择院区"
        subTitle="紧急事件按院区隔离。请选择一个已授权院区后继续。"
      />
    </Card>
  );
}

export function M04StaleAlert({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <Alert
      banner
      showIcon
      type="warning"
      title="刷新失败，页面已进入过期状态。"
      description="暂停所有处置操作；重新同步后服务端仍会校验版本，避免覆盖其他响应人员的进展。"
      action={<Button size="small" onClick={onRetry}>重新同步</Button>}
    />
  );
}

export function EmergencyStatusBadge({ status }: Readonly<{ status: EmergencyStatus }>) {
  const icon =
    status === 'OPEN'
      ? <AlertFilled />
      : status === 'ACKNOWLEDGED' || status === 'RESPONDING'
        ? <ClockCircleOutlined />
        : <CheckCircleOutlined />;
  const color =
    status === 'OPEN'
      ? 'error'
      : status === 'ACKNOWLEDGED'
        ? 'warning'
        : status === 'RESPONDING'
          ? 'processing'
          : 'success';
  const description = {
    OPEN: '尚未由值班人员确认',
    ACKNOWLEDGED: '已有人负责，等待出发或到场',
    RESPONDING: '响应人员正在前往或已到场处置',
    RESOLVED: '现场处置完成，等待主管复盘',
    REVIEWED: '主管复盘已完成'
  }[status];
  return (
    <span className="m04-status-stack" aria-label={`${EMERGENCY_STATUS_LABELS[status]}：${description}`}>
      <Tag
        color={color}
        icon={icon}
        style={status === 'OPEN' ? { color: '#a8071a' } : undefined}
      >
        {EMERGENCY_STATUS_LABELS[status]}
      </Tag>
      <small>{description}</small>
    </span>
  );
}

function formatDuration(totalSeconds: number): string {
  const absolute = Math.abs(totalSeconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  const seconds = absolute % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export function EmergencySlaTimer({
  deadlineAt,
  stage
}: Readonly<{
  deadlineAt: string | null;
  stage?: EmergencySlaStage | undefined;
}>) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineAt === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  const details = useMemo(() => {
    if (deadlineAt === null) {
      return {
        description: '当前状态没有待执行的 SLA 阈值',
        overdue: false,
        text: '无进行中时限'
      };
    }
    const deadline = new Date(deadlineAt).getTime();
    if (!Number.isFinite(deadline)) {
      return {
        description: '时限数据不可用，请重新同步',
        overdue: true,
        text: '时限未知'
      };
    }
    const remainingSeconds = Math.ceil((deadline - now) / 1_000);
    return remainingSeconds < 0
      ? {
          description: `已超过${stage ? EMERGENCY_SLA_LABELS[stage] : '当前时限'}，升级由服务端幂等执行`,
          overdue: true,
          text: `超时 ${formatDuration(remainingSeconds)}`
        }
      : {
          description: `${stage ? EMERGENCY_SLA_LABELS[stage] : '当前时限'}剩余时间`,
          overdue: false,
          text: formatDuration(remainingSeconds)
        };
  }, [deadlineAt, now, stage]);

  return (
    <span className="m04-sla-timer" aria-live="off" aria-label={`${details.text}：${details.description}`}>
      <Tag
        color={details.overdue ? 'error' : deadlineAt === null ? 'default' : 'warning'}
        icon={details.overdue ? <WarningOutlined /> : <ClockCircleOutlined />}
      >
        {details.text}
      </Tag>
      <small>{details.description}</small>
    </span>
  );
}

export function EmergencyLocationBadge({
  location
}: Readonly<{ location: EmergencyLocationProjection }>) {
  const current = location.state === 'CURRENT';
  const fallback = location.state === 'ROOM_FALLBACK';
  const stale = location.state === 'STALE';
  const label = current
    ? '位置当前有效'
    : stale
      ? '位置已过期'
      : fallback
        ? '使用房间回退'
        : '位置未知';
  const description = current
    ? `${location.label ?? '已取得位置'} · ${location.source}`
    : stale
      ? '不可将最后位置当作实时位置；请按房间或人工确认'
      : fallback
        ? `${location.label ?? '房间待确认'} · 未使用实时定位`
        : '尚未收到有效位置，请联系现场人员确认';
  return (
    <span className="m04-location-stack" aria-label={`${label}：${description}`}>
      <Tag
        color={current ? 'success' : stale ? 'error' : fallback ? 'warning' : 'default'}
        icon={current ? <EnvironmentOutlined /> : <ExclamationCircleOutlined />}
      >
        {label}
      </Tag>
      <small>{description}</small>
    </span>
  );
}

export function HumanDecisionNotice() {
  return (
    <Alert
      type="warning"
      showIcon
      icon={<SafetyCertificateOutlined />}
      title="紧急状态只能由有权限的人工作出决定"
      description="AI 可提示疑似风险，但不能确认无风险、处置完成或跳过主管复盘。"
    />
  );
}
