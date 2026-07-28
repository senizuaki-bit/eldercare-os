'use client';

import {
  CalendarOutlined,
  FileTextOutlined,
  HomeOutlined,
  LockOutlined,
  MedicineBoxOutlined,
  NotificationOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccountMenu } from './account-menu';
import type { AuthSession } from './auth-types';
import {
  CaregiverTaskDetail,
  CaregiverTasksPanel,
  ElderVoiceRequestPage,
  FamilySummariesPanel
} from './m03-workflows';
import {
  CaregiverEmergenciesPanel,
  CaregiverEmergencyDetail,
  ElderEmergencyPage,
  FamilyEmergencyPanel
} from './m04-workflows';
import { CaregiverHome, ElderHome, FamilyHome, SecondaryShell } from './role-homes';
import type { Role } from './types';
import { isRoleSectionPath, roleLabels } from './types';

interface TabDefinition {
  readonly icon: ReactNode;
  readonly key: string;
  readonly label: string;
}

const tabsByRole: Record<Role, readonly TabDefinition[]> = {
  caregiver: [
    { icon: <HomeOutlined aria-hidden="true" />, key: 'home', label: '首页' },
    { icon: <UnorderedListOutlined aria-hidden="true" />, key: 'tasks', label: '任务' },
    { icon: <FileTextOutlined aria-hidden="true" />, key: 'handover', label: '交班' },
    { icon: <UserOutlined aria-hidden="true" />, key: 'profile', label: '我的' }
  ],
  elder: [
    { icon: <HomeOutlined aria-hidden="true" />, key: 'home', label: '首页' },
    { icon: <CalendarOutlined aria-hidden="true" />, key: 'schedule', label: '安排' },
    { icon: <TeamOutlined aria-hidden="true" />, key: 'family', label: '家属' },
    { icon: <UserOutlined aria-hidden="true" />, key: 'profile', label: '我的' }
  ],
  family: [
    { icon: <HomeOutlined aria-hidden="true" />, key: 'home', label: '首页' },
    { icon: <NotificationOutlined aria-hidden="true" />, key: 'events', label: '动态' },
    { icon: <MedicineBoxOutlined aria-hidden="true" />, key: 'services', label: '服务' },
    { icon: <UserOutlined aria-hidden="true" />, key: 'profile', label: '我的' }
  ]
};

interface MobileExperienceProps {
  readonly initialPath?: readonly string[];
  readonly onSignedOut: () => void;
  readonly role: Role;
  readonly session: AuthSession;
}

interface PortalRoute {
  readonly detailId?: string;
  readonly section: string;
}

function getInitialRoute(role: Role, requestedPath: readonly string[] | undefined): PortalRoute {
  const path = requestedPath ?? ['home'];
  if (!isRoleSectionPath(role, path)) return { section: 'home' };
  return { detailId: path[1], section: path[0] ?? 'home' };
}

function portalPath(role: Role, route: PortalRoute): string {
  const suffix = route.detailId ? `/${encodeURIComponent(route.detailId)}` : '';
  return `/m/${role}/${route.section}${suffix}`;
}

