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
import { useMemo, useState } from 'react';

import { AccountMenu } from './account-menu';
import type { AuthSession } from './auth-types';
import { CaregiverHome, ElderHome, FamilyHome, SecondaryShell } from './role-homes';
import type { Role } from './types';
import { roleLabels } from './types';

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
  readonly initialTab?: string;
  readonly onSignedOut: () => void;
  readonly role: Role;
  readonly session: AuthSession;
}

function getInitialTab(role: Role, requestedTab: string | undefined): string {
  const roleTabs = tabsByRole[role];
  return roleTabs.some((tab) => tab.key === requestedTab) ? (requestedTab ?? 'home') : 'home';
}

function updatePortalPath(role: Role, tab: string): void {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', `/m/${role}/${tab}`);
  }
}

export function MobileExperience({
  initialTab,
  onSignedOut,
  role,
  session
}: MobileExperienceProps) {
  const [activeTab, setActiveTab] = useState(() => getInitialTab(role, initialTab));
  const activeTabs = tabsByRole[role];
  const activeTabDefinition = useMemo(
    () => activeTabs.find((tab) => tab.key === activeTab) ?? activeTabs[0],
    [activeTab, activeTabs]
  );

  const switchTab = (tab: TabDefinition) => {
    setActiveTab(tab.key);
    updatePortalPath(role, tab.key);
  };

  const navigateToTab = (tabKey: string) => {
    const tab = activeTabs.find((candidate) => candidate.key === tabKey);
    if (tab) {
      switchTab(tab);
    }
  };

  const renderCurrentPage = () => {
    if (activeTab !== 'home') {
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
      return <ElderHome displayName={session.user.displayName} onNavigate={navigateToTab} />;
    }

    if (role === 'caregiver') {
      return <CaregiverHome onNavigate={navigateToTab} />;
    }

    return <FamilyHome onNavigate={navigateToTab} />;
  };

  return (
    <div className={`mobile-stage role-${role}`}>
      <div className="mobile-app">
        <header className="mobile-header">
          <div className="fixture-banner">
            <LockOutlined aria-hidden="true" />
            <span>服务器会话已确认 · 当前内容均为虚构本地示例</span>
          </div>
          <div className="mobile-topbar">
            <div className="product-lockup">
              <strong>安心照护</strong>
              <span>{roleLabels[role]}</span>
            </div>
            <AccountMenu onSignedOut={onSignedOut} session={session} />
          </div>
        </header>

        <main className="mobile-main">{renderCurrentPage()}</main>

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
