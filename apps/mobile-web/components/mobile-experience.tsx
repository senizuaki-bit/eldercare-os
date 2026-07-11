'use client';

import {
  CalendarOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CustomerServiceOutlined,
  DisconnectOutlined,
  DownOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HomeOutlined,
  InboxOutlined,
  LoadingOutlined,
  LockOutlined,
  MedicineBoxOutlined,
  NotificationOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
  UserSwitchOutlined,
  WarningOutlined
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CaregiverHome, ElderHome, FamilyHome, SecondaryShell } from './role-homes';
import { StatusView } from './status-view';
import type { DemoMode, Role } from './types';
import { roleLabels, roles } from './types';

interface TabDefinition {
  icon: ReactNode;
  key: string;
  label: string;
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

const roleDescriptions: Record<Role, string> = {
  caregiver: '任务优先，展示必要房间与班次上下文',
  elder: '大字、语音优先、紧急求助和转人工',
  family: '仅展示隐私过滤后的摘要和进展'
};

const demoModes: readonly {
  icon: ReactNode;
  label: string;
  value: DemoMode;
}[] = [
  { icon: <HomeOutlined aria-hidden="true" />, label: '正常', value: 'normal' },
  { icon: <LoadingOutlined aria-hidden="true" />, label: '加载', value: 'loading' },
  { icon: <InboxOutlined aria-hidden="true" />, label: '空', value: 'empty' },
  { icon: <WarningOutlined aria-hidden="true" />, label: '错误', value: 'error' },
  { icon: <LockOutlined aria-hidden="true" />, label: '无权限', value: 'forbidden' },
  { icon: <DisconnectOutlined aria-hidden="true" />, label: '离线', value: 'offline' },
  { icon: <ClockCircleOutlined aria-hidden="true" />, label: '过期', value: 'stale' }
];

interface MobileExperienceProps {
  initialRole: Role;
  initialTab?: string;
}

function getInitialTab(role: Role, requestedTab: string | undefined) {
  const roleTabs = tabsByRole[role];
  return roleTabs.some((tab) => tab.key === requestedTab) ? (requestedTab ?? 'home') : 'home';
}

function updateDemoPath(role: Role, tab: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.history.replaceState(null, '', `/m/${role}/${tab}`);
}

export function MobileExperience({ initialRole, initialTab }: MobileExperienceProps) {
  const [role, setRole] = useState<Role>(initialRole);
  const [activeTab, setActiveTab] = useState(() => getInitialTab(initialRole, initialTab));
  const [demoMode, setDemoMode] = useState<DemoMode>('normal');
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const firstRoleButtonRef = useRef<HTMLButtonElement>(null);

  const activeTabs = tabsByRole[role];
  const activeTabDefinition = useMemo(
    () => activeTabs.find((tab) => tab.key === activeTab) ?? activeTabs[0],
    [activeTab, activeTabs]
  );

  useEffect(() => {
    if (!isSelectorOpen) {
      return;
    }

    firstRoleButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSelectorOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectorOpen]);

  const switchRole = (nextRole: Role) => {
    setRole(nextRole);
    setActiveTab('home');
    setDemoMode('normal');
    setIsSelectorOpen(false);
    updateDemoPath(nextRole, 'home');
  };

  const switchTab = (tab: TabDefinition) => {
    setActiveTab(tab.key);
    setDemoMode('normal');
    updateDemoPath(role, tab.key);
  };

  const navigateToTab = (tabKey: string) => {
    const tab = activeTabs.find((candidate) => candidate.key === tabKey);
    if (tab) {
      switchTab(tab);
    }
  };

  const renderCurrentPage = () => {
    if (demoMode !== 'normal') {
      return <StatusView mode={demoMode} onRecover={() => setDemoMode('normal')} />;
    }

    if (activeTab !== 'home') {
      return (
        <SecondaryShell
          label={activeTabDefinition?.label ?? '当前'}
          onReturnHome={() => switchTab(activeTabs[0] ?? { icon: null, key: 'home', label: '首页' })}
          role={role}
        />
      );
    }

    if (role === 'elder') {
      return <ElderHome onNavigate={navigateToTab} />;
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
            <ExperimentOutlined aria-hidden="true" />
            <span>本地虚构演示 · 角色切换不代表真实授权</span>
          </div>
          <div className="mobile-topbar">
            <div className="product-lockup">
              <strong>安心照护</strong>
              <span>移动端基础壳</span>
            </div>
            <button
              aria-expanded={isSelectorOpen}
              aria-haspopup="dialog"
              className="role-selector-trigger"
              onClick={() => setIsSelectorOpen(true)}
              type="button"
            >
              <UserSwitchOutlined aria-hidden="true" />
              <span>演示角色：{roleLabels[role]}</span>
              <DownOutlined aria-hidden="true" />
            </button>
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

      {isSelectorOpen ? (
        <div className="selector-layer">
          <button
            aria-label="关闭演示设置"
            className="selector-scrim"
            onClick={() => setIsSelectorOpen(false)}
            type="button"
          />
          <section
            aria-describedby="role-selector-description"
            aria-labelledby="role-selector-title"
            aria-modal="true"
            className="role-selector-sheet"
            role="dialog"
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-heading">
              <div>
                <p className="eyebrow">本地演示设置</p>
                <h2 id="role-selector-title">切换界面角色</h2>
              </div>
              <button
                aria-label="关闭演示设置"
                className="icon-button"
                onClick={() => setIsSelectorOpen(false)}
                type="button"
              >
                <CloseOutlined aria-hidden="true" />
              </button>
            </div>
            <p className="sheet-description" id="role-selector-description">
              仅切换本地 UI，不登录、不提权，也不代表真实授权。
            </p>

            <div className="role-options">
              {roles.map((roleOption, index) => (
                <button
                  aria-label={`切换到${roleLabels[roleOption]}`}
                  aria-pressed={role === roleOption}
                  className={role === roleOption ? 'is-selected' : undefined}
                  key={roleOption}
                  onClick={() => switchRole(roleOption)}
                  ref={index === 0 ? firstRoleButtonRef : undefined}
                  type="button"
                >
                  <span className="role-option-icon" aria-hidden="true">
                    {roleOption === 'elder' ? (
                      <CustomerServiceOutlined />
                    ) : roleOption === 'caregiver' ? (
                      <SettingOutlined />
                    ) : (
                      <TeamOutlined />
                    )}
                  </span>
                  <span>
                    <strong>{roleLabels[roleOption]}</strong>
                    <small>{roleDescriptions[roleOption]}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="demo-state-section">
              <h3>页面状态预览</h3>
              <p>用于检查加载、失败、权限、断网与时效表达。</p>
              <div className="demo-state-grid">
                {demoModes.map((mode) => (
                  <button
                    aria-label={`演示${mode.label}状态`}
                    aria-pressed={demoMode === mode.value}
                    className={demoMode === mode.value ? 'is-selected' : undefined}
                    key={mode.value}
                    onClick={() => {
                      setDemoMode(mode.value);
                      setIsSelectorOpen(false);
                    }}
                    type="button"
                  >
                    {mode.icon}
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
