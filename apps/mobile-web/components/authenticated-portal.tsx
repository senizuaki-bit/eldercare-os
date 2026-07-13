'use client';

import {
  DisconnectOutlined,
  LoginOutlined,
  LoadingOutlined,
  LockOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { getSession } from './auth-client';
import { isMobilePortal, type AuthSession } from './auth-types';
import { MobileExperience } from './mobile-experience';
import { clearPrivateClientState, recordPrincipal } from './principal-state';
import type { Role } from './types';

interface AuthenticatedPortalProps {
  readonly initialTab?: string;
  readonly requestedRole: Role;
}

function ProtectedStatus({
  action,
  actionIcon,
  actionLabel,
  description,
  icon,
  isBusy = false,
  title
}: Readonly<{
  action?: () => void;
  actionIcon?: ReactNode;
  actionLabel?: string;
  description: string;
  icon: ReactNode;
  isBusy?: boolean;
  title: string;
}>) {
  return (
    <main className="protected-state-stage">
      <section
        aria-busy={isBusy}
        aria-labelledby="protected-state-title"
        aria-live={isBusy ? 'polite' : undefined}
        className="protected-state-card"
      >
        <div className="protected-state-account">
          <strong>安心照护</strong>
        </div>
        <div className="protected-state-icon" aria-hidden="true">
          {icon}
        </div>
        <p className="eyebrow">受保护门户</p>
        <h1 id="protected-state-title">{title}</h1>
        <p>{description}</p>
        {action && actionLabel ? (
          <button className="primary-button protected-state-action" onClick={action} type="button">
            {actionIcon ?? <ReloadOutlined aria-hidden="true" />}
            {actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function AuthenticatedPortal({ initialTab, requestedRole }: AuthenticatedPortalProps) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadSession = useCallback(async () => {
    setStatus('loading');
    try {
      const activeSession = await getSession();
      if (!activeSession) {
        await clearPrivateClientState();
        router.replace('/login');
        return;
      }

      await recordPrincipal(activeSession);
      setSession(activeSession);
      setStatus('ready');
    } catch {
      setSession(null);
      setStatus('error');
    }
  }, [router]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  if (status === 'loading') {
    return (
      <ProtectedStatus
        description="正在向服务器确认账号、角色与院区范围，不会显示缓存中的照护内容。"
        icon={<LoadingOutlined className="is-spinning" />}
        isBusy
        title="正在验证会话"
      />
    );
  }

  if (status === 'error') {
    return (
      <ProtectedStatus
        action={() => void loadSession()}
        actionLabel="重新验证"
        description="无法连接认证服务。为保护隐私，本页不会回退到旧门户数据。"
        icon={<DisconnectOutlined />}
        title="暂时无法确认权限"
      />
    );
  }

  if (!session) {
    return null;
  }

  if (session.portal !== requestedRole) {
    const authorizedEntry = isMobilePortal(session.portal)
      ? `/m/${session.portal}/home`
      : '/login';

    return (
      <ProtectedStatus
        action={() => router.replace(authorizedEntry)}
        actionIcon={<LoginOutlined aria-hidden="true" />}
        actionLabel="进入授权门户"
        description="当前会话与网址中的门户角色不一致。系统已隐藏全部页面数据，请从账号授权入口进入。"
        icon={<LockOutlined />}
        title="您无权查看此门户"
      />
    );
  }

  return (
    <MobileExperience
      initialTab={initialTab}
      onSignedOut={() => router.replace('/login')}
      role={requestedRole}
      session={session}
    />
  );
}
