'use client';

import {
  EnvironmentOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TeamOutlined
} from '@ant-design/icons';
import type { CaregiverElderSummary, FamilyElderSummary } from '@eldercare/contracts';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { loadCaregiverElders, loadFamilyElders } from './m02-client';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: T[] };

function residenceLabel(
  residence: FamilyElderSummary['currentResidence'] | CaregiverElderSummary['currentResidence']
): string {
  if (!residence) {
    return '未共享居住信息';
  }
  return `${residence.buildingName} · ${residence.floorName} · ${residence.roomName} · ${residence.bedLabel}`;
}

function LoadingCard() {
  return (
    <section className="scoped-elder-card is-loading" aria-busy="true" aria-label="正在读取授权老人档案">
      <span className="scoped-elder-skeleton scoped-elder-skeleton-short" />
      <span className="scoped-elder-skeleton" />
      <span className="scoped-elder-skeleton" />
    </section>
  );
}

function StateCard({
  empty,
  onRetry
}: Readonly<{ empty: boolean; onRetry: () => void }>) {
  return (
    <section className="scoped-elder-card scoped-elder-state" role={empty ? 'status' : 'alert'}>
      <TeamOutlined aria-hidden="true" />
      <div>
        <strong>{empty ? '当前没有可访问的老人档案' : '暂时无法读取授权档案'}</strong>
        <p>
          {empty
            ? '只有已验证家属关系或当前有效班次内的分配才会显示。'
            : '没有展示缓存中的敏感信息，请稍后重试。'}
        </p>
      </div>
      {!empty ? (
        <button className="secondary-button scoped-retry-button" onClick={onRetry} type="button">
          <ReloadOutlined aria-hidden="true" />
          重试
        </button>
      ) : null}
    </section>
  );
}

function FamilyCard({ elder }: Readonly<{ elder: FamilyElderSummary }>) {
  return (
    <section className="scoped-elder-card" aria-labelledby={`family-elder-${elder.id}`}>
      <div className="scoped-elder-heading">
        <div>
          <span className="status-label success-label">已验证关系 · 按同意共享</span>
          <h2 id={`family-elder-${elder.id}`}>{elder.preferredName ?? elder.displayName}</h2>
        </div>
        <LockOutlined aria-hidden="true" />
      </div>
      {elder.currentResidence ? (
        <p className="scoped-elder-location">
          <EnvironmentOutlined aria-hidden="true" />
          {residenceLabel(elder.currentResidence)}
        </p>
      ) : null}
      <p className="scoped-elder-meta">
        已共享 {elder.sharedFields.length} 类字段
        {elder.careLevel ? ` · ${elder.careLevel.name}` : ''}
      </p>
      <p className="scoped-elder-safety">
        <SafetyCertificateOutlined aria-hidden="true" />
        未返回护工实时位置、内部备注、原始音频或完整对话。
      </p>
    </section>
  );
}

function CaregiverCard({ elder }: Readonly<{ elder: CaregiverElderSummary }>) {
  return (
    <section className="scoped-elder-card" aria-labelledby={`caregiver-elder-${elder.id}`}>
      <div className="scoped-elder-heading">
        <div>
          <span className="status-label info-label">当前班次授权</span>
          <h2 id={`caregiver-elder-${elder.id}`}>{elder.preferredName ?? elder.displayName}</h2>
        </div>
        <SafetyCertificateOutlined aria-hidden="true" />
      </div>
      <p className="scoped-elder-location">
        <EnvironmentOutlined aria-hidden="true" />
        {residenceLabel(elder.currentResidence)}
      </p>
      <p className="scoped-elder-meta">
        {elder.careLevel?.name ?? '护理等级待确认'} · 仅在有效班次内可见
      </p>
      {elder.operationalAttention.length > 0 ? (
        <ul className="scoped-attention-list" aria-label="操作注意事项">
          {elder.operationalAttention.slice(0, 3).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ScopedElderList({
  children,
  label,
  title
}: Readonly<{ children: ReactNode; label: string; title: string }>) {
  return (
    <section className="scoped-elder-list" aria-label={label}>
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      <div className="scoped-elder-list-items">{children}</div>
    </section>
  );
}

export function FamilyElderContext() {
  const [state, setState] = useState<LoadState<FamilyElderSummary>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setRequestVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadFamilyElders(controller.signal)
      .then((items) => setState({ status: 'ready', items }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [requestVersion]);

  if (state.status === 'loading') return <LoadingCard />;
  if (state.status === 'error') return <StateCard empty={false} onRetry={retry} />;
  if (state.items.length === 0) return <StateCard empty onRetry={retry} />;
  return (
    <ScopedElderList label="按关系和同意授权的老人档案" title="已授权老人">
      {state.items.map((elder) => <FamilyCard elder={elder} key={elder.id} />)}
    </ScopedElderList>
  );
}

export function CaregiverElderContext() {
  const [state, setState] = useState<LoadState<CaregiverElderSummary>>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setRequestVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCaregiverElders(controller.signal)
      .then((items) => setState({ status: 'ready', items }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [requestVersion]);

  if (state.status === 'loading') return <LoadingCard />;
  if (state.status === 'error') return <StateCard empty={false} onRetry={retry} />;
  if (state.items.length === 0) return <StateCard empty onRetry={retry} />;
  return (
    <ScopedElderList label="当前有效班次内的老人档案" title="当前班次老人">
      {state.items.map((elder) => <CaregiverCard elder={elder} key={elder.id} />)}
    </ScopedElderList>
  );
}
