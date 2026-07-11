import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MobileExperience } from './mobile-experience';

describe('MobileExperience', () => {
  it('renders the elder AI disclosure, large primary actions, and local-demo warning', () => {
    render(<MobileExperience initialRole="elder" />);

    expect(screen.getByText('本地虚构演示 · 角色切换不代表真实授权')).toBeInTheDocument();
    expect(screen.getByText('AI 关怀助手（演示）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /点击说需求/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /紧急求助/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /联系人工/ })).toBeInTheDocument();
  });

  it('simulates the voice interaction without claiming a real submission', async () => {
    const user = userEvent.setup();
    render(<MobileExperience initialRole="elder" />);

    const voiceButton = screen.getByRole('button', { name: /点击说需求/ });
    await user.click(voiceButton);

    expect(screen.getByRole('button', { name: /正在聆听/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('本地演示进入聆听状态；未启用麦克风。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /正在聆听/ }));

    expect(screen.getByText('“我想喝一杯温水”')).toBeInTheDocument();
    expect(screen.getByText(/不会保存录音、转写或创建工单/)).toBeInTheDocument();
  });

  it('switches to the family shell and keeps caregiver location private', async () => {
    const user = userEvent.setup();
    render(<MobileExperience initialRole="elder" />);

    await user.click(screen.getByRole('button', { name: /演示角色：老人端/ }));
    await user.click(screen.getByRole('button', { name: '切换到家属端' }));

    expect(screen.getByRole('heading', { name: '今日照护摘要' })).toBeInTheDocument();
    expect(screen.getByText('已隐藏原始录音、完整对话、内部备注和护工实时位置。')).toBeInTheDocument();
    expect(screen.queryByText(/护工当前位置/)).not.toBeInTheDocument();
    expect(screen.queryByText(/312 室/)).not.toBeInTheDocument();
  });

  it('makes bottom navigation interactive without implementing future workflows', async () => {
    const user = userEvent.setup();
    render(<MobileExperience initialRole="family" />);

    await user.click(screen.getByRole('button', { name: '服务' }));

    expect(screen.getByRole('heading', { name: '服务导航壳' })).toBeInTheDocument();
    expect(screen.getByText(/M00 不读取真实老人数据/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toHaveAttribute('aria-current', 'page');
  });

  it('previews explicit offline, stale, and forbidden states from the demo selector', async () => {
    const user = userEvent.setup();
    render(<MobileExperience initialRole="caregiver" />);

    await user.click(screen.getByRole('button', { name: /演示角色：护工端/ }));
    await user.click(screen.getByRole('button', { name: '演示离线状态' }));

    expect(screen.getByRole('heading', { name: '网络已断开' })).toBeInTheDocument();
    expect(screen.getByText(/不会标记为真实完成/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回正常演示' }));
    await user.click(screen.getByRole('button', { name: /演示角色：护工端/ }));
    await user.click(screen.getByRole('button', { name: '演示过期状态' }));

    expect(screen.getByRole('heading', { name: '信息已过期' })).toBeInTheDocument();
    expect(screen.getByText(/不能当作当前状态/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回正常演示' }));
    await user.click(screen.getByRole('button', { name: /演示角色：护工端/ }));
    await user.click(screen.getByRole('button', { name: '演示无权限状态' }));

    expect(screen.getByRole('heading', { name: '您无权查看此内容' })).toBeInTheDocument();
    expect(screen.getByText(/不会绕过授权/)).toBeInTheDocument();
  });
});
