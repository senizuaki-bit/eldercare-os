import { HomeIcon, NotFoundIcon } from '../components/not-found-icons';

export default function NotFoundPage() {
  return (
    <main className="protected-state-stage">
      <section className="protected-state-card" aria-labelledby="not-found-title">
        <div className="protected-state-account">
          <strong>安心照护</strong>
        </div>
        <div className="protected-state-icon" aria-hidden="true">
          <NotFoundIcon />
        </div>
        <p className="eyebrow">安全页面</p>
        <h1 id="not-found-title">未找到此页面</h1>
        <p>页面不存在或当前入口不可用。这里不会显示任何账号、角色或照护数据。</p>
        <a className="primary-link-button protected-state-action" href="/">
          <HomeIcon />
          返回安全入口
        </a>
      </section>
    </main>
  );
}
