import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AppProviders } from '../app/providers';
import {
  authSessionFixture,
  organizationId,
  qinglanFacilityId
} from '../test/fixtures';
import { AdminShell } from './admin-shell';
import { ElderDirectoryPage } from './elder-directory-page';
import { RoomDirectoryPage } from './room-directory-page';
import { ShiftWeekPage } from './shift-week-page';
import { StaffDirectoryPage } from './staff-directory-page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/elders'
}));

const ids = {
  elder: '00000000-0000-4000-8000-000000000601',
  stay: '00000000-0000-4000-8000-000000000602',
  building: '00000000-0000-4000-8000-000000000603',
  floor: '00000000-0000-4000-8000-000000000604',
  room: '00000000-0000-4000-8000-000000000605',
  bed: '00000000-0000-4000-8000-000000000606',
  availableBed: '00000000-0000-4000-8000-000000000614',
  careLevel: '00000000-0000-4000-8000-000000000607',
  user: '00000000-0000-4000-8000-000000000608',
  staff: '00000000-0000-4000-8000-000000000609',
  team: '00000000-0000-4000-8000-000000000610',
  shift: '00000000-0000-4000-8000-000000000611',
  assignment: '00000000-0000-4000-8000-000000000612',
  scope: '00000000-0000-4000-8000-000000000613'
} as const;

const timestamps = {
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-13T02:00:00.000Z'
} as const;

const pageInfo = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

const elder = {
  id: ids.elder,
  organizationId,
  facilityId: qinglanFacilityId,
  recordNumber: 'ELDER-00601',
  displayName: '周奶奶（虚构）',
  preferredName: '周奶奶',
  status: 'ACTIVE',
  careLevel: { id: ids.careLevel, code: 'CARE-2', name: '二级照护', rank: 2 },
  currentResidence: {
    stayId: ids.stay,
    buildingId: ids.building,
    buildingName: '颐和楼（虚构）',
    floorId: ids.floor,
    floorName: '二层',
    zoneId: null,
    zoneName: null,
    roomId: ids.room,
    roomName: '向阳 201',
    bedId: ids.bed,
    bedLabel: 'A 床',
    admittedAt: '2026-07-01T01:00:00.000Z'
  },
  version: 1,
  updatedAt: timestamps.updatedAt
} as const;

const room = {
  id: ids.room,
  organizationId,
  facilityId: qinglanFacilityId,
  floorId: ids.floor,
  zoneId: null,
  code: 'ROOM-201',
  name: '向阳 201',
  status: 'ACTIVE',
  bedCount: 2,
  activeBedCount: 2,
  occupiedBedCount: 1,
  availableBedCount: 1,
  version: 1,
  ...timestamps
} as const;

const beds = [
  {
    id: ids.bed,
    organizationId,
    facilityId: qinglanFacilityId,
    roomId: ids.room,
    code: 'BED-201-A',
    label: 'A 床',
    operationalStatus: 'ACTIVE',
    occupancy: {
      elderId: ids.elder,
      elderDisplayName: '周奶奶（虚构）',
      stayId: ids.stay,
      admittedAt: '2026-07-01T01:00:00.000Z'
    },
    version: 1,
    ...timestamps
  },
  {
    id: ids.availableBed,
    organizationId,
    facilityId: qinglanFacilityId,
    roomId: ids.room,
    code: 'BED-201-B',
    label: 'B 床',
    operationalStatus: 'ACTIVE',
    occupancy: null,
    version: 1,
    ...timestamps
  }
] as const;

const staff = {
  id: ids.staff,
  organizationId,
  facilityId: qinglanFacilityId,
  userId: ids.user,
  employeeCode: 'STAFF-0609',
  displayName: '陈护工（虚构）',
  jobTitle: '照护专员',
  status: 'ACTIVE',
  hiredAt: '2026-06-01',
  endedAt: null,
  primaryTeamId: ids.team,
  version: 1,
  ...timestamps
} as const;

function response(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new TypeError('unexpected fetch input');
}

