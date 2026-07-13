'use client';

import { PlusOutlined, SettingOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import {
  parseStaffPage,
  type ScopedPage,
  type StaffProfile
} from '../lib/m02-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  DirectoryFailureCard,
  DirectoryPageHeader,
  DirectoryStaleAlert,
  FacilityRequiredCard
} from './m02-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type StaffStatusFilter = 'all' | StaffProfile['status'];
type StaffSort = 'displayName' | 'employeeCode' | 'jobTitle' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type StaffColumnKey = 'identity' | 'jobTitle' | 'status' | 'team' | 'employment' | 'updatedAt';

const columnOptions: Array<{ key: StaffColumnKey; label: string; locked?: boolean }> = [
  { key: 'identity', label: '员工', locked: true },
  { key: 'jobTitle', label: '岗位' },
  { key: 'status', label: '状态' },
  { key: 'team', label: '主要照护组' },
  { key: 'employment', label: '任职期间' },
  { key: 'updatedAt', label: '最近更新' }
];

function formatDate(value: string | null): string {
  if (value === null) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function staffStatusTag(status: StaffProfile['status']) {
  if (status === 'ACTIVE') return <Tag color="success">在职</Tag>;
  if (status === 'INACTIVE') return <Tag color="warning">暂停排班</Tag>;
  return <Tag>已归档</Tag>;
}

export function StaffDirectoryPage() {
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>('all');
  const [sort, setSort] = useState<StaffSort>('displayName');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [visibleColumns, setVisibleColumns] = useState<StaffColumnKey[]>(
    columnOptions.map(({ key }) => key)
  );

  useEffect(() => {
    const initialStatus = new URLSearchParams(window.location.search).get('status');
    if (initialStatus === 'ACTIVE' || initialStatus === 'INACTIVE' || initialStatus === 'ARCHIVED') {
      setStatusFilter(initialStatus);
    }
  }, []);

  useEffect(() => setPage(1), [deferredSearch, statusFilter, sort, direction]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (deferredSearch.length > 0) next.set('search', deferredSearch);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    return next;
  }, [deferredSearch, direction, page, pageSize, sort, statusFilter]);

  const url = facilityId === null
    ? ''
    : `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/staff?${params.toString()}`;
  const parsePage = useCallback(
    (value: unknown): ScopedPage<StaffProfile> =>
      parseStaffPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const directory = useScopedDirectory({ enabled: facilityId !== null, parse: parsePage, url });
  const visibleSet = new Set(visibleColumns);

  const columns: TableColumnsType<StaffProfile> = [
    {
      title: '员工',
      key: 'identity',
      width: 235,
      sorter: true,
      sortOrder: sort === 'displayName' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, staff) => (
        <div className="m02-identity-cell">
          <span className="m02-avatar" aria-hidden="true"><UserOutlined /></span>
          <span><strong>{staff.displayName}</strong><small>{staff.employeeCode}</small></span>
        </div>
      )
    },
    {
      title: '岗位',
      dataIndex: 'jobTitle',
      key: 'jobTitle',
      width: 180,
      sorter: true,
      sortOrder: sort === 'jobTitle' ? (direction === 'asc' ? 'ascend' : 'descend') : null
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      sorter: true,
      sortOrder: sort === 'status' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, staff) => staffStatusTag(staff.status)
    },
    {
      title: '主要照护组',
      key: 'team',
      width: 190,
      render: (_, staff) => staff.primaryTeamId === null
        ? <span className="m02-muted">暂未分配</span>
        : <Tag icon={<TeamOutlined />} color="blue">已分配照护组</Tag>
    },
    {
      title: '任职期间',
      key: 'employment',
      width: 210,
      render: (_, staff) => (
        <span>{formatDate(staff.hiredAt)} — {staff.endedAt === null ? '至今' : formatDate(staff.endedAt)}</span>
      )
    },
    {
      title: '最近更新',
      key: 'updatedAt',
      width: 170,
      sorter: true,
      sortOrder: sort === 'updatedAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, staff) => <time dateTime={staff.updatedAt}>{formatDateTime(staff.updatedAt)}</time>
    }
  ];
  const displayedColumns = columns.filter((column) => visibleSet.has(column.key as StaffColumnKey));

  const handleTableChange: TableProps<StaffProfile>['onChange'] = (pagination, _filters, sorterValue) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const activeSorter = Array.isArray(sorterValue) ? sorterValue[0] : sorterValue;
    if (activeSorter?.order === undefined) {
      setSort('displayName');
      setDirection('asc');
      return;
    }

    const nextSort: StaffSort = activeSorter.columnKey === 'jobTitle'
      ? 'jobTitle'
      : activeSorter.columnKey === 'status'
        ? 'status'
        : activeSorter.columnKey === 'updatedAt'
          ? 'updatedAt'
          : 'displayName';
    setSort(nextSort);
    setDirection(activeSorter.order === 'descend' ? 'desc' : 'asc');
  };

  return (
    <div className="m02-page staff-directory-page">
      <DirectoryPageHeader
        section="护理、人员与排班"
        title="员工目录"
        description="查看当前院区员工、岗位、任职状态和照护组分配；账号权限仍由人员权限模块管理。"
        actions={
          <Tooltip title="当前页面只接入读取接口">
            <Button disabled icon={<PlusOutlined />}>新增员工</Button>
          </Tooltip>
        }
      />

      {facilityId === null ? <FacilityRequiredCard /> : directory.failure !== null && directory.data === null ? (
        <DirectoryFailureCard failure={directory.failure} onRetry={directory.retry} resourceName="员工目录" />
      ) : (
        <Card className="m02-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m02-toolbar">
            <div>
              <h2>院区员工</h2>
              <p>顶部搜索支持姓名、员工编号和岗位；不展示私人联系方式。</p>
            </div>
            <Space size={12} wrap>
              <Select<StaffStatusFilter>
                aria-label="筛选员工状态"
                value={statusFilter}
                options={[
                  { value: 'all', label: '全部员工状态' },
                  { value: 'ACTIVE', label: '在职' },
                  { value: 'INACTIVE', label: '暂停排班' },
                  { value: 'ARCHIVED', label: '已归档' }
                ]}
                onChange={setStatusFilter}
              />
              <Popover
                placement="bottomRight"
                trigger="click"
                title="显示列"
                content={
                  <div className="column-visibility-controls">
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
                    <span>员工身份列固定显示，避免失去排班上下文。</span>
                  </div>
                }
              >
                <Button icon={<SettingOutlined />} aria-label="设置员工表格可见列">列设置</Button>
              </Popover>
            </Space>
          </div>

          {directory.stale ? <DirectoryStaleAlert onRetry={directory.retry} /> : null}
          <Table<StaffProfile>
            className="m02-table"
            columns={displayedColumns}
            dataSource={directory.data?.items ?? []}
            loading={{ spinning: directory.loading, description: '正在读取员工目录' }}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前搜索和筛选下没有员工" /> }}
            pagination={{
              current: page,
              pageSize,
              total: directory.data?.pageInfo.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `共 ${total} 名员工`
            }}
            rowKey="id"
            scroll={{ x: 1075 }}
            onChange={handleTableChange}
          />
        </Card>
      )}
    </div>
  );
}
