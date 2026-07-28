'use client';

import {
  EyeOutlined,
  FilterOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserSwitchOutlined
} from '@ant-design/icons';
import { Button, Card, Checkbox, Empty, Popover, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import {
  M03_API_PATHS,
  parseWorkOrdersPage,
  withQuery,
  type ScopedPage,
  type WorkOrderAdminItem
} from '../lib/m03-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  formatDateTime,
  M03FacilityRequiredCard,
  M03FailureCard,
  M03PageHeader,
  M03StaleAlert,
  PRIORITY_LABELS,
  RiskBadge,
  safeShortId,
  SlaBadge,
  WORK_ORDER_STATUS_LABELS,
  WorkOrderStatusBadge
} from './m03-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type WorkOrderStatusFilter = 'all' | WorkOrderAdminItem['status'];
type WorkOrderPriorityFilter = 'all' | WorkOrderAdminItem['priority'];
type OverdueFilter = 'all' | 'true' | 'false';
type WorkOrderSort = 'createdAt' | 'dueAt' | 'priority' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type WorkOrderColumnKey =
  | 'createdAt'
  | 'elder'
  | 'priority'
  | 'status'
  | 'owner'
  | 'dueAt'
  | 'updatedAt';

const columnOptions: Array<{ key: WorkOrderColumnKey; label: string; locked?: boolean }> = [
  { key: 'createdAt', label: '工单', locked: true },
  { key: 'elder', label: '老人', locked: true },
  { key: 'priority', label: '风险' },
  { key: 'status', label: '状态' },
  { key: 'owner', label: '当前负责人' },
  { key: 'dueAt', label: 'SLA' },
  { key: 'updatedAt', label: '最近更新' }
];

const statusOptions = Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

function ownerCell(workOrder: WorkOrderAdminItem) {
  if (workOrder.currentAssignment === null) {
    return (
      <span className="m03-stack-cell">
        <Tag icon={<UserSwitchOutlined />} color="warning">待分配</Tag>
        <small>尚无当前负责人</small>
      </span>
    );
  }
  return (
    <span className="m03-stack-cell">
      <strong>{workOrder.assignee?.displayName ?? `人员 ${safeShortId(workOrder.currentAssignment.assigneeStaffProfileId ?? workOrder.currentAssignment.targetTeamId ?? workOrder.currentAssignment.id)}`}</strong>
      <small>{workOrder.assignee?.jobTitle ?? (workOrder.currentAssignment.status === 'CLAIMED' ? '已接单' : '已分配待接单')}</small>
    </span>
  );
}

