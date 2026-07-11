'use client';

import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';

export function OfflineContent() {
  return (
    <main className="standalone-state-page">
      <section className="standalone-state-card" aria-labelledby="offline-title">
        <DisconnectOutlined className="standalone-state-icon" aria-hidden="true" />
        <p className="eyebrow">离线保护</p>
        <h1 id="offline-title">暂时无法连接</h1>
        <p>请检查网络后重试。尚未连接后端，页面不会把本地演示操作标记为真实成功。</p>
        <a className="primary-link-button" href="/m/elder/home">
          <ReloadOutlined aria-hidden="true" />
          返回演示首页
        </a>
        <p className="fixture-disclaimer">本页面仅用于 M00 PWA 离线降级演示。</p>
      </section>
    </main>
  );
}
