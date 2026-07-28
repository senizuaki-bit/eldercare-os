'use client';

import {
  CloseOutlined,
  DownOutlined,
  EnvironmentOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  UserOutlined
} from '@ant-design/icons';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { logout } from './auth-client';
import type { AuthSession } from './auth-types';
import { clearPrivateClientState } from './principal-state';

interface AccountMenuProps {
  readonly navigationBlocked?: boolean;
  readonly onSignedOut: () => void;
  readonly session: AuthSession;
}

export function AccountMenu({
  navigationBlocked = false,
  onSignedOut,
  session
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    window.queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleDialogKeys);
    };
  }, [closeMenu, isOpen]);

  const handleLogout = async () => {
    setError('');
    setIsSigningOut(true);

    try {
      await logout();
      await clearPrivateClientState();
      setIsOpen(false);
      onSignedOut();
    } catch {
      setError('退出没有完成，当前会话仍可能有效。请检查网络后重试。');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <>
      <button
        aria-controls={isOpen ? dialogId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="account-menu-trigger"
        onClick={() => {
          setError('');
          setIsOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <UserOutlined aria-hidden="true" />
        <span>{session.user.displayName}</span>
        <DownOutlined aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="selector-layer">
          <button
            aria-label="点击背景关闭账号菜单"
            className="selector-scrim"
            onClick={closeMenu}
            tabIndex={-1}
            type="button"
          />
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="account-menu-sheet"
            id={dialogId}
            ref={dialogRef}
            role="dialog"
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-heading">
              <div>
                <p className="eyebrow">当前账号</p>
                <h2 id={titleId}>{session.user.displayName}</h2>
              </div>
              <button
                aria-label="关闭账号菜单"
                className="icon-button"
                onClick={closeMenu}
                ref={closeButtonRef}
                type="button"
              >
                <CloseOutlined aria-hidden="true" />
              </button>
            </div>

            <dl className="account-details">
              <div>
                <dt>
                  <UserOutlined aria-hidden="true" />
                  登录账号
                </dt>
                <dd>{session.user.username}</dd>
              </div>
              <div>
                <dt>
                  <SafetyCertificateOutlined aria-hidden="true" />
                  当前角色
                </dt>
                <dd>{session.roles.map((role) => role.label).join('、') || '未分配角色'}</dd>
              </div>
              <div>
                <dt>
                  <EnvironmentOutlined aria-hidden="true" />
                  当前范围
                </dt>
                <dd>
                  {session.activeContext.organizationName} ·{' '}
                  {session.activeContext.facilityName ?? '全机构范围'}
                </dd>
              </div>
            </dl>

            {error ? (
              <p className="auth-alert auth-alert-error" role="alert">
                {error}
              </p>
            ) : null}

            {navigationBlocked ? (
              <p className="workflow-alert workflow-alert-info" role="status">
                当前操作尚未得到服务器最终确认。请先关闭菜单，并在当前页面提交或取消后再退出。
              </p>
            ) : null}

            <button
              className="danger-button full-width-button account-logout-button"
              disabled={isSigningOut || navigationBlocked}
              onClick={() => void handleLogout()}
              type="button"
            >
              <LogoutOutlined aria-hidden="true" />
              {isSigningOut ? '正在安全退出…' : '退出登录'}
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
