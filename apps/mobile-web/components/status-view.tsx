import {
  ClockCircleOutlined,
  DisconnectOutlined,
  InboxOutlined,
  LockOutlined,
  LoadingOutlined,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons';

import type { DemoMode } from './types';

type VisibleDemoMode = Exclude<DemoMode, 'normal'>;

interface StatusViewProps {
  mode: VisibleDemoMode;
  onRecover: () => void;
}

const statusContent: Record<VisibleDemoMode, { description: string; eyebrow: string; title: string }> = {
  empty: {
    description: '当前没有固定演示事项。真实业务接入后，可从这里查看最新内容。',
    eyebrow: '空状态演示',
    title: '暂时没有内容'
  },
  error: {
    description: '演示数据加载失败。页面不会用旧内容假装成功，您可以返回正常壳页。',
    eyebrow: '错误状态演示',
    title: '这次没有加载成功'
  },
  forbidden: {
    description: '当前演示角色没有访问权限。页面不会绕过授权，也不会显示受限信息。',
    eyebrow: '权限状态演示',
    title: '您无权查看此内容'
  },
  loading: {
    description: '正在准备本地虚构数据。此状态不会触发后端请求。',
    eyebrow: '加载状态演示',
    title: '正在加载页面'
  },
  offline: {
    description: '当前以断网降级状态展示。未连接后端的操作不会标记为真实完成。',
    eyebrow: '离线状态演示',
    title: '网络已断开'
  },
  stale: {
    description: '固定演示信息已超过展示时效，必须重新确认，不能当作当前状态。',
    eyebrow: '过期状态演示',
    title: '信息已过期'
  }
};

function StatusIcon({ mode }: Readonly<{ mode: VisibleDemoMode }>) {
  if (mode === 'loading') {
    return <LoadingOutlined className="status-view-icon is-spinning" aria-hidden="true" />;
  }

  if (mode === 'empty') {
    return <InboxOutlined className="status-view-icon" aria-hidden="true" />;
  }

  if (mode === 'error') {
    return <WarningOutlined className="status-view-icon warning-icon" aria-hidden="true" />;
  }

  if (mode === 'offline') {
    return <DisconnectOutlined className="status-view-icon" aria-hidden="true" />;
  }

  if (mode === 'forbidden') {
    return <LockOutlined className="status-view-icon forbidden-icon" aria-hidden="true" />;
  }

  return <ClockCircleOutlined className="status-view-icon stale-icon" aria-hidden="true" />;
}

export function StatusView({ mode, onRecover }: StatusViewProps) {
  const content = statusContent[mode];

  return (
    <section className="status-view" aria-labelledby="status-view-title" aria-live="polite">
      <StatusIcon mode={mode} />
      <p className="eyebrow">{content.eyebrow}</p>
      <h1 id="status-view-title">{content.title}</h1>
      <p>{content.description}</p>
      {mode === 'loading' ? (
        <p className="fixture-disclaimer">正在显示固定演示状态，不会无限等待。</p>
      ) : (
        <button className="primary-button status-recover-button" onClick={onRecover} type="button">
          <ReloadOutlined aria-hidden="true" />
          返回正常演示
        </button>
      )}
    </section>
  );
}
