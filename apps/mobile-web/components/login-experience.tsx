'use client';

import {
  LockOutlined,
  LoginOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { AccountMenu } from './account-menu';
import { AuthRequestError, getSession, login } from './auth-client';
import { isMobilePortal, type AuthSession } from './auth-types';
import { clearPrivateClientState, recordPrincipal } from './principal-state';

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof AuthRequestError)) {
    return '登录暂时不可用，请稍后重试。';
  }

  if (error.status === 401) {
    return '账号或密码不正确。';
  }

  if (error.status === 429) {
    return '尝试次数过多，请稍后再试。';
  }

  if (error.status === 403) {
    return '安全验证已失效，请刷新页面后重试。';
  }

  if (error.status === 0) {
    return '无法连接照护服务，请检查网络后重试。';
  }

  return '登录没有完成，请稍后重试。';
}

export function LoginExperience() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [adminSession, setAdminSession] = useState<AuthSession | null>(null);

  const continueWithSession = useCallback(
    async (session: AuthSession) => {
      await recordPrincipal(session);
      if (isMobilePortal(session.portal)) {
        router.replace(`/m/${session.portal}/home`);
        return;
      }

      setAdminSession(session);
    },
    [router]
  );

  useEffect(() => {
    let isActive = true;

    const checkExistingSession = async () => {
      try {
        const session = await getSession();
        if (isActive && session) {
          await continueWithSession(session);
        } else if (isActive) {
          await clearPrivateClientState();
        }
      } catch {
        if (isActive) {
          setError('暂时无法确认现有会话，仍可重新尝试登录。');
        }
      } finally {
        if (isActive) {
          setIsChecking(false);
        }
      }
    };

    void checkExistingSession();
    return () => {
      isActive = false;
    };
  }, [continueWithSession]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('请输入账号和密码。');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await login(username.trim(), password);
      setPassword('');
      await continueWithSession(session);
    } catch (requestError) {
      setError(loginErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (adminSession) {
    return (
      <main className="auth-stage">
        <section className="auth-card portal-unavailable-card" aria-labelledby="admin-account-title">
          <div className="auth-card-header">
            <div className="auth-mark" aria-hidden="true">
              <SafetyCertificateOutlined />
            </div>
            <p className="eyebrow">已安全登录</p>
            <h1 id="admin-account-title">此账号使用管理端</h1>
            <p>当前会话属于管理门户，移动端不会展示任何照护数据。</p>
          </div>
          <div className="inline-account-menu">
            <AccountMenu
              onSignedOut={() => {
                setAdminSession(null);
                setUsername('');
              }}
              session={adminSession}
            />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-stage">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card-header">
          <div className="auth-mark" aria-hidden="true">
            <SafetyCertificateOutlined />
          </div>
          <p className="eyebrow">安心照护</p>
          <h1 id="login-title">登录移动门户</h1>
          <p>系统会依据您的真实会话进入老人、护工或家属门户。</p>
        </div>

        <div className="security-note">
          <LockOutlined aria-hidden="true" />
          <span>角色与院区范围由服务器校验，无法在本机切换。</span>
        </div>

        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="mobile-username">账号</label>
          <div className="auth-input-wrap">
            <UserOutlined aria-hidden="true" />
            <input
              autoCapitalize="none"
              autoComplete="username"
              id="mobile-username"
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入本地演示账号"
              spellCheck={false}
              type="text"
              value={username}
            />
          </div>

          <label htmlFor="mobile-password">密码</label>
          <div className="auth-input-wrap">
            <LockOutlined aria-hidden="true" />
            <input
              autoComplete="current-password"
              id="mobile-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </div>

          {error ? (
            <p className="auth-alert auth-alert-error" role="alert">
              <WarningOutlined aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <button
            className="primary-button auth-submit-button"
            disabled={isChecking || isSubmitting}
            type="submit"
          >
            <LoginOutlined aria-hidden="true" />
            {isChecking ? '正在确认会话…' : isSubmitting ? '正在登录…' : '安全登录'}
          </button>
        </form>

        <p className="auth-footnote">仅可使用仓库文档中的虚构本地演示账号，请勿输入真实凭据。</p>
      </section>
    </main>
  );
}
