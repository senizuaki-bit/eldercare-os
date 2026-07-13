'use client';

import {
  DisconnectOutlined,
  QuestionCircleOutlined,
  StopOutlined
} from '@ant-design/icons';
import Link from 'next/link';

interface SafeStatusPageProps {
  kind: 'forbidden' | 'not-found' | 'unavailable';
  title: string;
  description: string;
}

const icons = {
  forbidden: StopOutlined,
  'not-found': QuestionCircleOutlined,
  unavailable: DisconnectOutlined
};

export function SafeStatusPage({ kind, title, description }: Readonly<SafeStatusPageProps>) {
  const StatusIcon = icons[kind];

  return (
    <main className="safe-status-page">
      <section className="safe-status-card" aria-labelledby="safe-status-title">
        <StatusIcon className="safe-status-icon" aria-hidden="true" />
        <p className="safe-status-eyebrow">
          {kind === 'forbidden' ? '访问受限' : kind === 'not-found' ? '安全提示' : '连接异常'}
        </p>
        <h1 id="safe-status-title">{title}</h1>
        <p>{description}</p>
        <Link className="safe-status-action" href="/">
          {kind === 'unavailable' ? '重新尝试' : '返回可访问首页'}
        </Link>
      </section>
    </main>
  );
}
