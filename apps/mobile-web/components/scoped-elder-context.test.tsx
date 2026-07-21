import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaregiverElderContext, FamilyElderContext } from './scoped-elder-context';

const pageInfo = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

const residence = {
  stayId: '00000000-0000-4000-8000-000000000101',
  buildingId: '00000000-0000-4000-8000-000000000102',
  buildingName: '青松楼',
  floorId: '00000000-0000-4000-8000-000000000103',
  floorName: '二层',
  zoneId: null,
  zoneName: null,
  roomId: '00000000-0000-4000-8000-000000000104',
  roomName: '208 室',
  bedId: '00000000-0000-4000-8000-000000000105',
  bedLabel: 'A 床',
  admittedAt: '2026-07-01T08:00:00.000+08:00'
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scoped elder context', () => {
  it('renders only server-projected family fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000106',
            displayName: '林安宁',
            preferredName: '林阿姨',
            currentResidence: residence,
            sharedFields: ['PREFERRED_NAME', 'CURRENT_RESIDENCE']
          }
        ],
        pageInfo
      })
    );

    render(<FamilyElderContext />);

    expect(await screen.findByRole('heading', { name: '林阿姨', level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/青松楼 · 二层 · 208 室 · A 床/)).toBeInTheDocument();
    expect(screen.getByText(/未返回护工实时位置、内部备注、原始音频或完整对话/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/family/elders',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('shows current-shift caregiver scope and operational attention', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000106',
            displayName: '林安宁',
            preferredName: null,
            currentResidence: residence,
            careLevel: {
              id: '00000000-0000-4000-8000-000000000107',
              code: 'L2',
              name: '二级照护',
              rank: 2
            },
            accessibilitySummary: null,
            operationalAttention: ['交流时请放慢语速'],
            shiftAssignmentId: '00000000-0000-4000-8000-000000000108'
          }
        ],
        pageInfo
      })
    );

    render(<CaregiverElderContext />);

    expect(await screen.findByRole('heading', { name: '林安宁', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('当前班次授权')).toBeInTheDocument();
    expect(screen.getByText('交流时请放慢语速')).toBeInTheDocument();
  });

  it('does not expose cached data on an error and supports retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [], pageInfo: { ...pageInfo, total: 0, totalPages: 0 } }));

    render(<FamilyElderContext />);

    expect(await screen.findByText('暂时无法读取授权档案')).toBeInTheDocument();
    expect(screen.queryByText('林安宁')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('当前没有可访问的老人档案')).toBeInTheDocument();
  });
});
