'use client';

import {
  AlertOutlined,
  ApartmentOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DisconnectOutlined,
  DownOutlined,
  EnvironmentOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MedicineBoxOutlined,
  NotificationOutlined,
  ProfileOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  WarningFilled,
  WifiOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Badge,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Popover,
  Progress,
  Result,
  Select,
  Space,
  Table,
  Tag,
  Tooltip
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ResponseTrendChart } from './response-trend-chart';

type QueueKey = 'all' | 'emergency' | 'review' | 'overdue' | 'offline';
type QueueTone = Exclude<QueueKey, 'all'>;
type DemoState = 'ready' | 'loading' | 'empty' | 'error' | 'offline' | 'forbidden' | 'stale';
type QueueColumnKey = 'priority' | 'count' | 'latest' | 'time';

interface QueueFixture {
  key: QueueTone;
  priorityRank: number;
  timestampRank: number;
  title: string;
  description: string;
  count: number;
  countUnit: string;
  delta: string;
  latest: string;
  location: string;
  status: string;
  time: string;
  age: string;
  icon: ReactNode;
}

interface NavigationFixture {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  enabled?: boolean;
  milestone?: string;
  badge?: number;
}

const navigationItems: NavigationFixture[] = [
  { key: 'home', label: '工作台', icon: <HomeOutlined />, enabled: true },
  { key: 'risk', label: '风险待办', icon: <AlertOutlined />, active: true, enabled: true, badge: 4 },
  { key: 'orders', label: '工单管理', icon: <ProfileOutlined />, milestone: 'M03' },
  { key: 'residents', label: '入住管理', icon: <ApartmentOutlined />, milestone: 'M02' },
  { key: 'care', label: '照护计划', icon: <MedicineBoxOutlined />, milestone: 'M02' },
  { key: 'devices', label: '设备管理', icon: <LaptopOutlined />, milestone: 'M05' },
  { key: 'reports', label: '报表中心', icon: <BarChartOutlined />, milestone: 'M09' },
  { key: 'agents', label: '智能体审批', icon: <FileDoneOutlined />, milestone: 'M15' },
  { key: 'settings', label: '系统设置', icon: <SettingOutlined />, milestone: 'M01' }
];

const queueFixtures: QueueFixture[] = [
  {
    key: 'emergency',
    priorityRank: 1,
    timestampRank: 1058,
    title: '未确认紧急事件',
    description: '疑似紧急或突发事件，尚未由值班人员确认处置。',
    count: 8,
    countUnit: '项待处理',
    delta: '较昨日 +2',
    latest: '房间 B204 · 呼叫异常',
    location: '护理 B 区 · 2 楼',
    status: '呼叫异常',
    time: '今天 10:58',
    age: '发生于 11 分钟前',
    icon: <WarningFilled />
  },
  {
    key: 'review',
    priorityRank: 2,
    timestampRank: 941,
    title: '待人工复核',
    description: 'AI 已生成处置建议，等待人工复核并确认。',
    count: 15,
    countUnit: '项待复核',
    delta: '较昨日 +5',
    latest: '夜间照护记录异常提醒',
    location: '护理 A 区 · 1 楼',
    status: 'AI 生成建议',
    time: '今天 09:41',
    age: '生成于 1 小时 43 分钟前',
    icon: <FileSearchOutlined />
  },
  {
    key: 'overdue',
    priorityRank: 3,
    timestampRank: 906,
    title: '超时工单',
    description: '已超过服务承诺时间的工单，存在延误风险。',
    count: 12,
    countUnit: '项超时',
    delta: '较昨日 +3',
    latest: '空调不制冷 · 1 楼走廊',
    location: '设施维修 · 环境设备',
    status: '已超时 2 小时 18 分',
    time: '今天 09:06',
    age: '超时于 2 小时 18 分钟前',
    icon: <ClockCircleOutlined />
  },
  {
    key: 'offline',
    priorityRank: 4,
    timestampRank: 832,
    title: '关键设备离线',
    description: '关键物联设备离线，可能影响照护与安全监测。',
    count: 6,
    countUnit: '台离线',
    delta: '较昨日 +1',
    latest: '生命体征监测仪 #A-12',
    location: '护理 B 区 · 2 楼',
    status: '离线',
    time: '今天 08:32',
    age: '最近心跳在 2 小时 52 分钟前',
    icon: <WifiOutlined />
  }
];

