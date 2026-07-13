'use client';

import {
  DisconnectOutlined,
  EyeOutlined,
  HomeOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  Alert,
  Breadcrumb,
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
  Tag
} from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { apiFetch } from '../lib/api-client';
import {
  ContractValidationError,
  parseAdminRoles,
  parseAdminUsers,
  type AdminRoleSummary,
  type AdminUserSummary,
  type DataScopeKind,
  type PaginatedResponse,
  type RoleSummary
} from '../lib/auth-contract';
import { useAdminShellSearch } from './admin-shell';

type AccessPageKind = 'users' | 'roles';
type FailureKind = 'error' | 'offline' | 'not-found' | null;
type UserSort = 'loginName' | 'displayName' | 'status' | 'lastLoginAt';
type RoleSort = 'code' | 'name' | 'assignedUserCount';
type SortDirection = 'asc' | 'desc';
type UserColumnKey = 'identity' | 'status' | 'roles' | 'facility' | 'scopes' | 'lastLoginAt';
type RoleColumnKey = 'identity' | 'type' | 'permissions' | 'scopes' | 'assignedUserCount';

interface AccessManagementPageProps {
  kind: AccessPageKind;
}

const emptyPageInfo = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 0
};

const emptyUsers: PaginatedResponse<AdminUserSummary> = {
  items: [],
  pageInfo: emptyPageInfo
};

const emptyRoles: PaginatedResponse<AdminRoleSummary> = {
  items: [],
  pageInfo: emptyPageInfo
};

const scopeLabels: Record<DataScopeKind, string> = {
  PLATFORM: '全平台',
  ORGANIZATION: '全机构',
  FACILITY: '当前院区',
  FLOOR: '楼层 / 区域',
  CARE_TEAM: '照护组',
  ASSIGNED_ELDER: '已分配老人',
  ACTIVE_SHIFT: '有效班次',
  LINKED_ELDER: '绑定老人',
  OWN_RECORD: '本人记录'
};

const userColumnOptions: Array<{ key: UserColumnKey; label: string; locked?: boolean }> = [
  { key: 'identity', label: '用户与账号', locked: true },
  { key: 'status', label: '状态' },
  { key: 'roles', label: '授权角色' },
  { key: 'facility', label: '院区范围' },
  { key: 'scopes', label: '数据范围' },
  { key: 'lastLoginAt', label: '最近登录' }
];

const roleColumnOptions: Array<{ key: RoleColumnKey; label: string; locked?: boolean }> = [
  { key: 'identity', label: '角色', locked: true },
  { key: 'type', label: '类型' },
  { key: 'permissions', label: '权限数' },
  { key: 'scopes', label: '适用数据范围' },
  { key: 'assignedUserCount', label: '已分配用户' }
];