function renderPage(page: ReactNode) {
  return render(
    <AppProviders>
      <AdminShell session={authSessionFixture}>{page}</AdminShell>
    </AppProviders>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('M02 admin directory pages', () => {
  it('loads the elder directory and keeps quick detail limited to a permission-gated summary', async () => {
    window.history.replaceState({}, '', '/elders?status=ACTIVE');
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith(`/elders/${ids.elder}`)) {
        return Promise.resolve(response({ ...elder, portalUserId: null, createdAt: timestamps.createdAt }));
      }
      return Promise.resolve(response({ items: [elder], pageInfo }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<ElderDirectoryPage />);

    expect(await screen.findByText('周奶奶')).toBeInTheDocument();
    expect(screen.getByText(/向阳 201.*A 床/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /快速详情/ }));

    expect(await screen.findByRole('heading', { name: '受限资料' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /检查访问资格/ })).toBeDisabled();
    expect(screen.queryByText(/身份证|联系电话|出生日期/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).endsWith(`/elders/${ids.elder}`))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).includes('status=ACTIVE'))).toBe(true);
  });

  it('keeps room results visible when optional building and floor catalogs are unavailable', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/directory/buildings') || url.includes('/directory/floors')) {
        return Promise.resolve(response(null, 404));
      }
      if (url.includes('/directory/beds')) {
        return Promise.resolve(response({ items: beds, pageInfo: { ...pageInfo, pageSize: 100, total: 2 } }));
      }
      return Promise.resolve(response({ items: [room], pageInfo: { ...pageInfo, pageSize: 12 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<RoomDirectoryPage />);

    const card = await screen.findByRole('article', { name: /向阳 201/ });
    expect(within(card).getByText('1 个可用床位')).toBeInTheDocument();
    expect(within(card).getByText('1 个已占用床位')).toBeInTheDocument();
    expect(within(card).getByText('A 床')).toBeInTheDocument();
    expect(within(card).getByText('B 床')).toBeInTheDocument();
    expect(within(card).getByText('可用')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '当前房间结果容量汇总' })).toHaveTextContent('物理床位2');
    expect(screen.getByText(/结果仍可查看/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '筛选楼栋' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '筛选楼层' })).toBeDisabled();
    expect(screen.queryByText('周奶奶（虚构）')).not.toBeInTheDocument();
  });

  it('keeps room capacity visible and warns when bed-level detail cannot be loaded', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes('/directory/buildings') || url.includes('/directory/floors')) {
        return Promise.resolve(response(null, 404));
      }
      if (url.includes('/directory/beds')) {
        return Promise.resolve(response(null, 503));
      }
      return Promise.resolve(response({ items: [room], pageInfo: { ...pageInfo, pageSize: 12 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<RoomDirectoryPage />);

    const card = await screen.findByRole('article', { name: /向阳 201/ });
    expect(within(card).getByText('1 个可用床位')).toBeInTheDocument();
    expect(within(card).getByText(/床位明细暂不可用/)).toBeInTheDocument();
    expect(screen.getByText(/房间聚合容量仍可查看/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试床位明细' })).toBeEnabled();
  });

  it('loads scoped staff without exposing private contact fields and sends search server-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [staff], pageInfo }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<StaffDirectoryPage />);

    expect(await screen.findByText('陈护工（虚构）')).toBeInTheDocument();
    expect(screen.getByText('STAFF-0609')).toBeInTheDocument();
    expect(screen.queryByText(/手机号|联系电话|家庭住址/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索当前页面' }), {
      target: { value: '陈护工' }
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => requestUrl(url).includes('search=%E9%99%88%E6%8A%A4%E5%B7%A5'))).toBe(true);
    });
  });

  it('offers accessible week and equivalent list views for the same shift response', async () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setHours(8, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const shiftEnd = new Date(monday);
    shiftEnd.setHours(16, 0, 0, 0);
    const shift = {
      id: ids.shift,
      organizationId,
      facilityId: qinglanFacilityId,
      teamId: ids.team,
      code: 'SHIFT-DAY',
      name: '白班（虚构）',
      startsAt: monday.toISOString(),
      endsAt: shiftEnd.toISOString(),
      status: 'SCHEDULED',
      assignments: [
        {
          id: ids.assignment,
          organizationId,
          facilityId: qinglanFacilityId,
          shiftId: ids.shift,
          staffProfileId: ids.staff,
          staffDisplayName: '陈护工（虚构）',
          status: 'ASSIGNED',
          scopes: [
            {
              id: ids.scope,
              shiftAssignmentId: ids.assignment,
              kind: 'FACILITY'
            }
          ],
          elderAssignments: [],
          version: 1,
          assignedAt: monday.toISOString()
        }
      ],
      version: 1,
      ...timestamps
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(
      response({ items: [shift], pageInfo: { ...pageInfo, pageSize: 100 } })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage(<ShiftWeekPage />);

    expect(await screen.findByRole('table', { name: /周排班/ })).toBeInTheDocument();
    expect(screen.getByText('白班（虚构）')).toBeInTheDocument();
    expect(screen.getByText('陈护工（虚构）')).toBeInTheDocument();
    fireEvent.click(screen.getByText('列表视图'));

    expect(await screen.findByRole('columnheader', { name: '日期与时间' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '服务范围' })).toBeInTheDocument();
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const firstUrl = requestUrl(firstCall![0]);
    expect(firstUrl).toContain('/shifts?');
    expect(firstUrl).toContain('from=');
    expect(firstUrl).toContain('to=');
  });
});