const queueLabels: Record<QueueKey, string> = {
  all: '全部风险队列',
  emergency: '未确认紧急事件',
  review: '待人工复核',
  overdue: '超时工单',
  offline: '关键设备离线'
};

const stateLabels: Record<DemoState, string> = {
  ready: '正常数据',
  loading: '加载中',
  empty: '空状态',
  error: '错误状态',
  offline: '离线状态',
  forbidden: '无权限',
  stale: '数据已过期'
};

const stateOptions = (Object.keys(stateLabels) as DemoState[]).map((key) => ({
  value: key,
  label: stateLabels[key]
}));

const columnVisibilityOptions: Array<{ key: QueueColumnKey; label: string; locked?: boolean }> = [
  { key: 'priority', label: '优先级与说明', locked: true },
  { key: 'count', label: '队列概览' },
  { key: 'latest', label: '最新项目' },
  { key: 'time', label: '最近发生 / 截止' }
];

function toneClassName(tone: QueueTone) {
  return `tone-${tone}`;
}

function StateSurface({ state, onReset }: Readonly<{ state: DemoState; onReset: () => void }>) {
  if (state === 'empty') {
    return (
      <Card className="state-card state-card-centered">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div>
              <strong>当前没有未处理风险</strong>
              <span>筛选范围内没有需要立即处理的演示事项。</span>
            </div>
          }
        >
          <Button onClick={onReset}>返回演示数据</Button>
        </Empty>
      </Card>
    );
  }

  if (state === 'error') {
    return (
      <Card className="state-card state-card-centered">
        <Result
          status="error"
          title="工作台加载失败"
          subTitle="演示错误：聚合服务暂时不可用，未显示任何真实业务数据。"
          extra={<Button onClick={onReset} icon={<ReloadOutlined />}>重新加载</Button>}
        />
      </Card>
    );
  }

  if (state === 'offline') {
    return (
      <Card className="state-card state-card-centered">
        <Result
          icon={<DisconnectOutlined className="state-result-icon" />}
          title="当前处于离线模式"
          subTitle="无法取得最新队列。请检查网络；恢复连接前不会把缓存内容标记为实时数据。"
          extra={<Button onClick={onReset} icon={<ReloadOutlined />}>模拟恢复连接</Button>}
        />
      </Card>
    );
  }

  if (state === 'forbidden') {
    return (
      <Card className="state-card state-card-centered">
        <Result
          status="403"
          title="无权查看此工作台"
          subTitle="当前演示角色没有所选院区的风险队列权限。请联系机构管理员。"
          extra={<Button onClick={onReset}>返回演示角色</Button>}
        />
      </Card>
    );
  }

  return null;
}

