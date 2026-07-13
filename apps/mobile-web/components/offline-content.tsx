'use client';

import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';

export function OfflineContent() {
  return (
    <main className="standalone-state-page">
      <section className="standalone-state-card" aria-labelledby="offline-title">
        <DisconnectOutlined className="standalone-state-icon" aria-hidden="true" />
        <p className="eyebrow">离线保护</p>
        <h1 id="offline-title">暂时无法连接</h1>
        <p>请检查网络后重试。为保护隐私，离线时不会展示老人、护工或家属门户内容。</p>
        <a className="primary-link-button" href="/">
          <ReloadOutlined aria-hidden="true" />
          重新连接
        </a>
        <p className="fixture-disclaimer">恢复网络后，系统会重新验证账号与数据范围。</p>
      </section>
    </main>
  );
}