function updatePortalPath(role: Role, route: PortalRoute, replace = false): void {
  if (typeof window !== 'undefined') {
    const path = portalPath(role, route);
    if (replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
  }
}

function routesMatch(left: PortalRoute, right: PortalRoute): boolean {
  return left.section === right.section && left.detailId === right.detailId;
}

function routeFromWindow(role: Role): PortalRoute | null {
  if (typeof window === 'undefined') return null;
  const prefix = `/m/${role}/`;
  if (!window.location.pathname.startsWith(prefix)) return null;
  const path = window.location.pathname.slice(prefix.length).split('/').filter(Boolean);
  return isRoleSectionPath(role, path)
    ? { detailId: path[1], section: path[0] ?? 'home' }
    : null;
}

export function MobileExperience({
  initialPath,
  onSignedOut,
  role,
  session
}: MobileExperienceProps) {
  const [route, setRoute] = useState(() => getInitialRoute(role, initialPath));
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [navigationBlockNotice, setNavigationBlockNotice] = useState('');
  const routeRef = useRef(route);
  const navigationBlockedRef = useRef(navigationBlocked);
  routeRef.current = route;
  navigationBlockedRef.current = navigationBlocked;
  const activeTabs = tabsByRole[role];
  const activeTab = activeTabs.some((tab) => tab.key === route.section) ? route.section : 'home';
  const activeTabDefinition = useMemo(
    () => activeTabs.find((tab) => tab.key === activeTab) ?? activeTabs[0],
    [activeTab, activeTabs]
  );

  const handleNavigationBlockChange = useCallback((blocked: boolean) => {
    navigationBlockedRef.current = blocked;
    setNavigationBlocked(blocked);
    if (!blocked) setNavigationBlockNotice('');
  }, []);

  const showNavigationBlocked = useCallback(() => {
    setNavigationBlockNotice(
      '当前操作尚未得到服务器最终确认。请使用页面内的返回、取消或提交操作，确认完成后再离开。'
    );
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = routeFromWindow(role);
      if (
        navigationBlockedRef.current &&
        (nextRoute === null || !routesMatch(routeRef.current, nextRoute))
      ) {
        window.history.pushState(null, '', portalPath(role, routeRef.current));
        showNavigationBlocked();
        return;
      }
      if (nextRoute) setRoute(nextRoute);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [role, showNavigationBlocked]);

  const switchTab = (tab: TabDefinition) => {
    const nextRoute = { section: tab.key };
    if (navigationBlockedRef.current && !routesMatch(routeRef.current, nextRoute)) {
      showNavigationBlocked();
      return;
    }
    setRoute(nextRoute);
    updatePortalPath(role, nextRoute);
  };

  const navigate = (section: string, detailId?: string, replace = false) => {
    const nextRoute = { detailId, section };
    if (!isRoleSectionPath(role, detailId ? [section, detailId] : [section])) return;
    setNavigationBlockNotice('');
    setRoute(nextRoute);
    updatePortalPath(role, nextRoute, replace);
  };

  const renderCurrentPage = () => {
    if (role === 'elder' && route.section === 'emergency') {
      return (
        <ElderEmergencyPage
          initialEmergencyId={route.detailId}
          onEmergencyCreated={(emergencyId) =>
            navigate('emergency', emergencyId, true)
          }
          onExit={() => navigate('home')}
          onNavigationBlockChange={handleNavigationBlockChange}
        />
      );
    }

    if (role === 'elder' && route.section === 'voice-request') {
      return (
        <ElderVoiceRequestPage
          initialSubmissionId={route.detailId}
          onExit={() => navigate('home')}
          onNavigationBlockChange={handleNavigationBlockChange}
          onSubmissionCreated={(submissionId) => navigate('voice-request', submissionId, true)}
        />
      );
    }

    if (role === 'caregiver' && route.section === 'emergencies') {
      if (route.detailId) {
        return (
          <CaregiverEmergencyDetail
            emergencyId={route.detailId}
            onBack={() => navigate('emergencies')}
            onNavigationBlockChange={handleNavigationBlockChange}
          />
        );
      }
      return (
        <div className="role-page caregiver-emergencies-page">
          <section className="role-intro emergency-role-intro" aria-labelledby="caregiver-emergencies-page-title">
            <p className="eyebrow">护工端 · 最高优先级</p>
            <h1 id="caregiver-emergencies-page-title">紧急任务</h1>
            <p>紧急事件始终排在常规工单之前；打开详情后服务端会再次鉴权。</p>
          </section>
          <CaregiverEmergenciesPanel
            onSelect={(emergencyId) => navigate('emergencies', emergencyId)}
          />
        </div>
      );
    }

    if (role === 'caregiver' && route.section === 'tasks') {
      if (route.detailId) {
        return (
          <CaregiverTaskDetail
            onBack={() => navigate('tasks')}
            onNavigationBlockChange={handleNavigationBlockChange}
            workOrderId={route.detailId}
          />
        );
      }
      return (
        <div className="role-page caregiver-tasks-page">
          <section className="role-intro" aria-labelledby="caregiver-tasks-page-title">
            <p className="eyebrow">护工端 · 当前班次</p>
            <h1 id="caregiver-tasks-page-title">我的任务</h1>
            <p>优先任务排在前面；打开详情后服务器会再次鉴权。</p>
          </section>
          <CaregiverTasksPanel onSelect={(workOrderId) => navigate('tasks', workOrderId)} />
        </div>
      );
    }

    if (role === 'family' && route.section === 'events') {
      return (
        <div className="role-page family-events-page">
          <section className="role-intro" aria-labelledby="family-events-page-title">
            <p className="eyebrow">家属端 · 照护动态</p>
            <h1 id="family-events-page-title">已发布摘要</h1>
            <p>只显示经过关系、同意和隐私过滤的发布内容。</p>
          </section>
          <FamilyEmergencyPanel />
          <FamilySummariesPanel />
        </div>
      );
    }

    if (route.section !== 'home') {
      return (
        <SecondaryShell
          label={activeTabDefinition?.label ?? '当前'}
          onReturnHome={() => {
            const homeTab = activeTabs[0];
            if (homeTab) {
              switchTab(homeTab);
            }
          }}
          role={role}
        />
      );
    }

    if (role === 'elder') {
      return <ElderHome displayName={session.user.displayName} onNavigate={navigate} />;
    }

    if (role === 'caregiver') {
      return <CaregiverHome onNavigate={navigate} />;
    }

    return <FamilyHome />;
  };

  return (
    <div className={`mobile-stage role-${role}`}>
      <div className="mobile-app">
        <header className="mobile-header">
          <div className="fixture-banner">
            <LockOutlined aria-hidden="true" />
            <span>服务器会话已确认 · 业务结果以服务端为准</span>
          </div>
          <div className="mobile-topbar">
            <div className="product-lockup">
              <strong>安心照护</strong>
              <span>{roleLabels[role]}</span>
            </div>
            <AccountMenu
              navigationBlocked={navigationBlocked}
              onSignedOut={onSignedOut}
              session={session}
            />
          </div>
        </header>

        <main className="mobile-main">
          {navigationBlockNotice ? (
            <div className="workflow-alert workflow-alert-info" role="alert">
              <LockOutlined aria-hidden="true" />
              <span>{navigationBlockNotice}</span>
            </div>
          ) : null}
          {renderCurrentPage()}
        </main>

        <nav className="bottom-navigation" aria-label={`${roleLabels[role]}底部导航`}>
          {activeTabs.map((tab) => (
            <button
              aria-current={activeTab === tab.key ? 'page' : undefined}
              className={activeTab === tab.key ? 'is-active' : undefined}
              key={tab.key}
              onClick={() => switchTab(tab)}
              type="button"
            >
              <span className="bottom-nav-icon" aria-hidden="true">
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
