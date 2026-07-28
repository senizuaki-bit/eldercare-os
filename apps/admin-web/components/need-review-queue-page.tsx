'use client';

import {
  CheckOutlined,
  EyeOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StopOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../lib/api-client';
import {
  M03_API_PATHS,
  parseNeedsPage,
  validateNeedReviewRequest,
  withQuery,
  type NeedAdminItem,
  type ScopedPage
} from '../lib/m03-contract';
import { useAdminShellSearch } from './admin-shell';
import {
  formatDateTime,
  M03FacilityRequiredCard,
  M03FailureCard,
  M03PageHeader,
  M03StaleAlert,
  NEED_CATEGORY_LABELS,
  NEED_STATUS_LABELS,
  NeedStatusBadge,
  PRIORITY_LABELS,
  RiskBadge,
  safeShortId
} from './m03-page-primitives';
import { useScopedDirectory } from './use-scoped-directory';

type NeedStatusFilter = 'all' | NeedAdminItem['status'];
type NeedCategoryFilter = 'all' | NeedAdminItem['category'];
type NeedPriorityFilter = 'all' | NeedAdminItem['priority'];
type NeedSort = 'createdAt' | 'priority' | 'status' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type NeedColumnKey = 'createdAt' | 'elder' | 'summary' | 'priority' | 'rules' | 'status';

const columnOptions: Array<{ key: NeedColumnKey; label: string; locked?: boolean }> = [
  { key: 'createdAt', label: '收到时间' },
  { key: 'elder', label: '老人', locked: true },
  { key: 'summary', label: '需求摘要', locked: true },
  { key: 'priority', label: '风险' },
  { key: 'rules', label: '确定性规则' },
  { key: 'status', label: '状态' }
];

const needStatusOptions = Object.entries(NEED_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const needCategoryOptions = Object.entries(NEED_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

function ruleSummary(codes: string[]) {
  if (codes.length === 0) return <span className="m03-muted">未命中升级规则</span>;
  return (
    <Space size={[4, 4]} wrap>
      {codes.slice(0, 2).map((code) => <Tag key={code} color="orange">规则 {code}</Tag>)}
      {codes.length > 2 ? <Tag>另 {codes.length - 2} 项</Tag> : null}
    </Space>
  );
}

function mutationFailureText(status: number): string {
  if (status === 403) return '当前账号没有复核该需求的权限。';
  if (status === 404) return '该需求已不存在或不在当前授权范围内。';
  if (status === 409) return '需求已被其他人员更新，已为你重新加载，请核对后再提交。';
  return '复核提交失败，请稍后重试。';
}

export function NeedReviewQueuePage() {
  const { message } = AntApp.useApp();
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<NeedStatusFilter>('REVIEW_REQUIRED');
  const [category, setCategory] = useState<NeedCategoryFilter>('all');
  const [priority, setPriority] = useState<NeedPriorityFilter>('all');
  const [sort, setSort] = useState<NeedSort>('createdAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [visibleColumns, setVisibleColumns] = useState<NeedColumnKey[]>(
    columnOptions.map(({ key }) => key)
  );
  const [selected, setSelected] = useState<NeedAdminItem | null>(null);
  const [reviewSummary, setReviewSummary] = useState('');
  const [reviewCategory, setReviewCategory] = useState<NeedAdminItem['category']>('OTHER');
  const [reviewPriority, setReviewPriority] = useState<NeedAdminItem['priority']>('ROUTINE');
  const [reasonCode, setReasonCode] = useState('HUMAN_CONFIRMED');
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationFailure, setMutationFailure] = useState<string | null>(null);

  useEffect(() => setPage(1), [category, deferredSearch, direction, priority, sort, status]);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (deferredSearch.length > 0) next.set('search', deferredSearch);
    if (status !== 'all') next.set('status', status);
    if (category !== 'all') next.set('category', category);
    if (priority !== 'all') next.set('priority', priority);
    return next;
  }, [category, deferredSearch, direction, page, pageSize, priority, sort, status]);

  const url = facilityId === null
    ? ''
    : withQuery(M03_API_PATHS.needs(organizationId, facilityId), params);
  const parsePage = useCallback(
    (value: unknown): ScopedPage<NeedAdminItem> =>
      parseNeedsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const directory = useScopedDirectory({ enabled: facilityId !== null, parse: parsePage, url });

  const openReview = (need: NeedAdminItem) => {
    setSelected(need);
    setReviewSummary(need.summary);
    setReviewCategory(need.category);
    setReviewPriority(need.priority);
    setReasonCode('HUMAN_CONFIRMED');
    setMutationFailure(null);
  };

  const submitReview = async (decision: 'CONFIRM' | 'REJECT') => {
    if (selected === null || facilityId === null || mutationPending) return;
    const validReason = decision === 'CONFIRM'
      ? reasonCode === 'HUMAN_CONFIRMED' || reasonCode === 'HUMAN_CORRECTED'
      : reasonCode === 'FALSE_POSITIVE' || reasonCode === 'OUT_OF_SCOPE';
    if (!validReason) {
      setMutationFailure(
        decision === 'CONFIRM'
          ? '请选择“人工确认”或“人工修正”作为确认原因。'
          : '驳回前必须明确选择“规则或草案误报”或“不属于可执行照护需求”。'
      );
      return;
    }
    setMutationFailure(null);
    setMutationPending(true);
    try {
      const payload = validateNeedReviewRequest({
        expectedVersion: selected.version,
        decision,
        ...(decision === 'CONFIRM'
          ? {
              summary: reviewSummary,
              category: reviewCategory,
              priority: reviewPriority
            }
          : {}),
        reasonCode
      });
      const response = await apiFetch(
        M03_API_PATHS.reviewNeed(organizationId, facilityId, selected.id),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (response.status === 401) {
        window.location.assign('/login?reason=expired');
        return;
      }
      if (!response.ok) {
        setMutationFailure(mutationFailureText(response.status));
        if (response.status === 409) directory.retry();
        return;
      }
      void message.success(decision === 'CONFIRM' ? '需求已确认，工单流程可继续。' : '需求已驳回并保留审计原因。');
      setSelected(null);
      directory.retry();
    } catch {
      setMutationFailure(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? '当前处于离线状态，复核没有提交。'
          : '复核内容不完整或服务暂不可用，请检查后重试。'
      );
    } finally {
      setMutationPending(false);
    }
  };

  const columns: TableColumnsType<NeedAdminItem> = [
    {
      title: '收到时间',
      key: 'createdAt',
      width: 160,
      sorter: true,
      sortOrder: sort === 'createdAt' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, need) => <time dateTime={need.createdAt}>{formatDateTime(need.createdAt)}</time>
    },
    {
      title: '老人',
      key: 'elder',
      width: 170,
      render: (_, need) => (
        <span className="m03-stack-cell">
          <strong>{need.elder?.preferredName ?? need.elder?.displayName ?? `老人 ${safeShortId(need.elderId)}`}</strong>
          <small>{need.elder?.roomLabel ?? '房间信息未随响应提供'}</small>
        </span>
      )
    },
    {
      title: '需求摘要',
      key: 'summary',
      width: 330,
      render: (_, need) => (
        <span className="m03-stack-cell">
          <strong>{need.summary}</strong>
          <small>{NEED_CATEGORY_LABELS[need.category]} · {need.source === 'VOICE' ? '老人语音请求' : '人工录入'}</small>
        </span>
      )
    },
    {
      title: '风险',
      key: 'priority',
      width: 230,
      sorter: true,
      sortOrder: sort === 'priority' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, need) => <RiskBadge priority={need.priority} />
    },
    {
      title: '确定性规则',
      key: 'rules',
      width: 190,
      render: (_, need) => ruleSummary(need.safetyRuleCodes)
    },
    {
      title: '状态',
      key: 'status',
      width: 130,
      sorter: true,
      sortOrder: sort === 'status' ? (direction === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, need) => <NeedStatusBadge status={need.status} />
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, need) => (
        <Button
          aria-label={`复核 ${
            need.elder?.preferredName ?? need.elder?.displayName ?? `老人 ${safeShortId(need.elderId)}`
          }：${need.summary}`}
          icon={<EyeOutlined />}
          disabled={need.status !== 'REVIEW_REQUIRED' || directory.stale}
          onClick={() => openReview(need)}
        >
          复核
        </Button>
      )
    }
  ];
  const visibleSet = new Set(visibleColumns);
  const displayedColumns = columns.filter(
    (column) => column.key === 'action' || visibleSet.has(column.key as NeedColumnKey)
  );
  const confirmReasonSelected = reasonCode === 'HUMAN_CONFIRMED' || reasonCode === 'HUMAN_CORRECTED';
  const rejectReasonSelected = reasonCode === 'FALSE_POSITIVE' || reasonCode === 'OUT_OF_SCOPE';

  const handleTableChange: TableProps<NeedAdminItem>['onChange'] = (pagination, _filters, sorterValue) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const activeSorter = Array.isArray(sorterValue) ? sorterValue[0] : sorterValue;
    if (activeSorter?.order === undefined) {
      setSort('createdAt');
      setDirection('desc');
      return;
    }
    const key = activeSorter.columnKey;
    setSort(key === 'priority' || key === 'status' ? key : 'createdAt');
    setDirection(activeSorter.order === 'ascend' ? 'asc' : 'desc');
  };

  return (
    <div className="m03-page need-review-page">
      <M03PageHeader
        section="照护运营"
        title="需求复核队列"
        description="先处理需要人工判断的老人请求；AI 只提供草案，确定性规则与主管复核共同决定后续工单。"
        actions={
          <Link className="ant-btn ant-btn-default" href="/work-orders">
            <FileSearchOutlined />查看工单
          </Link>
        }
      />

      {facilityId === null ? <M03FacilityRequiredCard /> : directory.failure !== null && directory.data === null ? (
        <M03FailureCard failure={directory.failure} onRetry={directory.retry} resourceName="需求复核队列" />
      ) : (
        <Card className="m03-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m03-toolbar">
            <div>
              <h2>待复核请求</h2>
              <p>顶部搜索支持老人、摘要与安全编号；每次提交均携带版本并由服务端再次鉴权。</p>
            </div>
            <Space size={10} wrap>
              <Select<NeedStatusFilter>
                aria-label="筛选需求状态"
                value={status}
                options={[{ value: 'all', label: '全部状态' }, ...needStatusOptions]}
                onChange={setStatus}
              />
              <Select<NeedCategoryFilter>
                aria-label="筛选需求类别"
                value={category}
                options={[{ value: 'all', label: '全部类别' }, ...needCategoryOptions]}
                onChange={setCategory}
              />
              <Select<NeedPriorityFilter>
                aria-label="筛选风险优先级"
                value={priority}
                options={[{ value: 'all', label: '全部风险' }, ...priorityOptions]}
                onChange={setPriority}
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
                    <span>老人、需求摘要与操作列固定显示，确保复核上下文始终完整。</span>
                  </div>
                }
              >
                <Button icon={<SettingOutlined />} aria-label="设置需求表格可见列">列设置</Button>
              </Popover>
            </Space>
          </div>
          {directory.stale ? <M03StaleAlert onRetry={directory.retry} /> : null}
          <Table<NeedAdminItem>
            className="m03-table"
            columns={displayedColumns}
            dataSource={directory.data?.items ?? []}
            loading={{ spinning: directory.loading, description: '正在读取需求复核队列' }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="当前搜索与筛选下没有需要显示的需求"
                />
              )
            }}
            pagination={{
              current: page,
              pageSize,
              total: directory.data?.pageInfo.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => `共 ${total} 条需求`
            }}
            rowKey="id"
            scroll={{ x: 1320 }}
            onChange={handleTableChange}
          />
        </Card>
      )}

      <Modal
        open={selected !== null}
        width={720}
        title={
          <span><SafetyCertificateOutlined aria-hidden="true" /> 人工复核需求</span>
        }
        confirmLoading={mutationPending}
        okText="确认需求"
        cancelText="暂不处理"
        okButtonProps={{
          icon: <CheckOutlined />,
          disabled: reviewSummary.trim().length === 0 || !confirmReasonSelected
        }}
        onOk={() => void submitReview('CONFIRM')}
        onCancel={() => {
          if (!mutationPending) setSelected(null);
        }}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space wrap>
            <CancelBtn />
            <Button
              aria-label="驳回需求"
              danger
              disabled={!rejectReasonSelected}
              icon={<StopOutlined />}
              loading={mutationPending}
              onClick={() => void submitReview('REJECT')}
            >
              驳回需求
            </Button>
            <OkBtn />
          </Space>
        )}
      >
        {selected === null ? null : (
          <div className="m03-review-form">
            <Alert
              type="info"
              showIcon
              title="AI 内容仅供复核参考"
              description="请根据请求来源、规则命中和实际照护上下文修正摘要、类别与优先级。"
            />
            {mutationFailure === null ? null : <Alert type="error" showIcon title={mutationFailure} />}
            <div className="m03-readonly-context">
              <Typography.Text type="secondary">请求来源</Typography.Text>
              <strong>{selected.source === 'VOICE' ? '老人语音请求（原始音频与完整转写不在此页展示）' : '人工录入'}</strong>
              <Typography.Text type="secondary">确定性规则</Typography.Text>
              <div>{ruleSummary(selected.safetyRuleCodes)}</div>
            </div>
            <label className="m03-field">
              <span>确认后的安全摘要</span>
              <Input.TextArea
                aria-label="确认后的安全摘要"
                value={reviewSummary}
                maxLength={1000}
                autoSize={{ minRows: 3, maxRows: 6 }}
                showCount
                onChange={(event) => setReviewSummary(event.target.value)}
              />
            </label>
            <div className="m03-form-grid">
              <label className="m03-field">
                <span>类别</span>
                <Select
                  aria-label="确认需求类别"
                  value={reviewCategory}
                  options={needCategoryOptions}
                  onChange={setReviewCategory}
                />
              </label>
              <label className="m03-field">
                <span>风险优先级</span>
                <Select
                  aria-label="确认风险优先级"
                  value={reviewPriority}
                  options={priorityOptions}
                  onChange={setReviewPriority}
                />
              </label>
            </div>
            <label className="m03-field">
              <span>审计原因</span>
              <Select
                aria-label="选择复核原因"
                aria-describedby="need-review-reason-help"
                value={reasonCode}
                options={[
                  { value: 'HUMAN_CONFIRMED', label: '人工确认 AI 草案' },
                  { value: 'HUMAN_CORRECTED', label: '人工修正 AI 草案' },
                  { value: 'FALSE_POSITIVE', label: '规则或草案误报' },
                  { value: 'OUT_OF_SCOPE', label: '不属于可执行照护需求' }
                ]}
                onChange={setReasonCode}
              />
              <Typography.Text id="need-review-reason-help" type="secondary">
                确认请选择人工确认/修正；驳回必须明确选择误报或超出范围。
              </Typography.Text>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
