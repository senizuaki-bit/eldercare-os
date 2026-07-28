'use client';

import {
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DisconnectOutlined,
  ExclamationCircleOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import { Alert, Breadcrumb, Button, Card, Result, Tag } from 'antd';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { NeedAdminItem, WorkOrderAdminItem } from '../lib/m03-contract';
import type { DirectoryFailure } from './use-scoped-directory';

type NeedPriority = NeedAdminItem['priority'];
type NeedStatus = NeedAdminItem['status'];
type WorkOrderStatus = WorkOrderAdminItem['status'];

export const NEED_CATEGORY_LABELS: Record<NeedAdminItem['category'], string> = {
  DAILY_LIVING: '日常生活',
  HEALTH_CONCERN: '健康关注',
  EMERGENCY_CONCERN: '紧急关注',
  EMOTIONAL_SUPPORT: '情绪陪伴',
  FACILITY_SUPPORT: '设施支持',
  OTHER: '其他'
};

export const NEED_STATUS_LABELS: Record<NeedStatus, string> = {
  DRAFT: '草稿',
  REVIEW_REQUIRED: '待人工复核',
  CONFIRMED: '已确认',
  REJECTED: '已驳回',
  FULFILLED: '已履行',
  CANCELLED: '已取消'
};

export const PRIORITY_LABELS: Record<NeedPriority, string> = {
  ROUTINE: '常规',
  PRIORITY: '优先',
  IMMEDIATE_REVIEW: '立即复核'
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  NEW: '新建',
  ASSIGNED: '已分配',
  ACCEPTED: '已接单',
  IN_PROGRESS: '处理中',
  COMPLETED: '待验证',
  VERIFIED: '已验证',
  CLOSED: '已关闭',
  CANCELLED: '已取消'
};

const priorityDescription: Record<NeedPriority, string> = {
  ROUTINE: '按常规照护时效处理',
  PRIORITY: '需要优先安排并持续跟进',
  IMMEDIATE_REVIEW: '需要主管立即进行人工判断'
};

export function M03PageHeader({
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
      <div className="page-heading-row m03-page-heading">
        <div>
          <div className="heading-title-line">
            <h1>{title}</h1>
            <Tag color="blue">M03 需求与工单</Tag>
          </div>
          <p>{description}</p>
        </div>
        {actions === undefined ? null : <div className="m03-page-actions">{actions}</div>}
      </div>
    </>
  );
}

export function M03FailureCard({
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
    <Card className="m03-surface-card">
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
            ? '系统不会透露其他机构、院区或授权范围外的记录。'
            : '没有显示旧数据。请恢复连接后重新读取。'
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

export function M03StaleAlert({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <Alert
      banner
      showIcon
      type="warning"
      title="刷新失败，以下为本次会话最后成功读取的结果，可能已经过期。"
      description="执行分配、验证或关闭前请重新同步；服务端仍会校验版本，避免覆盖其他人的更新。"
      action={<Button size="small" onClick={onRetry}>重新同步</Button>}
    />
  );
}

export function M03FacilityRequiredCard() {
  return (
    <Card className="m03-surface-card">
      <Result
        status="warning"
        title="请先选择院区"
        subTitle="需求与工单按院区隔离。请选择一个已授权院区后继续。"
      />
    </Card>
  );
}

export function RiskBadge({ priority }: Readonly<{ priority: NeedPriority }>) {
  const icon = priority === 'IMMEDIATE_REVIEW'
    ? <AlertOutlined />
    : priority === 'PRIORITY'
      ? <ExclamationCircleOutlined />
      : <InfoCircleOutlined />;
  const color = priority === 'IMMEDIATE_REVIEW' ? 'error' : priority === 'PRIORITY' ? 'warning' : 'blue';
  return (
    <span className={`m03-risk m03-risk-${priority.toLowerCase()}`} aria-label={`${PRIORITY_LABELS[priority]}风险：${priorityDescription[priority]}`}>
      <Tag icon={icon} color={color}>{PRIORITY_LABELS[priority]}</Tag>
      <small>{priorityDescription[priority]}</small>
    </span>
  );
}

export function NeedStatusBadge({ status }: Readonly<{ status: NeedStatus }>) {
  const color = status === 'REVIEW_REQUIRED'
    ? 'warning'
    : status === 'CONFIRMED' || status === 'FULFILLED'
      ? 'success'
      : status === 'REJECTED' || status === 'CANCELLED'
        ? 'default'
        : 'blue';
  return <Tag color={color}>{NEED_STATUS_LABELS[status]}</Tag>;
}

export function WorkOrderStatusBadge({ status }: Readonly<{ status: WorkOrderStatus }>) {
  const color = status === 'NEW'
    ? 'blue'
    : status === 'ASSIGNED' || status === 'ACCEPTED' || status === 'IN_PROGRESS'
      ? 'processing'
      : status === 'COMPLETED'
        ? 'warning'
        : status === 'VERIFIED' || status === 'CLOSED'
          ? 'success'
          : 'default';
  const icon = status === 'VERIFIED' || status === 'CLOSED'
    ? <CheckCircleOutlined />
    : status === 'COMPLETED'
      ? <SafetyCertificateOutlined />
      : <ClockCircleOutlined />;
  return <Tag icon={icon} color={color}>{WORK_ORDER_STATUS_LABELS[status]}</Tag>;
}

export function SlaBadge({
  completedAt,
  dueAt,
  status
}: Readonly<{ completedAt?: string | null; dueAt: string; status: WorkOrderStatus }>) {
  const serviceFinished = status === 'COMPLETED' || status === 'VERIFIED' || status === 'CLOSED';
  const terminal = status === 'CLOSED' || status === 'CANCELLED';
  const due = new Date(dueAt);
  const comparisonTime = serviceFinished && completedAt !== null && completedAt !== undefined
    ? new Date(completedAt).getTime()
    : Date.now();
  const overdue = status !== 'CANCELLED' && due.getTime() < comparisonTime;
  const text = status === 'CANCELLED'
    ? 'SLA 已取消'
    : serviceFinished
      ? overdue ? '逾期完成' : '按时完成'
      : overdue ? '已逾期' : '时限内';
  const description = terminal
    ? '该工单已进入终态，保留最终时效结果'
    : serviceFinished
      ? overdue ? '完成时间超过计划时限' : '完成时间在计划时限内'
    : overdue
      ? '已超过计划完成时间，需要说明与跟进'
      : '仍在计划完成时间内';
  return (
    <span className="m03-sla" aria-label={`${text}：${description}`}>
      <Tag icon={overdue ? <AlertOutlined /> : <ClockCircleOutlined />} color={overdue ? 'error' : terminal ? 'default' : 'success'}>
        {text}
      </Tag>
      <small>{description}</small>
    </span>
  );
}

export function formatDateTime(value: string | null): string {
  if (value === null) return '尚未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function safeShortId(value: string): string {
  return `…${value.slice(-8)}`;
}
