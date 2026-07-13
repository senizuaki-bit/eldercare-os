'use client';

import {
  AlertOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  DownOutlined,
  FileDoneOutlined,
  HomeOutlined,
  LaptopOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MedicineBoxOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  UserSwitchOutlined
} from '@ant-design/icons';
import { App as AntApp, Badge, Button, Dropdown, Input, Select, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

import { apiFetch } from '../lib/api-client';
import { parseAuthSession, type AuthSession, type SessionContext } from '../lib/auth-contract';

interface AdminShellProps {
  children: ReactNode;
  session: AuthSession;
  onNavigate?: (path: string) => void;
  onReload?: () => void;
}

interface AdminShellSearchValue {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  session: AuthSession;
}

interface NavigationItem {
  key: string;
  label: string;
  icon: ReactNode;
  path?: string;
  milestone?: string;
  badge?: number;
  markCurrent?: boolean;
}

const AdminShellSearchContext = createContext<AdminShellSearchValue | null>(null);

const navigationItems: NavigationItem[] = [
  { key: 'home', label: '工作台', icon: <HomeOutlined />, path: '/' },
  {
    key: 'risk',
    label: '风险待办',
    icon: <AlertOutlined />,
    path: '/',
    badge: 4,
    markCurrent: true
  },
  { key: 'orders', label: '工单管理', icon: <ProfileOutlined />, milestone: 'M03' },
  { key: 'residents', label: '入住管理', icon: <ApartmentOutlined />, milestone: 'M02' },
  { key: 'care', label: '照护计划', icon: <MedicineBoxOutlined />, milestone: 'M02' },
  { key: 'devices', label: '设备管理', icon: <LaptopOutlined />, milestone: 'M05' },
  { key: 'reports', label: '报表中心', icon: <BarChartOutlined />, milestone: 'M09' },
  { key: 'agents', label: '智能体审批', icon: <FileDoneOutlined />, milestone: 'M15' },
  { key: 'users', label: '用户管理', icon: <TeamOutlined />, path: '/users', markCurrent: true },
  { key: 'roles', label: '角色权限', icon: <UserSwitchOutlined />, path: '/roles', markCurrent: true },
  { key: 'settings', label: '审计设置', icon: <SettingOutlined />, milestone: 'M10' }
];

function contextKey(context: SessionContext): string {
  return `${context.organizationId}|${context.facilityId ?? ''}`;
}

function contextLabel(context: SessionContext): string {
  return context.facilityName === null
    ? `${context.organizationName} · 机构级范围`
    : `${context.organizationName} · ${context.facilityName}`;
}

function isCurrentPath(pathname: string, item: NavigationItem): boolean {
  if (!item.markCurrent || item.path === undefined) {
    return false;
  }

  return item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
}

export function useAdminShellSearch(): AdminShellSearchValue {
  const value = useContext(AdminShellSearchContext);

  if (value === null) {
    throw new Error('useAdminShellSearch must be used within AdminShell');
  }

  return value;
}

export function AdminShell({
  children,
  session,
  onNavigate = (path) => window.location.assign(path),
  onReload = () => window.location.reload()
}: Readonly<AdminShellProps>) {
  const pathname = usePathname();
  const { message } = AntApp.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextPending, setContextPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(() => {
    setSearchTerm('');
  }, [pathname]);

  const contexts = useMemo(() => {
    const uniqueContexts = new Map<string, SessionContext>();
    uniqueContexts.set(contextKey(session.activeContext), session.activeContext);
    for (const context of session.availableContexts) {
      uniqueContexts.set(contextKey(context), context);
    }
    return [...uniqueContexts.values()];
  }, [session.activeContext, session.availableContexts]);

  const switchContext = async (nextKey: string) => {
    const context = contexts.find((candidate) => contextKey(candidate) === nextKey);
    if (context === undefined || nextKey === contextKey(session.activeContext)) {
      return;
    }

    setContextPending(true);
    try {
      const response = await apiFetch('/auth/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: context.organizationId,
          facilityId: context.facilityId
        })
      });

      if (response.status === 401) {
        onNavigate('/login?reason=expired');
        return;
      }

      if (response.status === 403 || response.status === 404) {
        onNavigate('/forbidden');
        return;
      }

      if (!response.ok) {
        throw new Error('context switch failed');
      }

      const nextSession = parseAuthSession(await response.json());
      if (
        nextSession.activeContext.organizationId !== context.organizationId ||
        nextSession.activeContext.facilityId !== context.facilityId
      ) {
        throw new Error('context switch response mismatch');
      }

      setContextPending(false);
      void message.success(`已切换到${contextLabel(nextSession.activeContext)}`);
      onReload();
    } catch {
      void message.error('院区切换失败，当前页面仍使用原访问范围。');
      setContextPending(false);
    }
  };

  const logout = async () => {
    if (logoutPending) {
      return;
    }

    setLogoutPending(true);
    try {
      const response = await apiFetch('/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) {
        throw new Error('logout failed');
      }

      onNavigate('/login?reason=logout');
    } catch {
      void message.error('退出失败，会话仍然有效，请稍后重试。');
      setLogoutPending(false);
    }
  };

  const notificationMenu: MenuProps = {
    items: [
      { key: 'one', label: '8 项紧急事件待确认（演示）' },
      { key: 'two', label: '6 台关键设备处于离线状态（演示）' }
    ]
  };

  const roleSummary = session.roles.map((role) => role.label).join('、') || '未分配角色';
  const profileMenu: MenuProps = {
    items: [
      { key: 'identity', label: `${session.user.displayName}（${session.user.username}）`, disabled: true },
      { key: 'roles', label: `授权角色：${roleSummary}`, disabled: true },
      { key: 'scope', label: `当前范围：${contextLabel(session.activeContext)}`, disabled: true },
      { type: 'divider' },
      { key: 'logout', label: logoutPending ? '正在退出…' : '安全退出', icon: <LockOutlined /> }
    ],
    onClick: ({ key }) => {
      if (key === 'logout') {
        void logout();
      }
    }
  };

  const searchValue = useMemo(
    () => ({ searchTerm, setSearchTerm, session }),
    [searchTerm, session]
  );

  return (
    <AdminShellSearchContext.Provider value={searchValue}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <div className={`admin-shell ${collapsed ? 'admin-shell-collapsed' : ''}`}>
        <aside className="sidebar" aria-label="主导航">
          <div className="sidebar-brand">
            <SafetyCertificateOutlined aria-hidden="true" />
            {!collapsed && <span>照护<br />运营台</span>}
          </div>

          <nav className="sidebar-nav">
            {navigationItems.map((item) => {
              const current = isCurrentPath(pathname, item);
              const label = `${item.label}${item.milestone ? ` · ${item.milestone}` : ''}`;
              const content = (
                <>
                  <Badge count={item.badge} size="small" offset={[5, 0]}>
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  </Badge>
                  {!collapsed && <span className="nav-label">{item.label}</span>}
                  {!collapsed && item.milestone && <span className="nav-milestone">{item.milestone}</span>}
                </>
              );

              return (
                <Tooltip key={item.key} placement="right" title={collapsed ? label : undefined}>
                  {item.path === undefined ? (
                    <button type="button" className="nav-item" aria-label={collapsed ? item.label : undefined} disabled>
                      {content}
                    </button>
                  ) : (
                    <Link
                      className={`nav-item ${current ? 'nav-item-active' : ''}`}
                      href={item.path}
                      aria-current={current ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                    >
                      {content}
                    </Link>
                  )}
                </Tooltip>
              );
            })}
          </nav>

          <button
            type="button"
            className="sidebar-collapse"
            aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            {!collapsed && <span>折叠导航</span>}
          </button>
        </aside>

        <header className="topbar">
          <div className="topbar-title">
            <strong>照护运营台</strong>
            <Select
              aria-label="切换机构和院区访问范围"
              className="facility-select"
              disabled={contexts.length < 2}
              loading={contextPending}
              value={contextKey(session.activeContext)}
              options={contexts.map((context) => ({
                value: contextKey(context),
                label: contextLabel(context)
              }))}
              onChange={(value: string) => void switchContext(value)}
            />
          </div>

          <Input.Search
            className="global-search"
            aria-label="搜索当前页面"
            placeholder="搜索当前页面"
            allowClear
            prefix={<SearchOutlined aria-hidden="true" />}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onSearch={setSearchTerm}
          />

          <div className="topbar-actions">
            <Badge status="success" text="受保护会话" className="fixture-badge" />
            <span className="topbar-divider" aria-hidden="true" />
            <span className="date-display"><SafetyCertificateOutlined aria-hidden="true" />后端权限已启用</span>
            <span className="topbar-divider" aria-hidden="true" />
            <Dropdown menu={notificationMenu} trigger={['click']} placement="bottomRight">
              <Tooltip title="通知">
                <Button
                  type="text"
                  shape="circle"
                  className="topbar-icon-button"
                  aria-label="查看通知"
                  icon={<Badge dot><BellOutlined /></Badge>}
                />
              </Tooltip>
            </Dropdown>
            <Dropdown menu={profileMenu} trigger={['click']} placement="bottomRight">
              <Button type="text" className="profile-button" aria-label="打开个人菜单" loading={logoutPending}>
                <UserOutlined aria-hidden="true" />
                <span>{session.user.displayName}</span>
                <DownOutlined aria-hidden="true" />
              </Button>
            </Dropdown>
          </div>
        </header>

        <main className="dashboard-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </AdminShellSearchContext.Provider>
  );
}