export function WorkOrderListPage() {
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<WorkOrderStatusFilter>('all');
  const [priority, setPriority] = useState<WorkOrderPriorityFilter>('all');
  const [overdue, setOverdue] = useState<OverdueFilter>('all');
  const [sort, setSort] = useState<WorkOrderSort>('createdAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<WorkOrderColumnKey[]>(
    columnOptions.map(({ key }) => key)
  );

  useEffect(() => setPage(1), [deferredSearch, direction, overdue, priority, sort, status]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (deferredSearch.length > 0) next.set('search', deferredSearch);
    if (status !== 'all') next.set('status', status);
    if (priority !== 'all') next.set('priority', priority);
    if (overdue !== 'all') next.set('overdue', overdue);
    return next;
  }, [deferredSearch, direction, overdue, page, pageSize, priority, sort, status]);

  const url = facilityId === null
    ? ''
    : withQuery(M03_API_PATHS.workOrders(organizationId, facilityId), params);
  const parsePage = useCallback(
    (value: unknown): ScopedPage<WorkOrderAdminItem> =>
      parseWorkOrdersPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const directory = useScopedDirectory({ enabled: facilityId !== null, parse: parsePage, url });

  const columns: TableColumnsType<WorkOrderAdminItem> = [
    {
      title: '工单',
      key: 'createdAt',
      width: 300,
      sorter: true,
      sortOrder: sort === 'createdAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, workOrder) => (
        <span className="m03-stack-cell">
          <Link href={`/work-orders/${encodeURIComponent(workOrder.id)}`}><strong>{workOrder.title}</strong></Link>
          <small>{workOrder.code} · 创建于 {formatDateTime(workOrder.createdAt)}</small>
        </span>
      )
    },
    {
      title: '老人',
      key: 'elder',
      width: 170,
      render: (_, workOrder) => (
        <span className="m03-stack-cell">
          <strong>{workOrder.elder?.preferredName ?? workOrder.elder?.displayName ?? `老人 ${safeShortId(workOrder.elderId)}`}</strong>
          <small>{workOrder.elder?.roomLabel ?? '房间信息未随响应提供'}</small>
        </span>
      )
    },
    {
      title: '风险',
      key: 'priority',
      width: 230,
      sorter: true,
      sortOrder: sort === 'priority' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, workOrder) => <RiskBadge priority={workOrder.priority} />
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      sorter: true,
      sortOrder: sort === 'status' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, workOrder) => <WorkOrderStatusBadge status={workOrder.status} />
    },
    {
      title: '当前负责人',
      key: 'owner',
      width: 190,
      render: (_, workOrder) => ownerCell(workOrder)
    },
    {
      title: 'SLA',
      key: 'dueAt',
      width: 240,
      sorter: true,
      sortOrder: sort === 'dueAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, workOrder) => (
        <span className="m03-stack-cell">
          <SlaBadge completedAt={workOrder.completedAt} dueAt={workOrder.dueAt} status={workOrder.status} />
          <small>计划完成：{formatDateTime(workOrder.dueAt)}</small>
        </span>
      )
    },
    {
      title: '最近更新',
      key: 'updatedAt',
      width: 170,
      sorter: true,
      sortOrder: sort === 'updatedAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, workOrder) => <time dateTime={workOrder.updatedAt}>{formatDateTime(workOrder.updatedAt)}</time>
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      fixed: 'right',
      render: (_, workOrder) => (
        <Link className="ant-btn ant-btn-default" href={`/work-orders/${encodeURIComponent(workOrder.id)}`}>
          <EyeOutlined />详情
        </Link>
      )
    }
  ];
  const visibleSet = new Set(visibleColumns);
  const displayedColumns = columns.filter(
    (column) => column.key === 'action' || visibleSet.has(column.key as WorkOrderColumnKey)
  );

  const handleTableChange: TableProps<WorkOrderAdminItem>['onChange'] = (pagination, _filters, sorterValue) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const activeSorter = Array.isArray(sorterValue) ? sorterValue[0] : sorterValue;
    if (activeSorter?.order === undefined) {
      setSort('createdAt');
      setDirection('desc');
      return;
    }
    const key = activeSorter.columnKey;
    setSort(
      key === 'dueAt' || key === 'priority' || key === 'status' || key === 'updatedAt'
        ? key
        : 'createdAt'
    );
    setDirection(activeSorter.order === 'ascend' ? 'asc' : 'desc');
  };

  return (
    <div className="m03-page work-order-list-page">
      <M03PageHeader
        section="照护运营"
        title="工单管理"
        description="按风险、状态、负责人和 SLA 管理照护工单；验证与关闭操作只在详情页执行并保留审计记录。"
        actions={
          <Link className="ant-btn ant-btn-default" href="/needs">
            <SafetyCertificateOutlined />需求复核队列
          </Link>
        }
      />

      {facilityId === null ? <M03FacilityRequiredCard /> : directory.failure !== null && directory.data === null ? (
        <M03FailureCard failure={directory.failure} onRetry={directory.retry} resourceName="工单列表" />
      ) : (
        <Card className="m03-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m03-toolbar">
            <div>
              <h2><FilterOutlined aria-hidden="true" /> 院区工单</h2>
              <p>搜索、筛选、排序和分页均由服务端执行；风险信息同时使用图标、标签和文字说明。</p>
            </div>
            <Space size={10} wrap>
              <Select<WorkOrderStatusFilter>
                aria-label="筛选工单状态"
                value={status}
                options={[{ value: 'all', label: '全部状态' }, ...statusOptions]}
                onChange={setStatus}
              />
              <Select<WorkOrderPriorityFilter>
                aria-label="筛选工单风险"
                value={priority}
                options={[{ value: 'all', label: '全部风险' }, ...priorityOptions]}
                onChange={setPriority}
              />
              <Select<OverdueFilter>
                aria-label="筛选 SLA 状态"
                value={overdue}
                options={[
                  { value: 'all', label: '全部 SLA' },
                  { value: 'true', label: '仅看逾期' },
                  { value: 'false', label: '仅看未逾期' }
                ]}
                onChange={setOverdue}
              />
              <Popover
                placement="bottomRight"
                trigger="click"
                title="显示列"
                content={
                  <div className="column-visibility-controls m03-column-visibility-controls">
                    {columnOptions.map((option) => (
                      <Checkbox
                        key={option.key}
                        checked={visibleSet.has(option.key)}
                        disabled={option.locked}
                        onChange={() => {
                          if (option.locked) return;
                          setVisibleColumns((current) =>
                            current.includes(option.key)
                              ? current.filter((key) => key !== option.key)
                              : [...current, option.key]
                          );
                        }}
                      >
                        {option.label}
                      </Checkbox>
                    ))}
                    <span>工单、老人和操作列固定显示，确保处置对象不会丢失。</span>
                  </div>
                }
              >
                <Button icon={<SettingOutlined />} aria-label="设置工单表格可见列">列设置</Button>
              </Popover>
            </Space>
          </div>
          {directory.stale ? <M03StaleAlert onRetry={directory.retry} /> : null}
          <Table<WorkOrderAdminItem>
            className="m03-table"
            columns={displayedColumns}
            dataSource={directory.data?.items ?? []}
            loading={{ spinning: directory.loading, description: '正在读取工单列表' }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="当前搜索与筛选下没有工单"
                />
              )
            }}
            pagination={{
              current: page,
              pageSize,
              total: directory.data?.pageInfo.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `共 ${total} 张工单`
            }}
            rowKey="id"
            scroll={{ x: 1540 }}
            onChange={handleTableChange}
          />
        </Card>
      )}
    </div>
  );
}
