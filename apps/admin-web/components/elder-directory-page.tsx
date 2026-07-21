'use client';

import {
  EyeOutlined,
  LockOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Popover,
  Result,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import {
  parseElderDetail,
  parseEldersPage,
  type ElderDetail,
  type ElderListItem,
  type ScopedPage
} from '../lib/m02-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  DirectoryFailureCard,
  DirectoryPageHeader,
  DirectoryStaleAlert,
  FacilityRequiredCard
} from './m02-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type ElderStatusFilter = 'all' | ElderListItem['status'];
type StayStatusFilter = 'all' | 'PLANNED' | 'ACTIVE' | 'DISCHARGED' | 'CANCELLED';
type ElderSort = 'displayName' | 'recordNumber' | 'careLevel' | 'admittedAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type ElderColumnKey = 'identity' | 'residence' | 'careLevel' | 'status' | 'admittedAt' | 'updatedAt';

const columnOptions: Array<{ key: ElderColumnKey; label: string; locked?: boolean }> = [
  { key: 'identity', label: '老人档案', locked: true },
  { key: 'residence', label: '当前房间床位' },
  { key: 'careLevel', label: '护理等级' },
  { key: 'status', label: '档案状态' },
  { key: 'admittedAt', label: '本次入住' },
  { key: 'updatedAt', label: '最近更新' }
];

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function elderStatusTag(status: ElderListItem['status']) {
  if (status === 'ACTIVE') return <Tag color="success">在院</Tag>;
  if (status === 'DISCHARGED') return <Tag color="blue">已离院</Tag>;
  return <Tag>已归档</Tag>;
}

function residenceLabel(elder: ElderListItem): string {
  const residence = elder.currentResidence;
  if (residence === null) return '当前无在院床位';

  return [
    residence.buildingName,
    residence.floorName,
    residence.zoneName,
    residence.roomName,
    residence.bedLabel
  ].filter(Boolean).join(' · ');
}

function ElderSummary({
  canReadSensitive,
  elder,
  onCheckSensitive,
  showSensitiveNotice
}: Readonly<{
  canReadSensitive: boolean;
  elder: ElderDetail;
  onCheckSensitive: () => void;
  showSensitiveNotice: boolean;
}>) {
  return (
    <div className="m02-detail-content">
      <Alert
        showIcon
        type="info"
        title="快速详情只展示必要摘要"
        description="生日、联系人、无障碍档案、个人基线和同意记录不会在此抽屉中展开。"
      />
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="称呼">{elder.preferredName ?? elder.displayName}</Descriptions.Item>
        <Descriptions.Item label="档案编号">{elder.recordNumber}</Descriptions.Item>
        <Descriptions.Item label="状态">{elderStatusTag(elder.status)}</Descriptions.Item>
        <Descriptions.Item label="护理等级">
          {elder.careLevel?.name ?? <span className="m02-muted">尚未设置</span>}
        </Descriptions.Item>
        <Descriptions.Item label="当前房间床位">{residenceLabel(elder)}</Descriptions.Item>
        <Descriptions.Item label="本次入住">
          {elder.currentResidence === null
            ? '无有效入住'
            : <time dateTime={elder.currentResidence.admittedAt}>{formatDateTime(elder.currentResidence.admittedAt)}</time>}
        </Descriptions.Item>
        <Descriptions.Item label="最近更新">
          <time dateTime={elder.updatedAt}>{formatDateTime(elder.updatedAt)}</time>
        </Descriptions.Item>
      </Descriptions>

      <section className="m02-sensitive-gate" aria-labelledby="sensitive-gate-title">
        <div>
          <h3 id="sensitive-gate-title"><LockOutlined aria-hidden="true" />受限资料</h3>
          <p>
            {canReadSensitive
              ? '当前会话具备敏感阅读权限，但仍需通过独立受限流程读取。'
              : '当前会话不具备 elder.read.sensitive 权限。'}
          </p>
        </div>
        <Tooltip title={canReadSensitive ? undefined : '需要额外的老人敏感资料阅读权限'}>
          <Button
            disabled={!canReadSensitive}
            icon={<SafetyCertificateOutlined />}
            onClick={onCheckSensitive}
          >
            检查访问资格
          </Button>
        </Tooltip>
      </section>
      {showSensitiveNotice ? (
        <Alert
          showIcon
          type="success"
          title="访问资格已确认"
          description="为避免在快速抽屉暴露敏感字段，本页面不会调用敏感详情接口。"
        />
      ) : null}
    </div>
  );
}