export function AdminDashboard() {
  const { message } = AntApp.useApp();
  const queueSectionRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [facility, setFacility] = useState('qinglan');
  const [queueFilter, setQueueFilter] = useState<QueueKey>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [demoState, setDemoState] = useState<DemoState>('ready');
  const [queueVisible, setQueueVisible] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(4);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<QueueColumnKey[]>([
    'priority',
    'count',
    'latest',
    'time'
  ]);

  useEffect(() => {
    setPage(1);
  }, [queueFilter, searchTerm]);

  const visibleQueues = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('zh-CN');

    return queueFixtures.filter((item) => {
      const matchesQueue = queueFilter === 'all' || item.key === queueFilter;
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [item.title, item.latest, item.location, item.status]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedSearch);

      return matchesQueue && matchesSearch;
    });
  }, [queueFilter, searchTerm]);

  const columns: TableColumnsType<QueueFixture> = [
    {
      title: '优先级与说明',
      key: 'priority',
      width: 330,
      sorter: (first, second) => first.priorityRank - second.priorityRank,
      sortDirections: ['ascend', 'descend'],
      render: (_, record) => (
        <div className={`queue-priority ${toneClassName(record.key)}`}>
          <div className="queue-icon" aria-hidden="true">{record.icon}</div>
          <div>
            <strong>{record.title}</strong>
            <p>{record.description}</p>
          </div>
        </div>
      )
    },
    {
      title: '队列概览',
      key: 'count',
      width: 160,
      sorter: (first, second) => first.count - second.count,
      sortDirections: ['descend', 'ascend'],
      render: (_, record) => (
        <div className={`queue-count ${toneClassName(record.key)}`}>
          <div><strong>{record.count}</strong><span>{record.countUnit}</span></div>
          <small>{record.delta}</small>
        </div>
      )
    },
    {
      title: '最新项目（演示）',
      key: 'latest',
      width: 270,
      sorter: (first, second) => first.latest.localeCompare(second.latest, 'zh-CN'),
      render: (_, record) => (
        <div className="queue-latest">
          <strong>{record.latest}</strong>
          <div>
            <EnvironmentOutlined aria-hidden="true" />
            <span>{record.location}</span>
            <Tag className={`queue-status-tag ${toneClassName(record.key)}`}>{record.status}</Tag>
          </div>
        </div>
      )
    },
    {
      title: '最近发生 / 截止',
      key: 'time',
      width: 205,
      sorter: (first, second) => first.timestampRank - second.timestampRank,
      sortDirections: ['descend', 'ascend'],
      render: (_, record) => (
        <div className={`queue-time ${toneClassName(record.key)}`}>
          <strong><ClockCircleOutlined aria-hidden="true" />{record.time}</strong>
          <span>{record.age}</span>
        </div>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type={record.key === 'emergency' ? 'primary' : 'default'}
          danger={record.key === 'emergency'}
          className={record.key === 'overdue' ? 'overdue-action' : undefined}
          onClick={() => {
            setQueueFilter(record.key);
            setPage(1);
            queueSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            void message.success(`已切换到“${record.title}”演示队列`);
          }}
        >
          查看队列
        </Button>
      )
    }
  ];

  const visibleColumnSet = new Set<QueueColumnKey>(visibleColumnKeys);
  const displayedColumns = columns.filter((column) => {
    const key = column.key;

    return key === 'action' || (typeof key === 'string' && visibleColumnSet.has(key as QueueColumnKey));
  });

  const notificationMenu: MenuProps = {
    items: [
      { key: 'one', label: '8 项紧急事件待确认' },
      { key: 'two', label: '6 台关键设备处于离线状态' }
    ],
    onClick: ({ key }) => {
      const nextFilter: QueueKey = key === 'one' ? 'emergency' : 'offline';
      setQueueFilter(nextFilter);
      setPage(1);
      void message.info(`已定位到“${queueLabels[nextFilter]}”`);
    }
  };

  const profileMenu: MenuProps = {
    items: [
      { key: 'role', label: '当前角色：护理主管', disabled: true },
      { type: 'divider' },
      { key: 'permissions', label: '查看演示权限说明' }
    ],
    onClick: ({ key }) => {
      if (key === 'permissions') {
        setDemoState('forbidden');
        void message.info('已打开 M00 权限状态演示');
      }
    }
  };

  const resetDemoState = () => setDemoState('ready');
  const isBlockingState = ['empty', 'error', 'offline', 'forbidden'].includes(demoState);
  const maxPage = Math.max(1, Math.ceil(visibleQueues.length / pageSize));
  const safePage = Math.min(page, maxPage);

  return (
    <div className={`admin-shell ${collapsed ? 'admin-shell-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar-brand">
          <SafetyCertificateOutlined aria-hidden="true" />
          {!collapsed && <span>照护<br />运营台</span>}
        </div>

        <nav className="sidebar-nav">
          {navigationItems.map((item) => (
            <Tooltip
              key={item.key}
              placement="right"
              title={collapsed ? `${item.label}${item.milestone ? ` · ${item.milestone}` : ''}` : undefined}
            >
              <button
                type="button"
                className={`nav-item ${item.active ? 'nav-item-active' : ''}`}
                aria-current={item.active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                disabled={!item.enabled && !item.active}
                onClick={() => {
                  if (item.key === 'home') {
                    setQueueFilter('all');
                    setSearchTerm('');
                    setPage(1);
                    resetDemoState();
                    void message.success('已返回风险优先工作台');
                  }
                }}
              >
                <Badge count={item.badge} size="small" offset={[5, 0]}>
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                </Badge>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {!collapsed && item.milestone && <span className="nav-milestone">{item.milestone}</span>}
              </button>
            </Tooltip>
          ))}
        </nav>

        <button
          type="button"
          className="sidebar-collapse"
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          {!collapsed && <span>折叠导航</span>}
        </button>
      </aside>

      <header className="topbar">
        <div className="topbar-title">
          <strong>照护运营台</strong>
          <Select
            aria-label="切换演示院区"
            className="facility-select"
            value={facility}
            options={[
              { value: 'qinglan', label: '青岚院区 · 演示' },
              { value: 'haitang', label: '海棠院区 · 演示' }
            ]}
            onChange={(value: string) => {
              setFacility(value);
              void message.info('已切换演示院区；风险数字仍为固定 fixture');
            }}
          />
        </div>

        <Input.Search
          className="global-search"
          aria-label="全局搜索演示队列"
          placeholder="搜索队列、房间或设备"
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onSearch={(value) => {
            setSearchTerm(value);
            void message.info(value ? `正在筛选演示数据：“${value}”` : '已清除搜索条件');
          }}
        />

        <div className="topbar-actions">
          <Badge status="default" text="本地演示数据" className="fixture-badge" />
          <span className="topbar-divider" aria-hidden="true" />
          <span className="date-display"><CalendarOutlined aria-hidden="true" />7月11日 周六&nbsp; 11:24</span>
          <span className="topbar-divider" aria-hidden="true" />
          <Dropdown menu={notificationMenu} trigger={['click']} placement="bottomRight">
            <Tooltip title="通知">
              <Button
                type="text"
                shape="circle"
                className="topbar-icon-button"
                aria-label="查看通知"
                icon={<Badge dot><BellOutlined /></Badge>}
              />
            </Tooltip>
          </Dropdown>
          <Dropdown menu={profileMenu} trigger={['click']} placement="bottomRight">
            <Button type="text" className="profile-button" aria-label="打开个人菜单">
              <UserOutlined aria-hidden="true" />
              <span>护理主管 · 白班</span>
              <DownOutlined aria-hidden="true" />
            </Button>
          </Dropdown>
        </div>
      </header>

      <main className="dashboard-main">
        <Breadcrumb
          className="page-breadcrumb"
          items={[
            { title: <HomeOutlined aria-label="首页" /> },
            { title: '风险与待办' }
          ]}
        />

        <div className="page-heading-row">
          <div>
            <div className="heading-title-line">
              <h1>风险与待办</h1>
              <Tag color="blue">演示数据</Tag>
            </div>
            <p>聚焦高风险与延误事项，按优先级采取行动，降低运营与照护风险。</p>
          </div>
          <Space size={12} wrap>
            <Select
              aria-label="演示页面状态"
              className="state-select"
              value={demoState}
              options={stateOptions}
              onChange={(value: DemoState) => {
                setDemoState(value);
                void message.info(`已切换到“${stateLabels[value]}”演示`);
              }}
              suffixIcon={<DatabaseOutlined aria-hidden="true" />}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                resetDemoState();
                setQueueFilter('all');
                setSearchTerm('');
                setPage(1);
                void message.success('演示工作台已刷新');
              }}
            >
              刷新
            </Button>
          </Space>
        </div>

        {demoState === 'stale' && (
          <div className="stale-banner" role="status">
            <ClockCircleOutlined aria-hidden="true" />
            <div>
              <strong>数据已过期</strong>
              <span>最后成功同步于今天 10:42。以下内容仅供演示，不应视为实时状态。</span>
            </div>
            <Button size="small" onClick={resetDemoState}>恢复实时演示</Button>
          </div>
        )}

        {isBlockingState ? (
          <StateSurface state={demoState} onReset={resetDemoState} />
        ) : (
          <>
            <section className="queue-section" aria-labelledby="queue-title" ref={queueSectionRef}>
              <Card className="queue-card" styles={{ body: { padding: 0 } }}>
                <div className="queue-toolbar">
                  <div>
                    <div className="queue-title-line">
                      <h2 id="queue-title">优先处理队列</h2>
                      <Tag>{visibleQueues.length} 类队列</Tag>
                    </div>
                    <p>全部内容均为固定本地 fixture，不连接真实业务系统。</p>
                  </div>
                  <Space size={12} wrap>
                    <Popover
                      placement="bottomRight"
                      trigger="click"
                      title="显示列"
                      content={
                        <div className="column-visibility-controls">
                          {columnVisibilityOptions.map((option) => (
                            <Checkbox
                              key={option.key}
                              checked={visibleColumnSet.has(option.key)}
                              disabled={option.locked}
                              onChange={() => {
                                if (option.locked) {
                                  return;
                                }

                                setVisibleColumnKeys((current) =>
                                  current.includes(option.key)
                                    ? current.filter((key) => key !== option.key)
                                    : [...current, option.key]
                                );
                              }}
                            >
                              {option.label}
                            </Checkbox>
                          ))}
                          <span>操作列固定显示，避免失去队列入口。</span>
                        </div>
                      }
                    >
                      <Button icon={<SettingOutlined />} aria-label="设置表格可见列">
                        列设置
                      </Button>
                    </Popover>
                    <Select
                      aria-label="筛选风险队列"
                      value={queueFilter}
                      className="queue-filter-select"
                      options={(Object.keys(queueLabels) as QueueKey[]).map((key) => ({
                        value: key,
                        label: queueLabels[key]
                      }))}
                      onChange={(value: QueueKey) => {
                        setQueueFilter(value);
                        setPage(1);
                      }}
                    />
                    <Select
                      aria-label="每页显示队列数"
                      value={pageSize}
                      className="page-size-select"
                      options={[
                        { value: 2, label: '2 条/页' },
                        { value: 4, label: '4 条/页' }
                      ]}
                      onChange={(value: number) => {
                        setPageSize(value);
                        setPage(1);
                      }}
                    />
                    <Button
                      type="text"
                      icon={queueVisible ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                      aria-expanded={queueVisible}
                      onClick={() => setQueueVisible((value) => !value)}
                    >
                      {queueVisible ? '收起队列' : '展开队列'}
                    </Button>
                  </Space>
                </div>

                {queueVisible && (
                  <Table<QueueFixture>
                    className="risk-table"
                    columns={displayedColumns}
                    dataSource={visibleQueues}
                    loading={{
                      spinning: demoState === 'loading',
                      description: '正在加载演示队列'
                    }}
                    pagination={{
                      current: safePage,
                      pageSize,
                      showSizeChanger: false,
                      showLessItems: true,
                      showTotal: (total, range) => `${range[0]}–${range[1]} / ${total} 项演示队列`
                    }}
                    rowKey="key"
                    scroll={{ x: 1095 }}
                    onChange={(pagination) => {
                      setPage(pagination.current ?? 1);
                      setPageSize(pagination.pageSize ?? 4);
                    }}
                    locale={{
                      emptyText: (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="没有匹配的演示队列，请清除搜索或筛选条件。"
                        />
                      )
                    }}
                  />
                )}
              </Card>
            </section>

            <section className="metrics-section" aria-labelledby="metrics-title">
              <Card className="metrics-card" styles={{ body: { padding: 0 } }}>
                <h2 id="metrics-title" className="sr-only">今日运营指标与响应趋势</h2>
                <div className="metric-block">
                  <div className="metric-label">今日风险处置率<Tooltip title="已处置风险数除以今日风险总数"><InfoCircleOutlined /></Tooltip></div>
                  <div className="metric-value-line"><SafetyCertificateOutlined /><strong>92%</strong></div>
                  <Progress aria-label="今日风险处置率 92%" percent={92} showInfo={false} strokeColor="#0b6b78" railColor="#e8edf1" />
                  <p>已处置 <strong>23 / 25</strong> 项</p>
                </div>
                <div className="metric-block">
                  <div className="metric-label">工单按时完成率<Tooltip title="按承诺时间完成的演示工单占比"><InfoCircleOutlined /></Tooltip></div>
                  <div className="metric-value-line"><CheckCircleOutlined /><strong>86%</strong></div>
                  <Progress aria-label="工单按时完成率 86%" percent={86} showInfo={false} strokeColor="#14827a" railColor="#e8edf1" />
                  <p>按时 <strong>37 / 43</strong> 单</p>
                </div>
                <div className="metric-block">
                  <div className="metric-label">未读系统提醒<Tooltip title="尚未由当前演示角色查看的提醒"><InfoCircleOutlined /></Tooltip></div>
                  <div className="metric-value-line"><NotificationOutlined /><strong>14</strong><span>条</span></div>
                  <Progress aria-label="未读系统提醒 14 条" percent={70} showInfo={false} strokeColor="#3478b8" railColor="#e8edf1" />
                  <p>较昨日 <strong className="positive-delta">-3</strong> 条</p>
                </div>
                <div className="trend-block">
                  <div className="trend-heading">
                    <div>
                      <span>本周平均响应时长</span>
                      <small>从触发到首次响应 · 固定 fixture</small>
                    </div>
                    <Tag variant="filled">单位：分钟</Tag>
                  </div>
                  <ResponseTrendChart />
                </div>
              </Card>
            </section>

            <div className="foundation-note" role="note">
              <CloudServerOutlined aria-hidden="true" />
              <span><strong>M00 边界：</strong>当前页面只展示可交互的管理端基础壳和虚构 fixture；真实队列、权限与业务状态将在对应里程碑接入。</span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
