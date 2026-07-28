'use client';

import {
  AlertOutlined,
  AudioOutlined,
  CalendarOutlined,
  CustomerServiceOutlined,
  FileTextOutlined,
  LockOutlined,
  MedicineBoxOutlined,
  RightOutlined,
  RobotOutlined
} from '@ant-design/icons';

import {
  CaregiverTasksPanel,
  ElderServicesPanel,
  FamilySummariesPanel
} from './m03-workflows';
import { CaregiverElderContext, FamilyElderContext } from './scoped-elder-context';
import type { Role } from './types';

type Navigate = (section: string, detailId?: string) => void;

export function FixtureBadge() {
  return <span className="fixture-badge">虚构示例</span>;
}

function SectionHeading({
  title,
  action,
  id
}: Readonly<{ title: string; action?: { label: string; onClick: () => void }; id: string }>) {
  return (
    <div className="section-heading">
      <h2 id={id}>{title}</h2>
      {action ? (
        <button className="text-action" onClick={action.onClick} type="button">
          {action.label}
          <RightOutlined aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function ElderHome({
  displayName,
  onNavigate
}: Readonly<{ displayName: string; onNavigate: Navigate }>) {
  return (
    <div className="role-page elder-page">
      <section className="role-intro" aria-labelledby="elder-home-title">
        <p className="eyebrow">老人端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="elder-home-title">早上好，{displayName}</h1>
            <p>有需要可以直接说，工作人员会按流程处理。</p>
          </div>
        </div>
      </section>

      <section className="ai-disclosure" aria-label="AI 身份说明">
        <RobotOutlined className="disclosure-icon" aria-hidden="true" />
        <div>
          <strong>AI 关怀助手</strong>
          <p>AI 只整理建议草稿，不做医疗判断；您可以随时结束或转人工。</p>
        </div>
      </section>

      <button
        className="voice-action"
        onClick={() => onNavigate('voice-request')}
        type="button"
      >
        <span className="voice-icon-wrap" aria-hidden="true">
          <AudioOutlined />
        </span>
        <span className="voice-action-copy">
          <strong>点击说需求</strong>
          <small>进入安全语音请求流程</small>
        </span>
      </button>

      <div className="critical-actions" aria-label="紧急和人工操作">
        <button className="critical-action emergency-action" disabled type="button">
          <AlertOutlined aria-hidden="true" />
          <span>
            <strong>紧急求助</strong>
            <small>M04 接入前不会假装发送</small>
          </span>
        </button>
        <button
          className="critical-action human-action"
          onClick={() => onNavigate('voice-request')}
          type="button"
        >
          <CustomerServiceOutlined aria-hidden="true" />
          <span>
            <strong>联系人工</strong>
            <small>进入后可直接请求工作人员</small>
          </span>
        </button>
      </div>

      <section className="content-section" aria-labelledby="elder-schedule-title">
        <SectionHeading
          action={{ label: '查看安排', onClick: () => onNavigate('schedule') }}
          id="elder-schedule-title"
          title="今日安排"
        />
        <div className="schedule-list">
          <article className="schedule-item fixture-card">
            <span className="schedule-icon info-icon" aria-hidden="true">
              <MedicineBoxOutlined />
            </span>
            <div>
              <div className="card-title-row compact">
                <strong>09:00 日常用药提醒</strong>
                <FixtureBadge />
              </div>
              <p>仅提醒既定计划，不提供用药建议</p>
            </div>
          </article>
          <article className="schedule-item fixture-card">
            <span className="schedule-icon success-icon" aria-hidden="true">
              <CalendarOutlined />
            </span>
            <div>
              <div className="card-title-row compact">
                <strong>15:00 手工兴趣小组</strong>
                <FixtureBadge />
              </div>
              <p>一层多功能室 · 固定示例</p>
            </div>
          </article>
        </div>
      </section>

      <ElderServicesPanel />
    </div>
  );
}

export function CaregiverHome({ onNavigate }: Readonly<{ onNavigate: Navigate }>) {
  return (
    <div className="role-page caregiver-page">
      <section className="role-intro" aria-labelledby="caregiver-home-title">
        <p className="eyebrow">护工端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="caregiver-home-title">早班任务</h1>
            <p>只显示当前有效班次和分配范围内的服务任务。</p>
          </div>
        </div>
      </section>

      <CaregiverTasksPanel
        compact
        onOpenAll={() => onNavigate('tasks')}
        onSelect={(workOrderId) => onNavigate('tasks', workOrderId)}
      />

      <CaregiverElderContext />
    </div>
  );
}

export function FamilyHome() {
  return (
    <div className="role-page family-page">
      <section className="role-intro" aria-labelledby="family-home-title">
        <p className="eyebrow">家属端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="family-home-title">今日照护摘要</h1>
            <p>关联对象按已验证关系、同意和发布状态加载。</p>
          </div>
        </div>
      </section>

      <FamilyElderContext />

      <section className="privacy-notice" aria-label="家属隐私说明">
        <LockOutlined aria-hidden="true" />
        <div>
          <strong>只显示已发布的安全摘要</strong>
          <p>原始音频、完整转写、内部备注和护工实时位置不会出现在这里。</p>
        </div>
      </section>

      <FamilySummariesPanel />
    </div>
  );
}

interface SecondaryShellProps {
  label: string;
  onReturnHome: () => void;
  role: Role;
}

const secondaryDescriptions: Record<Role, string> = {
  caregiver: '此区域保留给交班和个人设置；未接入的操作不会显示为成功。',
  elder: '此区域保留给安排、家属和个人设置；未接入的操作不会显示为成功。',
  family: '此区域保留给服务和个人设置；不会读取未经授权的老人数据。'
};

export function SecondaryShell({ label, onReturnHome, role }: SecondaryShellProps) {
  return (
    <div className="role-page secondary-page">
      <section className="role-intro" aria-labelledby="secondary-title">
        <p className="eyebrow">{role === 'elder' ? '大字版导航' : '移动导航'}</p>
        <div className="intro-title-row">
          <h1 id="secondary-title">{label}</h1>
        </div>
      </section>
      <section className="placeholder-card">
        <FileTextOutlined aria-hidden="true" />
        <h2>此功能尚未接入</h2>
        <p>{secondaryDescriptions[role]}</p>
        <button
          className={`primary-button full-width-button${role === 'elder' ? ' elder-touch' : ''}`}
          onClick={onReturnHome}
          type="button"
        >
          返回首页
        </button>
      </section>
    </div>
  );
}