function formatDate(value: string | null): string {
  if (value === null) {
    return '尚未登录';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function statusTag(status: AdminUserSummary['status']) {
  if (status === 'ACTIVE') {
    return <Tag color="success">正常</Tag>;
  }
  if (status === 'LOCKED') {
    return <Tag color="warning">已锁定</Tag>;
  }

  return <Tag>已停用</Tag>;
}

function uniqueRoles(user: AdminUserSummary): RoleSummary[] {
  const roles = new Map<string, RoleSummary>();
  for (const assignment of user.assignments) {
    roles.set(assignment.role.id, assignment.role);
  }
  return [...roles.values()];
}

function uniqueScopes(user: AdminUserSummary): DataScopeKind[] {
  return [...new Set(user.assignments.flatMap((assignment) => assignment.scopes.map((scope) => scope.kind)))];
}

function facilityScopeLabel(user: AdminUserSummary, currentFacilityName: string | null): string {
  const scopes = user.assignments.flatMap((assignment) => assignment.scopes);
  if (scopes.some((scope) => scope.facilityId !== null)) {
    return currentFacilityName ?? '当前院区';
  }

  return scopes.some((scope) => scope.kind === 'PLATFORM') ? '全平台范围' : '机构级范围';
}

function assertUsersStayWithinContext(
  page: PaginatedResponse<AdminUserSummary>,
  organizationId: string,
  facilityId: string
): void {
  const crossesBoundary = page.items.some((user) =>
    user.assignments.some(
      (assignment) =>
        assignment.organizationId !== organizationId ||
        assignment.scopes.some(
          (scope) =>
            scope.organizationId !== organizationId ||
            (scope.facilityId !== null && scope.facilityId !== facilityId)
        )
    )
  );

  if (crossesBoundary) {
    throw new ContractValidationError('admin users');
  }
}

function ScopeTags({ scopes, limit }: Readonly<{ scopes: DataScopeKind[]; limit?: number }>) {
  const visibleScopes = limit === undefined ? scopes : scopes.slice(0, limit);
  if (visibleScopes.length === 0) {
    return <span className="access-muted">无有效范围</span>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {visibleScopes.map((scope) => <Tag key={scope}>{scopeLabels[scope]}</Tag>)}
      {limit !== undefined && scopes.length > limit ? <Tag>+{scopes.length - limit}</Tag> : null}
    </Space>
  );
}

function UserDetail({ user, facilityName }: Readonly<{ user: AdminUserSummary; facilityName: string | null }>) {
  const roles = uniqueRoles(user);
  const scopes = uniqueScopes(user);

  return (
    <div className="access-drawer-content">
      <Alert
        showIcon
        type="info"
        title="只读访问详情"
        description="仅展示当前后端会话范围内的有效授权；页面不提供权限变更入口。"
      />
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="显示名">{user.displayName}</Descriptions.Item>
        <Descriptions.Item label="账号">{user.loginName}</Descriptions.Item>
        <Descriptions.Item label="状态">{statusTag(user.status)}</Descriptions.Item>
        <Descriptions.Item label="角色">
          <Space size={[4, 4]} wrap>
            {roles.length === 0
              ? <span className="access-muted">未分配有效角色</span>
              : roles.map((role) => <Tag color="blue" key={role.id}>{role.name}</Tag>)}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="院区范围">{facilityScopeLabel(user, facilityName)}</Descriptions.Item>
        <Descriptions.Item label="数据范围"><ScopeTags scopes={scopes} /></Descriptions.Item>
        <Descriptions.Item label="最近登录">{formatDate(user.lastLoginAt)}</Descriptions.Item>
        <Descriptions.Item label="访问版本">v{user.accessVersion}</Descriptions.Item>
      </Descriptions>
    </div>
  );
}

function RoleDetail({ role }: Readonly<{ role: AdminRoleSummary }>) {
  return (
    <div className="access-drawer-content">
      <Alert
        showIcon
        type="info"
        title="权限按后端策略执行"
        description="菜单仅用于导航提示；隐藏菜单不能替代 API 的组织、院区与资源范围校验。"
      />
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="角色名称">{role.name}</Descriptions.Item>
        <Descriptions.Item label="角色编码">{role.code}</Descriptions.Item>
        <Descriptions.Item label="类型">{role.isSystem ? '系统内置' : '机构自定义'}</Descriptions.Item>
        <Descriptions.Item label="说明">{role.description ?? '暂无说明'}</Descriptions.Item>
        <Descriptions.Item label="分配用户">{role.assignedUserCount} 人</Descriptions.Item>
        <Descriptions.Item label="数据范围"><ScopeTags scopes={role.scopeKinds} /></Descriptions.Item>
        <Descriptions.Item label="权限">
          <Space size={[4, 4]} wrap>
            {role.permissions.length === 0
              ? <span className="access-muted">未配置权限</span>
              : role.permissions.map((permission) => <Tag color="blue" key={permission}>{permission}</Tag>)}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

export function AccessManagementPage({ kind }: Readonly<AccessManagementPageProps>) {
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState('all');
  const [userSort, setUserSort] = useState<UserSort>('displayName');
  const [userSortDirection, setUserSortDirection] = useState<SortDirection>('asc');
  const [roleSort, setRoleSort] = useState<RoleSort>('name');
  const [roleSortDirection, setRoleSortDirection] = useState<SortDirection>('asc');
  const [visibleUserColumns, setVisibleUserColumns] = useState<UserColumnKey[]>(
    userColumnOptions.map(({ key }) => key)
  );
  const [visibleRoleColumns, setVisibleRoleColumns] = useState<RoleColumnKey[]>(
    roleColumnOptions.map(({ key }) => key)
  );
  const [users, setUsers] = useState<PaginatedResponse<AdminUserSummary> | null>(null);
  const [roles, setRoles] = useState<PaginatedResponse<AdminRoleSummary> | null>(null);
  const usersRef = useRef(users);
  const rolesRef = useRef(roles);
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminRoleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FailureKind>(null);
  const [stale, setStale] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const facilityId = session.activeContext.facilityId;
  const organizationId = session.activeContext.organizationId;

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    rolesRef.current = roles;
  }, [roles]);

  useEffect(() => {
    setPage(1);
    setSelectedUser(null);
    setSelectedRole(null);
  }, [
    deferredSearch,
    statusFilter,
    kind,
    userSort,
    userSortDirection,
    roleSort,
    roleSortDirection
  ]);

  useEffect(() => {
    if (facilityId === null) {
      setUsers(null);
      setRoles(null);
      setFailure(null);
      setStale(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (deferredSearch.length > 0) {
      params.set('search', deferredSearch);
    }
    if (kind === 'users') {
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      params.set('sort', userSort);
      params.set('direction', userSortDirection);
    } else {
      params.set('sort', roleSort);
      params.set('direction', roleSortDirection);
    }

    const clearCurrentData = () => {
      if (kind === 'users') {
        usersRef.current = null;
        setUsers(null);
        setSelectedUser(null);
      } else {
        rolesRef.current = null;
        setRoles(null);
        setSelectedRole(null);
      }
      setStale(false);
    };

    const load = async () => {
      setLoading(true);
      setFailure(null);
      try {
        const response = await apiFetch(
          `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}/${kind}?${params.toString()}`,
          { signal: controller.signal }
        );

        if (response.status === 401) {
          clearCurrentData();
          window.location.assign('/login?reason=expired');
          return;
        }
        if (response.status === 403) {
          clearCurrentData();
          window.location.assign('/forbidden');
          return;
        }
        if (response.status === 404) {
          clearCurrentData();
          setFailure('not-found');
          return;
        }
        if (!response.ok) {
          throw new Error('access list failed');
        }

        const payload: unknown = await response.json();
        if (kind === 'users') {
          const parsed = parseAdminUsers(payload);
          assertUsersStayWithinContext(parsed, organizationId, facilityId);
          usersRef.current = parsed;
          setUsers(parsed);
        } else {
          const parsed = parseAdminRoles(payload);
          rolesRef.current = parsed;
          setRoles(parsed);
        }
        setStale(false);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        const hasExistingData = kind === 'users' ? usersRef.current !== null : rolesRef.current !== null;
        if (hasExistingData) {
          setStale(true);
        } else {
          setFailure(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [
    deferredSearch,
    facilityId,
    kind,
    organizationId,
    page,
    pageSize,
    retryKey,
    roleSort,
    roleSortDirection,
    statusFilter,
    userSort,
    userSortDirection
  ]);

  const userColumns: TableColumnsType<AdminUserSummary> = [
    {
      title: '用户',
      key: 'identity',
      width: 230,
      sorter: true,
      sortOrder: userSort === 'displayName' ? (userSortDirection === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, user) => (
        <div className="access-identity-cell">
          <span className="access-avatar" aria-hidden="true"><UserOutlined /></span>
          <span><strong>{user.displayName}</strong><small>{user.loginName}</small></span>
        </div>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      sorter: true,
      sortOrder: userSort === 'status' ? (userSortDirection === 'asc' ? 'ascend' : 'descend') : null,
      render: statusTag
    },
    {
      title: '授权角色',
      key: 'roles',
      width: 220,
      render: (_, user) => {
        const roleValues = uniqueRoles(user);
        return roleValues.length === 0
          ? <span className="access-muted">未分配有效角色</span>
          : (
              <Space size={[4, 4]} wrap>
                {roleValues.map((role) => <Tag color="blue" key={role.id}>{role.name}</Tag>)}
              </Space>
            );
      }
    },
    {
      title: '院区范围',
      key: 'facility',
      width: 220,
      render: (_, user) => facilityScopeLabel(user, session.activeContext.facilityName)
    },
    {
      title: '数据范围',
      key: 'scopes',
      width: 210,
      render: (_, user) => <ScopeTags scopes={uniqueScopes(user)} limit={2} />
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 180,
      sorter: true,
      sortOrder: userSort === 'lastLoginAt' ? (userSortDirection === 'asc' ? 'ascend' : 'descend') : null,
      render: (lastLoginAt: string | null) => lastLoginAt === null
        ? '尚未登录'
        : <time dateTime={lastLoginAt}>{formatDate(lastLoginAt)}</time>
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, user) => (
        <Button icon={<EyeOutlined aria-hidden="true" />} onClick={() => setSelectedUser(user)}>查看详情</Button>
      )
    }
  ];

  const roleColumns: TableColumnsType<AdminRoleSummary> = [
    {
      title: '角色',
      key: 'identity',
      width: 270,
      sorter: true,
      sortOrder: roleSort === 'name' ? (roleSortDirection === 'asc' ? 'ascend' : 'descend') : null,
      render: (_, role) => (
        <div className="access-identity-cell">
          <span className="access-avatar" aria-hidden="true"><SafetyCertificateOutlined /></span>
          <span><strong>{role.name}</strong><small>{role.code}</small></span>
        </div>
      )
    },
    {
      title: '类型',
      dataIndex: 'isSystem',
      key: 'type',
      width: 130,
      render: (isSystem: boolean) => isSystem ? <Tag color="blue">系统内置</Tag> : <Tag>机构自定义</Tag>
    },
    {
      title: '权限',
      key: 'permissions',
      width: 150,
      render: (_, role) => `${role.permissions.length} 项权限`
    },
    {
      title: '适用数据范围',
      key: 'scopes',
      width: 300,
      render: (_, role) => <ScopeTags scopes={role.scopeKinds} limit={3} />
    },
    {
      title: '已分配用户',
      dataIndex: 'assignedUserCount',
      key: 'assignedUserCount',
      width: 150,
      sorter: true,
      sortOrder: roleSort === 'assignedUserCount'
        ? (roleSortDirection === 'asc' ? 'ascend' : 'descend')
        : null,
      render: (count: number) => `${count} 人`
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right',
      render: (_, role) => (
        <Button icon={<EyeOutlined aria-hidden="true" />} onClick={() => setSelectedRole(role)}>查看详情</Button>
      )
    }
  ];

  const visibleUserColumnSet = new Set(visibleUserColumns);
  const visibleRoleColumnSet = new Set(visibleRoleColumns);
  const displayedUserColumns = userColumns.filter((column) =>
    column.key === 'action' || visibleUserColumnSet.has(column.key as UserColumnKey)
  );
  const displayedRoleColumns = roleColumns.filter((column) =>
    column.key === 'action' || visibleRoleColumnSet.has(column.key as RoleColumnKey)
  );

  const pageData = kind === 'users' ? (users ?? emptyUsers) : (roles ?? emptyRoles);
  const title = kind === 'users' ? '用户与访问范围' : '角色与权限';
  const description = kind === 'users'
    ? '查看当前机构与院区内的账号、角色和数据范围。所有结果均由后端范围策略裁剪。'
    : '查看当前院区可用的角色、权限组合和适用范围。M01 采用只读方式。';
  const hasData = kind === 'users' ? users !== null : roles !== null;

  const retry = () => {
    setFailure(null);
    setRetryKey((value) => value + 1);
  };

  const updateUserColumnVisibility = (key: UserColumnKey, locked = false) => {
    if (locked) return;
    setVisibleUserColumns((current) =>
      current.includes(key) ? current.filter((column) => column !== key) : [...current, key]
    );
  };

  const updateRoleColumnVisibility = (key: RoleColumnKey, locked = false) => {
    if (locked) return;
    setVisibleRoleColumns((current) =>
      current.includes(key) ? current.filter((column) => column !== key) : [...current, key]
    );
  };

  const handleUserTableChange: TableProps<AdminUserSummary>['onChange'] = (pagination, _filters, sorter) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 10);

    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (activeSorter?.order === undefined) {
      setUserSort('displayName');
      setUserSortDirection('asc');
      return;
    }

    const nextSort: UserSort = activeSorter.columnKey === 'status'
      ? 'status'
      : activeSorter.columnKey === 'lastLoginAt'
        ? 'lastLoginAt'
        : 'displayName';
    setUserSort(nextSort);
    setUserSortDirection(activeSorter.order === 'descend' ? 'desc' : 'asc');
  };

  const handleRoleTableChange: TableProps<AdminRoleSummary>['onChange'] = (pagination, _filters, sorter) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 10);

    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (activeSorter?.order === undefined) {
      setRoleSort('name');
      setRoleSortDirection('asc');
      return;
    }

    setRoleSort(activeSorter.columnKey === 'assignedUserCount' ? 'assignedUserCount' : 'name');
    setRoleSortDirection(activeSorter.order === 'descend' ? 'desc' : 'asc');
  };

  return (
    <div className="access-page">
      <Breadcrumb
        className="page-breadcrumb"
        items={[
          { title: <Link href="/"><HomeOutlined aria-label="首页" /></Link> },
          { title: '人员权限' },
          { title }
        ]}
      />

      <div className="page-heading-row access-page-heading">
        <div>
          <div className="heading-title-line">
            <h1>{title}</h1>
            <Tag color="blue">只读 MVP</Tag>
          </div>
          <p>{description}</p>
        </div>
        <div className="access-context-summary" role="status" aria-label="当前访问范围">
          <LockOutlined aria-hidden="true" />
          <span><strong>{session.activeContext.organizationName}</strong>{session.activeContext.facilityName ?? '机构级范围'}</span>
        </div>
      </div>

      <nav className="access-tabs" aria-label="人员权限页面">
        <Link aria-current={kind === 'users' ? 'page' : undefined} className={kind === 'users' ? 'is-active' : ''} href="/users">
          <TeamOutlined aria-hidden="true" />用户管理
        </Link>
        <Link aria-current={kind === 'roles' ? 'page' : undefined} className={kind === 'roles' ? 'is-active' : ''} href="/roles">
          <SafetyCertificateOutlined aria-hidden="true" />角色权限
        </Link>
      </nav>

      {facilityId === null ? (
        <Card className="access-card">
          <Result
            status="warning"
            title="请先选择院区"
            subTitle="用户和角色列表按院区隔离。请选择一个已授权院区后继续。"
          />
        </Card>
      ) : failure !== null && !hasData ? (
        <Card className="access-card">
          <Result
            status={failure === 'not-found' ? '404' : 'error'}
            icon={failure === 'offline' ? <DisconnectOutlined /> : undefined}
            title={
              failure === 'offline'
                ? '当前网络不可用'
                : failure === 'not-found'
                  ? '页面不存在或不可访问'
                  : '无法读取访问列表'
            }
            subTitle={
              failure === 'not-found'
                ? '系统不会透露其他机构或院区是否存在对应资源。'
                : '未显示任何缓存用户或角色数据，请恢复连接后重试。'
            }
            extra={<Button onClick={retry}>重新加载</Button>}
          />
        </Card>
      ) : (
        <Card className="access-card" styles={{ body: { padding: 0 } }}>
          <div className="access-toolbar">
            <div>
              <h2>{kind === 'users' ? '授权用户' : '角色目录'}</h2>
              <p>顶部搜索与筛选始终限制在当前后端会话的机构和院区范围内。</p>
            </div>
            <Space size={12} wrap>
              {kind === 'users' ? (
                <Select
                  aria-label="筛选用户状态"
                  value={statusFilter}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'ACTIVE', label: '正常' },
                    { value: 'LOCKED', label: '已锁定' },
                    { value: 'DISABLED', label: '已停用' }
                  ]}
                  onChange={setStatusFilter}
                />
              ) : null}
              <Popover
                placement="bottomRight"
                trigger="click"
                title="显示列"
                content={
                  <div className="column-visibility-controls">
                    {(kind === 'users' ? userColumnOptions : roleColumnOptions).map((option) => (
                      <Checkbox
                        key={option.key}
                        checked={kind === 'users'
                          ? visibleUserColumnSet.has(option.key as UserColumnKey)
                          : visibleRoleColumnSet.has(option.key as RoleColumnKey)}
                        disabled={option.locked}
                        onChange={() => {
                          if (kind === 'users') {
                            updateUserColumnVisibility(option.key as UserColumnKey, option.locked);
                          } else {
                            updateRoleColumnVisibility(option.key as RoleColumnKey, option.locked);
                          }
                        }}
                      >
                        {option.label}
                      </Checkbox>
                    ))}
                    <span>身份与操作列固定显示，避免失去关键上下文。</span>
                  </div>
                }
              >
                <Button icon={<SettingOutlined aria-hidden="true" />} aria-label="设置表格可见列">列设置</Button>
              </Popover>
            </Space>
          </div>

          {stale ? (
            <Alert
              banner
              showIcon
              type="warning"
              title="刷新失败，以下为本次会话内最后成功读取的结果，请勿视为最新授权状态。"
              action={<Button size="small" onClick={retry}>重新同步</Button>}
            />
          ) : null}

          {kind === 'users' ? (
            <Table<AdminUserSummary>
              className="access-table"
              columns={displayedUserColumns}
              dataSource={users?.items ?? []}
              loading={{ spinning: loading, description: '正在读取授权用户' }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有用户" /> }}
              pagination={{
                current: page,
                pageSize,
                total: pageData.pageInfo.total,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 名用户`
              }}
              rowKey="id"
              scroll={{ x: 1220 }}
              onChange={handleUserTableChange}
            />
          ) : (
            <Table<AdminRoleSummary>
              className="access-table"
              columns={displayedRoleColumns}
              dataSource={roles?.items ?? []}
              loading={{ spinning: loading, description: '正在读取角色权限' }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有角色" /> }}
              pagination={{
                current: page,
                pageSize,
                total: pageData.pageInfo.total,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 个角色`
              }}
              rowKey="id"
              scroll={{ x: 1050 }}
              onChange={handleRoleTableChange}
            />
          )}
        </Card>
      )}

      <Drawer
        destroyOnHidden
        open={selectedUser !== null}
        title={selectedUser === null ? '用户详情' : `${selectedUser.displayName} · 访问详情`}
        size={520}
        onClose={() => setSelectedUser(null)}
      >
        {selectedUser ? <UserDetail user={selectedUser} facilityName={session.activeContext.facilityName} /> : null}
      </Drawer>
      <Drawer
        destroyOnHidden
        open={selectedRole !== null}
        title={selectedRole === null ? '角色详情' : `${selectedRole.name} · 权限详情`}
        size={520}
        onClose={() => setSelectedRole(null)}
      >
        {selectedRole ? <RoleDetail role={selectedRole} /> : null}
      </Drawer>
    </div>
  );
}
