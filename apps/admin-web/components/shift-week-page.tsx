'use client';

import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  TeamOutlined
} from '@ant-design/icons';
import {
  Button,
  Card,
  Empty,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  parseShiftsPage,
  type ScopedPage,
  type Shift
} from '../lib/m02-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  DirectoryFailureCard,
  DirectoryPageHeader,
  DirectoryStaleAlert,
  FacilityRequiredCard
} from './m02-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type ShiftStatusFilter = 'all' | Shift['status'];
type ScheduleView = 'week' | 'list';

function startOfWeek(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function localDateKey(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function shiftStatusTag(status: Shift['status']) {
  if (status === 'IN_PROGRESS') return <Tag icon={<ClockCircleOutlined />} color="blue">进行中</Tag>;
  if (status === 'COMPLETED') return <Tag icon={<CheckCircleOutlined />} color="success">已完成</Tag>;
  if (status === 'CANCELLED') return <Tag>已取消</Tag>;
  return <Tag color="warning">待开始</Tag>;
}

function assignmentSummary(shift: Shift): string {
  const names = shift.assignments.map((assignment) => assignment.staffDisplayName);
  if (names.length === 0) return '尚未分配员工';
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 人`;
}

function scopeSummary(shift: Shift): string {
  const scopes = shift.assignments.flatMap((assignment) => assignment.scopes);
  if (scopes.length === 0) return '未设置服务范围';
  const kinds = new Set(scopes.map((scope) => scope.kind));
  const labels = [
    kinds.has('FACILITY') ? '院区' : null,
    kinds.has('FLOOR') ? '楼层' : null,
    kinds.has('ZONE') ? '区域' : null
  ].filter(Boolean);
  return `${labels.join('、')}范围 · ${scopes.length} 项`;
}

function ShiftCard({ shift }: Readonly<{ shift: Shift }>) {
  return (
    <article className="shift-card" aria-label={`${shift.name}，${formatTime(shift.startsAt)}至${formatTime(shift.endsAt)}`}>
      <div className="shift-card-title">
        <strong>{shift.name}</strong>
        {shiftStatusTag(shift.status)}
      </div>
      <p><ClockCircleOutlined aria-hidden="true" />{formatTime(shift.startsAt)}–{formatTime(shift.endsAt)}</p>
      <p><TeamOutlined aria-hidden="true" />{assignmentSummary(shift)}</p>
      <small>{scopeSummary(shift)}</small>
    </article>
  );
}

export function ShiftWeekPage() {
  const { session } = useAdminShellSearch();
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [statusFilter, setStatusFilter] = useState<ShiftStatusFilter>('all');
  const [view, setView] = useState<ScheduleView>('week');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initialStatus = query.get('status');
    const initialView = query.get('view');
    if (
      initialStatus === 'SCHEDULED' ||
      initialStatus === 'IN_PROGRESS' ||
      initialStatus === 'COMPLETED' ||
      initialStatus === 'CANCELLED'
    ) {
      setStatusFilter(initialStatus);
    }
    if (initialView === 'week' || initialView === 'list') {
      setView(initialView);
    }
  }, []);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: '1',
      pageSize: '100',
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      sort: 'startsAt',
      direction: 'asc'
    });
    if (statusFilter !== 'all') next.set('status', statusFilter);
    return next;
  }, [statusFilter, weekEnd, weekStart]);

  const url = facilityId === null
    ? ''
    : `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/shifts?${params.toString()}`;
  const parsePage = useCallback(
    (value: unknown): ScopedPage<Shift> => parseShiftsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const schedule = useScopedDirectory({ enabled: facilityId !== null, parse: parsePage, url });
  const shiftsByDate = useMemo(() => {
    const result = new Map<string, Shift[]>();
    for (const shift of schedule.data?.items ?? []) {
      const key = localDateKey(new Date(shift.startsAt));
      result.set(key, [...(result.get(key) ?? []), shift]);
    }
    return result;
  }, [schedule.data]);

  const listColumns: TableColumnsType<Shift> = [
    {
      title: '日期与时间',
      key: 'time',
      width: 210,
      render: (_, shift) => (
        <span>
          <time dateTime={shift.startsAt}>{formatDateTime(shift.startsAt)}</time>
          {' — '}
          <time dateTime={shift.endsAt}>{formatTime(shift.endsAt)}</time>
        </span>
      )
    },
    {
      title: '班次',
      key: 'identity',
      width: 220,
      render: (_, shift) => <span><strong>{shift.name}</strong><br /><span className="m02-muted">{shift.code}</span></span>
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      render: (_, shift) => shiftStatusTag(shift.status)
    },
    {
      title: '当班员工',
      key: 'staff',
      width: 280,
      render: (_, shift) => assignmentSummary(shift)
    },
    {
      title: '服务范围',
      key: 'scope',
      width: 220,
      render: (_, shift) => scopeSummary(shift)
    }
  ];

  const weekRangeLabel = `${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(weekStart)} — ${formatDate(addDays(weekEnd, -1))}`;

  return (
    <div className="m02-page shift-week-page">
      <DirectoryPageHeader
        section="护理、人员与排班"
        title="周排班"
        description="按周查看真实班次、人员和服务范围；网格与列表表达同一组后端数据。"
        actions={
          <Tooltip title="当前页面只接入读取接口">
            <Button disabled icon={<PlusOutlined />}>新建班次</Button>
          </Tooltip>
        }
      />

      {facilityId === null ? <FacilityRequiredCard /> : schedule.failure !== null && schedule.data === null ? (
        <DirectoryFailureCard failure={schedule.failure} onRetry={schedule.retry} resourceName="排班目录" />
      ) : (
        <Card className="m02-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m02-toolbar shift-toolbar">
            <div>
              <h2><CalendarOutlined aria-hidden="true" />{weekRangeLabel}</h2>
              <p>班次权限范围只在有效时间内生效；颜色同时配有状态文字和图标。</p>
            </div>
            <Space size={10} wrap>
              <Button aria-label="上一周" icon={<LeftOutlined />} onClick={() => setWeekStart((current) => addDays(current, -7))} />
              <Button onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</Button>
              <Button aria-label="下一周" icon={<RightOutlined />} onClick={() => setWeekStart((current) => addDays(current, 7))} />
              <Select<ShiftStatusFilter>
                aria-label="筛选班次状态"
                value={statusFilter}
                options={[
                  { value: 'all', label: '全部班次状态' },
                  { value: 'SCHEDULED', label: '待开始' },
                  { value: 'IN_PROGRESS', label: '进行中' },
                  { value: 'COMPLETED', label: '已完成' },
                  { value: 'CANCELLED', label: '已取消' }
                ]}
                onChange={setStatusFilter}
              />
              <Segmented<ScheduleView>
                aria-label="切换排班呈现方式"
                value={view}
                options={[
                  { value: 'week', label: '周视图' },
                  { value: 'list', label: '列表视图' }
                ]}
                onChange={setView}
              />
            </Space>
          </div>

          {schedule.stale ? <DirectoryStaleAlert onRetry={schedule.retry} /> : null}
          {view === 'week' ? (
            <div className="shift-week-scroll" tabIndex={0} aria-label="可横向滚动的周排班表">
              <table className="shift-week-grid">
                <caption className="sr-only">{weekRangeLabel}周排班；可切换到列表视图读取相同内容</caption>
                <thead>
                  <tr>
                    <th scope="col">班次</th>
                    {days.map((day) => (
                      <th key={localDateKey(day)} scope="col">
                        <span>{new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(day)}</span>
                        <strong>{formatDate(day)}</strong>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">全天</th>
                    {days.map((day) => {
                      const dayShifts = shiftsByDate.get(localDateKey(day)) ?? [];
                      return (
                        <td key={localDateKey(day)}>
                          {dayShifts.length === 0 ? (
                            <span className="shift-empty-cell">暂无排班</span>
                          ) : dayShifts.map((shift) => <ShiftCard key={shift.id} shift={shift} />)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <Table<Shift>
              className="m02-table"
              columns={listColumns}
              dataSource={schedule.data?.items ?? []}
              loading={{ spinning: schedule.loading, description: '正在读取周排班' }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周没有符合筛选条件的班次" /> }}
              pagination={false}
              rowKey="id"
              scroll={{ x: 1060 }}
            />
          )}
          {view === 'week' && schedule.loading && schedule.data === null ? (
            <div className="shift-loading-note" role="status" aria-live="polite">正在读取周排班</div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
