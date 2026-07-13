'use client';

import {
  DisconnectOutlined,
  HomeOutlined,
  LockOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { Alert, Breadcrumb, Button, Card, Result, Tag } from 'antd';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { DirectoryFailure } from './use-scoped-directory';

interface DirectoryPageHeaderProps {
  actions?: ReactNode;
  description: string;
  section: string;
  title: string;
}

export function DirectoryPageHeader({
  actions,
  description,
  section,
  title
}: DirectoryPageHeaderProps) {
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
      <div className="page-heading-row m02-page-heading">
        <div>
          <div className="heading-title-line">
            <h1>{title}</h1>
            <Tag color="blue">M02 运营目录</Tag>
          </div>
          <p>{description}</p>
        </div>
        {actions === undefined ? null : <div className="m02-page-actions">{actions}</div>}
      </div>
    </>
  );
}

interface DirectoryFailureCardProps {
  failure: Exclude<DirectoryFailure, null>;
  onRetry: () => void;
  resourceName: string;
}

export function DirectoryFailureCard({
  failure,
  onRetry,
  resourceName
}: DirectoryFailureCardProps) {
  const forbidden = failure === 'forbidden';
  const notFound = failure === 'not-found';
  const offline = failure === 'offline';

  return (
    <Card className="m02-surface-card">
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
            ? '系统不会透露其他机构、院区或访问范围外的记录。'
            : '未显示旧目录数据。请恢复连接后重新读取。'
        }
        extra={
          forbidden ? undefined : (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              重新加载
            </Button>
          )
        }
      />
    </Card>
  );
}

export function DirectoryStaleAlert({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <Alert
      banner
      showIcon
      type="warning"
      title="刷新失败，以下为本次会话内最后成功读取的结果，请勿视为最新状态。"
      action={<Button size="small" onClick={onRetry}>重新同步</Button>}
    />
  );
}

export function FacilityRequiredCard() {
  return (
    <Card className="m02-surface-card">
      <Result
        status="warning"
        title="请先选择院区"
        subTitle="运营目录按院区隔离。请选择一个已授权院区后继续。"
      />
    </Card>
  );
}
