'use client';

import {
  AlertOutlined,
  AudioOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  FileTextOutlined,
  FrownOutlined,
  LockOutlined,
  MedicineBoxOutlined,
  PhoneOutlined,
  RightOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SmileOutlined,
  TeamOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { useState } from 'react';

import { CaregiverElderContext, FamilyElderContext } from './scoped-elder-context';
import type { Role } from './types';

type VoiceStage = 'idle' | 'listening' | 'draft' | 'confirmed';
type TaskStage = '待接单' | '已接单' | '已到达' | '处理中';
type FamilyFeedback = 'helpful' | 'human' | null;

const nextTaskStage: Record<TaskStage, TaskStage | null> = {
  已到达: '处理中',
  已接单: '已到达',
  待接单: '已接单',
  处理中: null
};

const taskActionLabels: Record<TaskStage, string> = {
  已到达: '模拟开始处理',
  已接单: '模拟到达',
  待接单: '演示接单',
  处理中: '本地演示处理中'
};

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
}: Readonly<{ displayName: string; onNavigate: (tab: string) => void }>) {
  const [voiceStage, setVoiceStage] = useState<VoiceStage>('idle');
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [rating, setRating] = useState<'satisfied' | 'follow-up' | null>(null);

  const voiceLabel =
    voiceStage === 'listening'
      ? '正在聆听，再次点击结束'
      : voiceStage === 'draft'
        ? '演示草稿已生成'
        : voiceStage === 'confirmed'
          ? '演示反馈已确认'
          : '点击说需求';

  const voiceHint =
    voiceStage === 'listening'
      ? '仅模拟收音状态，不会录音或上传'
      : voiceStage === 'idle'
        ? '本地演示不会采集真实语音'
        : '不会创建真实需求或工单';

  const handleVoice = () => {
    if (voiceStage === 'idle' || voiceStage === 'confirmed') {
      setVoiceStage('listening');
      setFeedback('本地演示进入聆听状态；未启用麦克风。');
      return;
    }

    if (voiceStage === 'listening') {
      setVoiceStage('draft');
      setFeedback('已生成固定演示草稿；没有调用 AI 或后端。');
    }
  };

  return (
    <div className="role-page elder-page">
      <section className="role-intro" aria-labelledby="elder-home-title">
        <p className="eyebrow">老人端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="elder-home-title">早上好，{displayName}</h1>
            <p>今天 3 项固定演示安排</p>
          </div>
          <FixtureBadge />
        </div>
      </section>

      <section className="ai-disclosure" aria-label="AI 身份说明">
        <RobotOutlined className="disclosure-icon" aria-hidden="true" />
        <div>
          <strong>AI 关怀助手（演示）</strong>
          <p>AI 只生成建议草稿，不做医疗判断；您可以随时结束或转人工。</p>
        </div>
      </section>

      <button
        aria-pressed={voiceStage === 'listening'}
        className={`voice-action${voiceStage === 'listening' ? ' is-listening' : ''}`}
        onClick={handleVoice}
        type="button"
      >
        <span className="voice-icon-wrap" aria-hidden="true">
          <AudioOutlined />
        </span>
        <span className="voice-action-copy">
          <strong>{voiceLabel}</strong>
          <small>{voiceHint}</small>
        </span>
      </button>

      {voiceStage === 'draft' || voiceStage === 'confirmed' ? (
        <section className="local-draft-card" aria-labelledby="draft-title">
          <div className="card-title-row">
            <div>
              <span className="status-label info-label">AI 演示草稿</span>
              <h2 id="draft-title">“我想喝一杯温水”</h2>
            </div>
            <FixtureBadge />
          </div>
          <p>固定文案，仅展示可复核反馈；不会保存录音、转写或创建工单。</p>
          <div className="button-row">
            <button
              className="secondary-button elder-touch"
              onClick={() => {
                setVoiceStage('idle');
                setFeedback('本地演示草稿已清除。');
              }}
              type="button"
            >
              清除草稿
            </button>
            <button
              className="primary-button elder-touch"
              disabled={voiceStage === 'confirmed'}
              onClick={() => {
                setVoiceStage('confirmed');
                setFeedback('已模拟确认；未提交到真实机构。');
              }}
              type="button"
            >
              {voiceStage === 'confirmed' ? '已模拟确认' : '模拟确认'}
            </button>
          </div>
        </section>
      ) : null}

      <div className="critical-actions" aria-label="紧急和人工操作">
        <button
          className="critical-action emergency-action"
          onClick={() => setShowEmergencyConfirm((current) => !current)}
          type="button"
        >
          <AlertOutlined aria-hidden="true" />
          <span>
            <strong>紧急求助</strong>
            <small>先确认，再模拟发送</small>
          </span>
        </button>
        <button
          className="critical-action human-action"
          onClick={() => setFeedback('已模拟转人工；当前未连接真实工作人员。')}
          type="button"
        >
          <CustomerServiceOutlined aria-hidden="true" />
          <span>
            <strong>联系人工</strong>
            <small>随时退出 AI</small>
          </span>
        </button>
      </div>

      {showEmergencyConfirm ? (
        <section className="emergency-confirm" role="alert" aria-labelledby="emergency-confirm-title">
          <WarningOutlined aria-hidden="true" />
          <div>
            <h2 id="emergency-confirm-title">确认进入紧急演示？</h2>
            <p>这不会联系真实机构或急救服务。</p>
            <div className="button-row">
              <button
                className="secondary-button elder-touch"
                onClick={() => setShowEmergencyConfirm(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-button elder-touch"
                onClick={() => {
                  setShowEmergencyConfirm(false);
                  setFeedback('紧急状态仅在本地完成演示，未发送真实求助。');
                }}
                type="button"
              >
                模拟确认
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="feedback-slot" role="status" aria-live="polite">
        {feedback ? <CheckCircleOutlined aria-hidden="true" /> : null}
        <span>{feedback}</span>
      </div>

      <section className="content-section" aria-labelledby="elder-schedule-title">
        <SectionHeading
          action={{ label: '查看壳页', onClick: () => onNavigate('schedule') }}
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

      <section className="content-section" aria-labelledby="recent-service-title">
        <SectionHeading id="recent-service-title" title="最近服务" />
        <article className="service-card fixture-card">
          <div className="card-title-row">
            <div>
              <span className="status-label success-label">演示已完成</span>
              <h3>房间送水服务</h3>
            </div>
            <FixtureBadge />
          </div>
          <p>今天 08:20 · 固定界面数据</p>
          <fieldset className="feedback-fieldset">
            <legend>这个演示服务记录清楚吗？</legend>
            <div className="button-row">
              <button
                aria-pressed={rating === 'satisfied'}
                className="feedback-button elder-touch"
                onClick={() => {
                  setRating('satisfied');
                  setFeedback('已记录本地演示反馈“清楚”，不会影响真实评价。');
                }}
                type="button"
              >
                <SmileOutlined aria-hidden="true" />
                清楚
              </button>
              <button
                aria-pressed={rating === 'follow-up'}
                className="feedback-button elder-touch"
                onClick={() => {
                  setRating('follow-up');
                  setFeedback('已记录本地演示反馈“想问问”，不会联系真实人员。');
                }}
                type="button"
              >
                <FrownOutlined aria-hidden="true" />
                想问问
              </button>
            </div>
          </fieldset>
        </article>
      </section>
    </div>
  );
}

export function CaregiverHome({ onNavigate }: Readonly<{ onNavigate: (tab: string) => void }>) {
  const [taskStage, setTaskStage] = useState<TaskStage>('待接单');
  const [feedback, setFeedback] = useState('');
  const nextStage = nextTaskStage[taskStage];

  return (
    <div className="role-page caregiver-page">
      <section className="role-intro" aria-labelledby="caregiver-home-title">
        <p className="eyebrow">护工端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="caregiver-home-title">早班任务</h1>
            <p>当前有效班次 · 服务端权限校验</p>
          </div>
        </div>
      </section>

      <CaregiverElderContext />

      <section className="urgent-task-card" aria-labelledby="urgent-task-title">
        <div className="card-title-row">
          <span className="status-label warning-label">
            <WarningOutlined aria-hidden="true" />
            优先任务
          </span>
          <FixtureBadge />
        </div>
        <h2 id="urgent-task-title">请确认演示用户的头晕反馈</h2>
        <p className="task-location">2 号楼 · 3 层 · 312 室（固定房间信息）</p>
        <div className="task-meta-grid">
          <div>
            <span>本地状态</span>
            <strong>{taskStage}</strong>
          </div>
          <div>
            <span>演示时限</span>
            <strong>剩余 12 分钟</strong>
          </div>
        </div>
        <p className="safety-note">
          <SafetyCertificateOutlined aria-hidden="true" />
          房间来自固定 fixture，不代表实时定位。仅展示完成任务所需信息。
        </p>
        <button
          className="primary-button full-width-button"
          disabled={nextStage === null}
          onClick={() => {
            if (nextStage !== null) {
              setTaskStage(nextStage);
              setFeedback(`已切换为“${nextStage}”；仅改变本地演示状态。`);
            }
          }}
          type="button"
        >
          {taskActionLabels[taskStage]}
        </button>
      </section>

      <div className="feedback-slot" role="status" aria-live="polite">
        {feedback ? <CheckCircleOutlined aria-hidden="true" /> : null}
        <span>{feedback}</span>
      </div>

      <section className="content-section" aria-labelledby="caregiver-tasks-title">
        <SectionHeading
          action={{ label: '全部壳页', onClick: () => onNavigate('tasks') }}
          id="caregiver-tasks-title"
          title="我的待办"
        />
        <div className="task-list">
          <article className="compact-task fixture-card">
            <div className="compact-task-icon" aria-hidden="true">
              <ClockCircleOutlined />
            </div>
            <div>
              <div className="card-title-row compact">
                <strong>10:30 房间巡访</strong>
                <FixtureBadge />
              </div>
              <p>2 号楼 3 层 · 普通优先级</p>
            </div>
          </article>
          <article className="compact-task fixture-card">
            <div className="compact-task-icon" aria-hidden="true">
              <TeamOutlined />
            </div>
            <div>
              <div className="card-title-row compact">
                <strong>14:40 活动陪同提醒</strong>
                <FixtureBadge />
              </div>
              <p>兴趣小组 · M00 导航示例</p>
            </div>
          </article>
        </div>
      </section>

      <section className="handover-card fixture-card" aria-labelledby="handover-title">
        <FileTextOutlined aria-hidden="true" />
        <div>
          <div className="card-title-row compact">
            <h2 id="handover-title">交班提醒</h2>
            <FixtureBadge />
          </div>
          <p>15:15 前检查 2 条本地演示记录，未来由业务里程碑接入。</p>
        </div>
      </section>
    </div>
  );
}

export function FamilyHome({ onNavigate }: Readonly<{ onNavigate: (tab: string) => void }>) {
  const [feedback, setFeedback] = useState<FamilyFeedback>(null);

  return (
    <div className="role-page family-page">
      <section className="role-intro" aria-labelledby="family-home-title">
        <p className="eyebrow">家属端首页</p>
        <div className="intro-title-row">
          <div>
            <h1 id="family-home-title">今日照护摘要</h1>
            <p>关联对象：按已验证关系与共享同意加载</p>
          </div>
        </div>
      </section>

      <FamilyElderContext />

      <section className="privacy-notice" aria-label="家属隐私说明">
        <LockOutlined aria-hidden="true" />
        <div>
          <strong>按授权显示安全摘要</strong>
          <p>已隐藏原始录音、完整对话、内部备注和护工实时位置。</p>
        </div>
      </section>

      <section className="summary-card fixture-card" aria-labelledby="family-summary-title">
        <div className="card-title-row">
          <span className="status-label success-label">
            <CheckCircleOutlined aria-hidden="true" />
            状态平稳（固定示例）
          </span>
          <FixtureBadge />
        </div>
        <h2 id="family-summary-title">上午照护安排已按演示计划进行</h2>
        <p>08:20 完成一条生活服务演示记录；没有需要家属处理的真实事项。</p>
        <p className="summary-source">摘要来源：虚构 fixture · 非实时数据</p>
      </section>

      <section className="content-section" aria-labelledby="family-events-title">
        <SectionHeading
          action={{ label: '动态壳页', onClick: () => onNavigate('events') }}
          id="family-events-title"
          title="需要留意"
        />
        <article className="family-event-card fixture-card">
          <span className="family-event-icon" aria-hidden="true">
            <PhoneOutlined />
          </span>
          <div>
            <div className="card-title-row compact">
              <strong>今晚可进行演示通话</strong>
              <FixtureBadge />
            </div>
            <p>建议时间 19:00–19:30 · 不会发起真实通话</p>
          </div>
        </article>
      </section>

      <section className="content-section" aria-labelledby="service-progress-title">
        <SectionHeading
          action={{ label: '服务壳页', onClick: () => onNavigate('services') }}
          id="service-progress-title"
          title="服务进度"
        />
        <article className="progress-card fixture-card">
          <div className="card-title-row">
            <div>
              <span className="status-label info-label">演示进行中</span>
              <h3>衣物整理服务</h3>
            </div>
            <FixtureBadge />
          </div>
          <ol className="progress-steps" aria-label="固定演示服务进度">
            <li className="is-complete">已确认</li>
            <li className="is-current" aria-current="step">
              演示处理中
            </li>
            <li>待完成</li>
          </ol>
          <p>预计演示完成：今天 16:00 · 非真实承诺</p>
        </article>
      </section>

      <section className="trend-card fixture-card" aria-labelledby="trend-title">
        <div className="card-title-row">
          <h2 id="trend-title">最近趋势</h2>
          <FixtureBadge />
        </div>
        <div className="trend-summary">
          <span>近 7 天固定示例</span>
          <strong>日常安排完成 6 / 7</strong>
        </div>
        <p>仅展示生活服务趋势，不作医疗或情绪诊断。</p>
      </section>

      <section className="communication-card fixture-card" aria-labelledby="communication-title">
        <div className="communication-icon" aria-hidden="true">
          <RobotOutlined />
        </div>
        <div>
          <div className="card-title-row compact">
            <span className="status-label ai-label">AI 沟通草稿</span>
            <FixtureBadge />
          </div>
          <h2 id="communication-title">“今晚想听听您今天最开心的事。”</h2>
          <p>可编辑的固定示例，不会代您发送，也不会冒充家属。</p>
        </div>
        <div className="button-row">
          <button
            aria-pressed={feedback === 'helpful'}
            className="secondary-button"
            onClick={() => setFeedback('helpful')}
            type="button"
          >
            有帮助
          </button>
          <button
            aria-pressed={feedback === 'human'}
            className="primary-button"
            onClick={() => setFeedback('human')}
            type="button"
          >
            需要人工建议
          </button>
        </div>
        <div className="feedback-slot compact-feedback" role="status" aria-live="polite">
          {feedback === 'helpful'
            ? '已保存本地演示反馈，不会发送草稿。'
            : feedback === 'human'
              ? '已模拟请求人工建议，当前未连接真实工作人员。'
              : ''}
        </div>
      </section>
    </div>
  );
}

interface SecondaryShellProps {
  label: string;
  onReturnHome: () => void;
  role: Role;
}

const secondaryDescriptions: Record<Role, string> = {
  caregiver: '此区域预留给任务、交班和个人设置；当前不会执行真实工单转换。',
  elder: '此区域预留给安排、家属和个人设置；当前不会执行真实照护业务。',
  family: '此区域预留给动态、服务和个人设置；当前不会读取真实老人数据。'
};

export function SecondaryShell({ label, onReturnHome, role }: SecondaryShellProps) {
  return (
    <div className="role-page secondary-page">
      <section className="role-intro" aria-labelledby="secondary-title">
        <p className="eyebrow">{role === 'elder' ? '大字版导航' : '移动导航'}</p>
        <div className="intro-title-row">
          <h1 id="secondary-title">{label}导航壳</h1>
          <FixtureBadge />
        </div>
      </section>
      <section className="placeholder-card">
        <FileTextOutlined aria-hidden="true" />
        <h2>功能将在后续里程碑接入</h2>
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
