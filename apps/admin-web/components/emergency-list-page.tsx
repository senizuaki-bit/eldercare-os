'use client';

import {
  AlertFilled,
  ClockCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  TeamOutlined
} from '@ant-design/icons';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Popover,
  Select,
  Space,
  Table,
  Tag
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import Link from 'next/link';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from 'react';

import {
  M04_API_PATHS,
  parseEmergencyAdminPage,
  type EmergencyAdminItem,
  type EmergencyAdminPage,
  type EmergencyLocationState,
  type EmergencySourceKind,
  type EmergencyStatus
} from '../lib/m04-contract';
import { withQuery } from '../lib/m03-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  EMERGENCY_SOURCE_LABELS,
  EMERGENCY_STATUS_LABELS,
  EmergencyLocationBadge,
  EmergencySlaTimer,
  EmergencyStatusBadge,
  emergencyReasonLabel,
  formatEmergencyDateTime,
  M04FacilityRequiredCard,
  M04FailureCard,
  M04PageHeader,
  M04StaleAlert
} from './m04-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type StatusFilter = 'all' | EmergencyStatus;
type SourceFilter = 'all' | EmergencySourceKind;
type LocationFilter = 'all' | EmergencyLocationState;
type EmergencySort = 'openedAt' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type ColumnKey =
  | 'event'
  | 'elder'
  | 'status'
  | 'location'
  | 'responder'
  | 'sla'
  | 'openedAt';

const columnOptions: Array<{ key: ColumnKey; label: string; locked?: boolean }> = [
  { key: 'event', label: '紧急事件', locked: true },
  { key: 'elder', label: '服务对象', locked: true },
  { key: 'status', label: '响应状态' },
  { key: 'location', label: '位置时效' },
  { key: 'responder', label: '当前响应人' },
  { key: 'sla', label: '当前 SLA' },
  { key: 'openedAt', label: '发生时间' }
];

const statusOptions = Object.entries(EMERGENCY_STATUS_LABELS).map(([value, label]) => ({
  label,
  value
}));
const sourceOptions = Object.entries(EMERGENCY_SOURCE_LABELS).map(([value, label]) => ({
  label,
  value
}));
const locationOptions: Array<{ label: string; value: LocationFilter }> = [
  { label: '全部位置状态', value: 'all' },
  { label: '位置当前有效', value: 'CURRENT' },
  { label: '位置已过期', value: 'STALE' },
  { label: '房间回退', value: 'ROOM_FALLBACK' },
  { label: '位置未知', value: 'UNKNOWN' }
];

function responderCell(item: EmergencyAdminItem) {
  if (item.currentResponder === null) {
    return (
      <span className="m04-stack-cell">
        <Tag color="error" icon={<TeamOutlined />}>待派发</Tag>
        <small>尚无当前响应人员</small>
      </span>
    );
  }
  return (
    <span className="m04-stack-cell">
      <strong>{item.currentResponder.displayName ?? '已分配工作人员'}</strong>
      <small>
        {item.currentResponder.jobTitle ?? '岗位未随响应提供'} ·{' '}
        {item.currentResponder.status === 'ACKNOWLEDGED' ? '已确认负责' : '等待确认'}
      </small>
    </span>
  );
}