export function ElderDirectoryPage() {
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<ElderStatusFilter>('all');
  const [stayStatusFilter, setStayStatusFilter] = useState<StayStatusFilter>('all');
  const [sort, setSort] = useState<ElderSort>('displayName');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [visibleColumns, setVisibleColumns] = useState<ElderColumnKey[]>(
    columnOptions.map(({ key }) => key)
  );
  const [selectedElder, setSelectedElder] = useState<ElderListItem | null>(null);
  const [showSensitiveNotice, setShowSensitiveNotice] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initialStatus = query.get('status');
    const initialStayStatus = query.get('stayStatus');
    if (initialStatus === 'ACTIVE' || initialStatus === 'DISCHARGED' || initialStatus === 'ARCHIVED') {
      setStatusFilter(initialStatus);
    }
    if (
      initialStayStatus === 'ACTIVE' ||
      initialStayStatus === 'PLANNED' ||
      initialStayStatus === 'DISCHARGED' ||
      initialStayStatus === 'CANCELLED'
    ) {
      setStayStatusFilter(initialStayStatus);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    setSelectedElder(null);
  }, [deferredSearch, statusFilter, stayStatusFilter, sort, direction]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (deferredSearch.length > 0) next.set('search', deferredSearch);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (stayStatusFilter !== 'all') next.set('stayStatus', stayStatusFilter);
    return next;
  }, [deferredSearch, direction, page, pageSize, sort, statusFilter, stayStatusFilter]);

  const listUrl = facilityId === null
    ? ''
    : `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/elders?${params.toString()}`;
  const parseList = useCallback(
    (value: unknown): ScopedPage<ElderListItem> =>
      parseEldersPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const directory = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseList,
    url: listUrl
  });

  const detailUrl = facilityId === null || selectedElder === null
    ? ''
    : `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/elders/${encodeURIComponent(selectedElder.id)}`;
  const parseDetail = useCallback(
    (value: unknown): ElderDetail => parseElderDetail(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const detail = useScopedDirectory({
    enabled: facilityId !== null && selectedElder !== null,
    parse: parseDetail,
    url: detailUrl
  });

  const visibleSet = new Set(visibleColumns);
  const columns: TableColumnsType<ElderListItem> = [
    {
      title: '老人档案',
      key: 'identity',
      width: 220,
      sorter: true,
      sortOrder: sort === 'displayName' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, elder) => (
        <div className="m02-identity-cell">
          <span className="m02-avatar" aria-hidden="true"><UserOutlined /></span>
          <span><strong>{elder.preferredName ?? elder.displayName}</strong><small>{elder.recordNumber}</small></span>
        </div>
      )
    },
    {
      title: '当前房间床位',
      key: 'residence',
      width: 260,
      render: (_, elder) => (
        <span className={elder.currentResidence === null ? 'm02-muted' : undefined}>
          {residenceLabel(elder)}
        </span>
      )
    },
    {
      title: '护理等级',
      key: 'careLevel',
      width: 150,
      sorter: true,
      sortOrder: sort === 'careLevel' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, elder) => elder.careLevel === null
        ? <span className="m02-muted">尚未设置</span>
        : <Tag color="blue">{elder.careLevel.name}</Tag>
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, elder) => elderStatusTag(elder.status)
    },
    {
      title: '本次入住',
      key: 'admittedAt',
      width: 160,
      sorter: true,
      sortOrder: sort === 'admittedAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, elder) => elder.currentResidence === null
        ? <span className="m02-muted">无有效入住</span>
        : <time dateTime={elder.currentResidence.admittedAt}>{formatDateTime(elder.currentResidence.admittedAt)}</time>
    },
    {
      title: '最近更新',
      key: 'updatedAt',
      width: 160,
      sorter: true,
      sortOrder: sort === 'updatedAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, elder) => <time dateTime={elder.updatedAt}>{formatDateTime(elder.updatedAt)}</time>
    },
    {
      title: '操作',
      key: 'action',
      width: 122,
      fixed: 'right',
      render: (_, elder) => (
        <Button icon={<EyeOutlined />} onClick={() => setSelectedElder(elder)}>快速详情</Button>
      )
    }
  ];
  const displayedColumns = columns.filter(
    (column) => column.key === 'action' || visibleSet.has(column.key as ElderColumnKey)
  );

  const handleTableChange: TableProps<ElderListItem>['onChange'] = (pagination, _filters, sorterValue) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const activeSorter = Array.isArray(sorterValue) ? sorterValue[0] : sorterValue;
    if (activeSorter?.order === undefined) {
      setSort('displayName');
      setDirection('asc');
      return;
    }

    const nextSort: ElderSort = activeSorter.columnKey === 'careLevel'
      ? 'careLevel'
      : activeSorter.columnKey === 'admittedAt'
        ? 'admittedAt'
        : activeSorter.columnKey === 'updatedAt'
          ? 'updatedAt'
          : 'displayName';
    setSort(nextSort);
    setDirection(activeSorter.order === 'descend' ? 'desc' : 'asc');
  };

  const canReadSensitive = session.permissions.includes('elder.read.sensitive');

  return (
    <div className="m02-page elder-directory-page">
      <DirectoryPageHeader
        section="老人与入住"
        title="老人档案"
        description="按当前机构与院区范围查看入住、护理等级和必要摘要；敏感资料继续独立授权。"
        actions={
          <Tooltip title="当前页面只接入读取接口">
            <Button disabled icon={<PlusOutlined />}>新增老人</Button>
          </Tooltip>
        }
      />

      {facilityId === null ? <FacilityRequiredCard /> : directory.failure !== null && directory.data === null ? (
        <DirectoryFailureCard
          failure={directory.failure}
          onRetry={directory.retry}
          resourceName="老人档案"
        />
      ) : (
        <Card className="m02-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m02-toolbar">
            <div>
              <h2>在院与历史档案</h2>
              <p>顶部搜索支持姓名、档案号和房间床位；结果由后端范围策略裁剪。</p>
            </div>
            <Space size={12} wrap>
              <Select<ElderStatusFilter>
                aria-label="筛选老人档案状态"
                value={statusFilter}
                options={[
                  { value: 'all', label: '全部档案状态' },
                  { value: 'ACTIVE', label: '在院' },
                  { value: 'DISCHARGED', label: '已离院' },
                  { value: 'ARCHIVED', label: '已归档' }
                ]}
                onChange={setStatusFilter}
              />
              <Select<StayStatusFilter>
                aria-label="筛选入住状态"
                value={stayStatusFilter}
                options={[
                  { value: 'all', label: '全部入住状态' },
                  { value: 'ACTIVE', label: '当前入住' },
                  { value: 'PLANNED', label: '计划入住' },
                  { value: 'DISCHARGED', label: '历史入住' },
                  { value: 'CANCELLED', label: '已取消' }
                ]}
                onChange={setStayStatusFilter}
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
                    <span>档案与操作列固定显示，避免失去必要上下文。</span>
                  </div>
                }
              >
                <Button icon={<SettingOutlined />} aria-label="设置老人表格可见列">列设置</Button>
              </Popover>
            </Space>
          </div>

          {directory.stale ? <DirectoryStaleAlert onRetry={directory.retry} /> : null}
          <Table<ElderListItem>
            className="m02-table"
            columns={displayedColumns}
            dataSource={directory.data?.items ?? []}
            loading={{ spinning: directory.loading, description: '正在读取老人档案' }}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前搜索和筛选下没有老人档案" />
            }}
            pagination={{
              current: page,
              pageSize,
              total: directory.data?.pageInfo.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `共 ${total} 份档案`
            }}
            rowKey="id"
            scroll={{ x: 1135 }}
            onChange={handleTableChange}
          />
        </Card>
      )}

      <Drawer
        destroyOnHidden
        open={selectedElder !== null}
        title={(
          <h2 className="m02-drawer-title">
            {selectedElder === null
              ? '老人快速详情'
              : `${selectedElder.preferredName ?? selectedElder.displayName} · 快速详情`}
          </h2>
        )}
        size={520}
        onClose={() => {
          setSelectedElder(null);
          setShowSensitiveNotice(false);
        }}
      >
        {detail.failure !== null && detail.data === null ? (
          <DirectoryFailureCard
            failure={detail.failure}
            onRetry={detail.retry}
            resourceName="老人快速详情"
          />
        ) : detail.data === null ? (
          <Result status="info" title="正在读取必要摘要" />
        ) : (
          <ElderSummary
            canReadSensitive={canReadSensitive}
            elder={detail.data}
            onCheckSensitive={() => setShowSensitiveNotice(true)}
            showSensitiveNotice={showSensitiveNotice}
          />
        )}
      </Drawer>
    </div>
  );
}