export function EmergencyListPage() {
  const { searchTerm, session } = useAdminShellSearch();
  const search = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [locationState, setLocationState] = useState<LocationFilter>('all');
  const [sort, setSort] = useState<EmergencySort>('openedAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(
    columnOptions.map(({ key }) => key)
  );

  useEffect(() => setPage(1), [
    direction,
    locationState,
    search,
    sort,
    source,
    status
  ]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: sort,
      sortDirection: direction
    });
    if (search.length > 0) next.set('search', search);
    if (status !== 'all') next.set('status', status);
    if (source !== 'all') next.set('sourceKind', source);
    if (locationState !== 'all') next.set('locationState', locationState);
    return next;
  }, [direction, locationState, page, pageSize, search, sort, source, status]);

  const url =
    facilityId === null
      ? ''
      : withQuery(M04_API_PATHS.emergencies(organizationId, facilityId), params);
  const parse = useCallback(
    (value: unknown): EmergencyAdminPage =>
      parseEmergencyAdminPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const directory = useScopedDirectory({
    enabled: facilityId !== null,
    parse,
    url
  });
  const columns: TableColumnsType<EmergencyAdminItem> = [
    {
      key: 'event',
      title: '紧急事件',
      width: 310,
      render: (_, item) => (
        <span className="m04-stack-cell">
          <Link href={`/emergencies/${encodeURIComponent(item.id)}`}>
            <strong>
              <AlertFilled aria-hidden="true" /> {emergencyReasonLabel(item.reasonCode)}
            </strong>
          </Link>
          <small>
            {EMERGENCY_SOURCE_LABELS[item.sourceKind]} · 引用 …{item.id.slice(-8)}
          </small>
        </span>
      )
    },
    {
      key: 'elder',
      title: '服务对象',
      width: 190,
      render: (_, item) => (
        <span className="m04-stack-cell">
          <strong>
            {item.elder.preferredName ?? item.elder.displayName}
          </strong>
          <small>{item.elder.roomLabel ?? '房间待人工确认'}</small>
        </span>
      )
    },
    {
      key: 'status',
      title: '响应状态',
      width: 190,
      sorter: true,
      sortOrder:
        sort === 'status'
          ? direction === 'asc'
            ? 'ascend'
            : 'descend'
          : null,
      render: (_, item) => <EmergencyStatusBadge status={item.status} />
    },
    {
      key: 'location',
      title: '位置时效',
      width: 260,
      render: (_, item) => <EmergencyLocationBadge location={item.location} />
    },
    {
      key: 'responder',
      title: '当前响应人',
      width: 220,
      render: (_, item) => responderCell(item)
    },
    {
      key: 'sla',
      title: '当前 SLA',
      width: 240,
      render: (_, item) => (
        <span className="m04-stack-cell">
          <EmergencySlaTimer
            deadlineAt={item.currentDeadlineAt}
            stage={item.activeSla?.stage}
          />
          {item.escalationCount > 0 ? (
            <small className="m04-escalation-copy">
              已触发 {item.escalationCount} 次服务端升级
            </small>
          ) : null}
        </span>
      )
    },
    {
      key: 'openedAt',
      title: '发生时间',
      width: 205,
      sorter: true,
      sortOrder:
        sort === 'openedAt'
          ? direction === 'asc'
            ? 'ascend'
            : 'descend'
          : null,
      render: (_, item) => (
        <span className="m04-stack-cell">
          <strong>
            <ClockCircleOutlined aria-hidden="true" />{' '}
            {formatEmergencyDateTime(item.openedAt)}
          </strong>
          <small>最近更新 {formatEmergencyDateTime(item.updatedAt)}</small>
        </span>
      )
    },
    {
      key: 'action',
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, item) => (
        <Link
          className="ant-btn ant-btn-primary ant-btn-dangerous"
          href={`/emergencies/${encodeURIComponent(item.id)}`}
        >
          <EyeOutlined />进入指挥
        </Link>
      )
    }
  ];

  const visibleSet = new Set(visibleColumns);
  const displayedColumns = columns.filter(
    (column) =>
      column.key === 'action' || visibleSet.has(column.key as ColumnKey)
  );

  const handleTableChange: TableProps<EmergencyAdminItem>['onChange'] = (
    pagination,
    _filters,
    sorterValue
  ) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const activeSorter = Array.isArray(sorterValue)
      ? sorterValue[0]
      : sorterValue;
    if (activeSorter?.order === undefined) {
      setSort('openedAt');
      setDirection('desc');
      return;
    }
    const key = activeSorter.columnKey;
    setSort(key === 'status' ? key : 'openedAt');
    setDirection(activeSorter.order === 'ascend' ? 'asc' : 'desc');
  };

  return (
    <div className="m04-page emergency-list-page">
      <M04PageHeader
        description="未确认和响应中的事件始终位于运营分析之前；每条记录都显示负责人、位置时效、SLA 与人工处置入口。"
        section="风险与事件"
        title="紧急事件"
      />

      {facilityId === null ? (
        <M04FacilityRequiredCard />
      ) : directory.failure !== null && directory.data === null ? (
        <M04FailureCard
          failure={directory.failure}
          onRetry={directory.retry}
          resourceName="紧急事件队列"
        />
      ) : (
        <Card
          className="m04-surface-card m04-critical-queue-card"
          styles={{ body: { padding: 0 } }}
        >
          <div className="m04-toolbar">
            <div>
              <h2>
                <AlertFilled aria-hidden="true" /> 当前紧急响应队列
              </h2>
              <p>
                搜索、筛选、排序和分页由服务端执行；红色仅辅助表达，状态同时提供图标和文字。
              </p>
            </div>
            <Space size={10} wrap>
              <Select<StatusFilter>
                aria-label="筛选紧急事件状态"
                value={status}
                options={[
                  { label: '全部状态', value: 'all' },
                  ...statusOptions
                ]}
                onChange={setStatus}
              />
              <Select<SourceFilter>
                aria-label="筛选紧急事件来源"
                value={source}
                options={[
                  { label: '全部来源', value: 'all' },
                  ...sourceOptions
                ]}
                onChange={setSource}
              />
              <Select<LocationFilter>
                aria-label="筛选位置时效"
                value={locationState}
                options={locationOptions}
                onChange={setLocationState}
              />
              <Popover
                placement="bottomRight"
                trigger="click"
                title="显示列"
                content={
                  <div className="column-visibility-controls m04-column-visibility-controls">
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
                    <span>事件、服务对象和操作列固定显示，确保处置上下文不会丢失。</span>
                  </div>
                }
              >
                <Button
                  aria-label="设置紧急事件表格可见列"
                  icon={<SettingOutlined />}
                >
                  列设置
                </Button>
              </Popover>
            </Space>
          </div>
          {directory.stale ? <M04StaleAlert onRetry={directory.retry} /> : null}
          <Table<EmergencyAdminItem>
            className="m04-table"
            columns={displayedColumns}
            dataSource={directory.data?.items ?? []}
            loading={{
              description: '正在读取紧急事件队列',
              spinning: directory.loading
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="当前搜索与筛选下没有紧急事件"
                />
              )
            }}
            onChange={handleTableChange}
            pagination={{
              current: page,
              pageSize,
              pageSizeOptions: [10, 20, 50],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条紧急事件`,
              total: directory.data?.pageInfo.total ?? 0
            }}
            rowClassName={(item) =>
              item.status === 'OPEN' ? 'm04-open-row' : ''
            }
            rowKey="id"
            scroll={{ x: 1_735 }}
          />
        </Card>
      )}
    </div>
  );
}
