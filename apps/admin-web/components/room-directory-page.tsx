'use client';

import {
  ApartmentOutlined,
  CheckCircleOutlined,
  HomeOutlined,
  PlusOutlined,
  StopOutlined,
  TeamOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Pagination,
  Progress,
  Select,
  Space,
  Tag,
  Tooltip
} from 'antd';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import {
  parseBedsPage,
  parseBuildingsPage,
  parseFloorsPage,
  parseRoomsPage,
  type Bed,
  type Building,
  type Floor,
  type Room,
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

type DirectoryStatusFilter = 'all' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type OccupancyFilter = 'ANY' | 'AVAILABLE' | 'OCCUPIED' | 'FULL';

function roomStatusTag(status: Room['status']) {
  if (status === 'ACTIVE') return <Tag color="success">开放</Tag>;
  if (status === 'INACTIVE') return <Tag color="warning">暂停使用</Tag>;
  return <Tag>已归档</Tag>;
}

function RoomCard({
  beds,
  buildingName,
  floorName,
  room
}: Readonly<{
  beds: Bed[] | null;
  buildingName: string;
  floorName: string;
  room: Room;
}>) {
  const unavailableBedCount = room.bedCount - room.activeBedCount;
  const full = room.status === 'ACTIVE' && room.activeBedCount > 0 && room.availableBedCount === 0;
  const percent = room.activeBedCount === 0
    ? 0
    : Math.round((room.occupiedBedCount / room.activeBedCount) * 100);

  return (
    <article className="room-directory-card" aria-labelledby={`room-${room.id}`}>
      <div className="room-card-heading">
        <span className="room-card-icon" aria-hidden="true"><HomeOutlined /></span>
        <div>
          <p>{buildingName} · {floorName}</p>
          <h2 id={`room-${room.id}`}>{room.name}</h2>
          <span>{room.code}</span>
        </div>
        {roomStatusTag(room.status)}
      </div>

      <div className="room-capacity-line">
        <span>可运营床位占用</span>
        <strong>{room.occupiedBedCount} / {room.activeBedCount}</strong>
      </div>
      <Progress
        aria-label={`${room.name}床位占用率 ${percent}%`}
        percent={percent}
        showInfo={false}
        status={full ? 'exception' : 'normal'}
        strokeColor={full ? '#b76a00' : '#0b6b78'}
      />

      <div className="room-bed-status-grid" aria-label={`${room.name}床位聚合状态`}>
        <div className="room-bed-status room-bed-status-available">
          <CheckCircleOutlined aria-hidden="true" />
          <span><strong>{room.availableBedCount} 个可用床位</strong><small>可安排入住前仍需后端占用校验</small></span>
        </div>
        <div className="room-bed-status room-bed-status-occupied">
          <TeamOutlined aria-hidden="true" />
          <span><strong>{room.occupiedBedCount} 个已占用床位</strong><small>房间卡片不展示老人身份</small></span>
        </div>
        {room.status !== 'ACTIVE' || unavailableBedCount > 0 ? (
          <div className="room-bed-status room-bed-status-unavailable">
            <StopOutlined aria-hidden="true" />
            <span>
              <strong>{room.status !== 'ACTIVE' ? '房间当前未开放' : `${unavailableBedCount} 个床位停用或归档`}</strong>
              <small>共 {room.bedCount} 个物理床位，停用容量不计入可用床位</small>
            </span>
          </div>
        ) : null}
      </div>

      <div className="room-bed-detail-list" aria-label={`${room.name}床位明细`}>
        <div className="room-bed-detail-heading">
          <strong>床位明细</strong>
          <span>仅显示运营状态，不显示入住人身份</span>
        </div>
        {beds === null ? (
          <p className="room-bed-detail-note">床位明细暂不可用，聚合容量仍可参考。</p>
        ) : beds.length === 0 ? (
          <p className="room-bed-detail-note">当前结果中没有床位明细。</p>
        ) : (
          beds.map((bed) => {
            const occupied = bed.occupancy !== null;
            const available = bed.operationalStatus === 'ACTIVE' && !occupied;
            const label = occupied
              ? '已占用'
              : available
                ? '可用'
                : bed.operationalStatus === 'OUT_OF_SERVICE'
                  ? '停用'
                  : '已归档';
            return (
              <div
                className={`room-bed-detail-row is-${occupied ? 'occupied' : available ? 'available' : 'unavailable'}`}
                key={bed.id}
              >
                {occupied ? <TeamOutlined aria-hidden="true" /> : available ? <CheckCircleOutlined aria-hidden="true" /> : <StopOutlined aria-hidden="true" />}
                <span><strong>{bed.label}</strong><small>{bed.code}</small></span>
                <Tag color={occupied ? 'blue' : available ? 'success' : 'warning'}>{label}</Tag>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}

export function RoomDirectoryPage() {
  const { searchTerm, session } = useAdminShellSearch();
  const deferredSearch = useDeferredValue(searchTerm.trim());
  const organizationId = session.activeContext.organizationId;
  const facilityId = session.activeContext.facilityId;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [statusFilter, setStatusFilter] = useState<DirectoryStatusFilter>('all');
  const [occupancyFilter, setOccupancyFilter] = useState<OccupancyFilter>('ANY');
  const [buildingId, setBuildingId] = useState('all');
  const [floorId, setFloorId] = useState('all');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initialStatus = query.get('status');
    const initialOccupancy = query.get('occupancy');
    if (initialStatus === 'ACTIVE' || initialStatus === 'INACTIVE' || initialStatus === 'ARCHIVED') {
      setStatusFilter(initialStatus);
    }
    if (
      initialOccupancy === 'ANY' ||
      initialOccupancy === 'AVAILABLE' ||
      initialOccupancy === 'OCCUPIED' ||
      initialOccupancy === 'FULL'
    ) {
      setOccupancyFilter(initialOccupancy);
    }
  }, []);

  useEffect(() => setPage(1), [deferredSearch, statusFilter, occupancyFilter, buildingId, floorId]);
  useEffect(() => setFloorId('all'), [buildingId]);

  const prefix = facilityId === null
    ? ''
    : `/admin/organizations/${encodeURIComponent(organizationId)}/facilities/${encodeURIComponent(facilityId)}`;

  const parseBuildings = useCallback(
    (value: unknown): ScopedPage<Building> =>
      parseBuildingsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const buildings = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseBuildings,
    url: `${prefix}/directory/buildings?page=1&pageSize=100&sort=sortOrder&direction=asc`
  });

  const floorParams = useMemo(() => {
    const next = new URLSearchParams({ page: '1', pageSize: '100', sort: 'sortOrder', direction: 'asc' });
    if (buildingId !== 'all') next.set('buildingId', buildingId);
    return next;
  }, [buildingId]);
  const parseFloors = useCallback(
    (value: unknown): ScopedPage<Floor> => parseFloorsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const floors = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseFloors,
    url: `${prefix}/directory/floors?${floorParams.toString()}`
  });

  const roomParams = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      occupancy: occupancyFilter,
      sort: 'occupiedBedCount',
      direction: 'asc'
    });
    if (deferredSearch.length > 0) next.set('search', deferredSearch);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (buildingId !== 'all') next.set('buildingId', buildingId);
    if (floorId !== 'all') next.set('floorId', floorId);
    return next;
  }, [buildingId, deferredSearch, floorId, occupancyFilter, page, pageSize, statusFilter]);
  const parseRooms = useCallback(
    (value: unknown): ScopedPage<Room> => parseRoomsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const rooms = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseRooms,
    url: `${prefix}/directory/rooms?${roomParams.toString()}`
  });

  const bedParams = useMemo(() => {
    const next = new URLSearchParams({
      page: '1',
      pageSize: '100',
      occupancy: 'ANY',
      sort: 'code',
      direction: 'asc'
    });
    if (buildingId !== 'all') next.set('buildingId', buildingId);
    if (floorId !== 'all') next.set('floorId', floorId);
    return next;
  }, [buildingId, floorId]);
  const parseBeds = useCallback(
    (value: unknown): ScopedPage<Bed> => parseBedsPage(value, organizationId, facilityId ?? ''),
    [facilityId, organizationId]
  );
  const beds = useScopedDirectory({
    enabled: facilityId !== null,
    parse: parseBeds,
    url: `${prefix}/directory/beds?${bedParams.toString()}`
  });

  const buildingNameById = new Map((buildings.data?.items ?? []).map((building) => [building.id, building.name]));
  const floorById = new Map((floors.data?.items ?? []).map((floor) => [floor.id, floor]));
  const bedsByRoom = new Map<string, Bed[]>();
  for (const bed of beds.data?.items ?? []) {
    const roomBeds = bedsByRoom.get(bed.roomId) ?? [];
    roomBeds.push(bed);
    bedsByRoom.set(bed.roomId, roomBeds);
  }
  const visibleCapacity = (rooms.data?.items ?? []).reduce(
    (total, room) => ({
      bedCount: total.bedCount + room.bedCount,
      activeBedCount: total.activeBedCount + room.activeBedCount,
      occupiedBedCount: total.occupiedBedCount + room.occupiedBedCount,
      availableBedCount: total.availableBedCount + room.availableBedCount
    }),
    { bedCount: 0, activeBedCount: 0, occupiedBedCount: 0, availableBedCount: 0 }
  );
  const supportingDirectoryUnavailable = buildings.failure !== null || floors.failure !== null;
  const supportingDirectoryStale = buildings.stale || floors.stale;

  return (
    <div className="m02-page room-directory-page">
      <DirectoryPageHeader
        section="老人与入住"
        title="房间床位"
        description="按楼栋、楼层和占用状态查看聚合容量与床位级状态；房间卡片不会暴露老人身份。"
        actions={
          <Tooltip title="当前页面只接入读取接口">
            <Button disabled icon={<PlusOutlined />}>新增房间</Button>
          </Tooltip>
        }
      />

      {facilityId === null ? <FacilityRequiredCard /> : rooms.failure !== null && rooms.data === null ? (
        <DirectoryFailureCard failure={rooms.failure} onRetry={rooms.retry} resourceName="房间床位目录" />
      ) : (
        <Card className="m02-surface-card" styles={{ body: { padding: 0 } }}>
          <div className="m02-toolbar room-directory-toolbar">
            <div>
              <h2>房间与床位概览</h2>
              <p>占用数字来自后端目录，不推断具体床位标签或入住人。</p>
            </div>
            <Space size={12} wrap>
              <Select
                aria-label="筛选楼栋"
                disabled={buildings.failure !== null}
                loading={buildings.loading}
                value={buildingId}
                options={[
                  { value: 'all', label: '全部楼栋' },
                  ...(buildings.data?.items ?? []).map((building) => ({
                    value: building.id,
                    label: building.name
                  }))
                ]}
                onChange={setBuildingId}
              />
              <Select
                aria-label="筛选楼层"
                disabled={floors.failure !== null}
                loading={floors.loading}
                value={floorId}
                options={[
                  { value: 'all', label: '全部楼层' },
                  ...(floors.data?.items ?? []).map((floor) => ({ value: floor.id, label: floor.name }))
                ]}
                onChange={setFloorId}
              />
              <Select<DirectoryStatusFilter>
                aria-label="筛选房间状态"
                value={statusFilter}
                options={[
                  { value: 'all', label: '全部房间状态' },
                  { value: 'ACTIVE', label: '开放' },
                  { value: 'INACTIVE', label: '暂停使用' },
                  { value: 'ARCHIVED', label: '已归档' }
                ]}
                onChange={setStatusFilter}
              />
              <Select<OccupancyFilter>
                aria-label="筛选床位占用状态"
                value={occupancyFilter}
                options={[
                  { value: 'ANY', label: '全部占用状态' },
                  { value: 'AVAILABLE', label: '有可用床位' },
                  { value: 'OCCUPIED', label: '存在占用' },
                  { value: 'FULL', label: '已住满' }
                ]}
                onChange={setOccupancyFilter}
              />
            </Space>
          </div>

          {rooms.data !== null ? (
            <section className="room-capacity-summary" aria-label="当前房间结果容量汇总">
              <div><span>物理床位</span><strong>{visibleCapacity.bedCount}</strong></div>
              <div><span>可运营床位</span><strong>{visibleCapacity.activeBedCount}</strong></div>
              <div><span>已占用</span><strong>{visibleCapacity.occupiedBedCount}</strong></div>
              <div><span>实时可用</span><strong>{visibleCapacity.availableBedCount}</strong></div>
            </section>
          ) : null}

          {supportingDirectoryUnavailable ? (
            <Alert
              banner
              showIcon
              type="warning"
              title="楼栋或楼层选项暂不可用，房间床位结果仍可查看；仅相应筛选已停用。"
            />
          ) : supportingDirectoryStale ? (
            <Alert
              banner
              showIcon
              type="warning"
              title="楼栋或楼层选项刷新失败，当前选项可能不是最新目录。"
              action={<Button size="small" onClick={() => { buildings.retry(); floors.retry(); }}>重新同步选项</Button>}
            />
          ) : null}
          {rooms.stale ? <DirectoryStaleAlert onRetry={rooms.retry} /> : null}
          {beds.failure !== null && beds.data === null ? (
            <Alert
              banner
              showIcon
              type="warning"
              title="床位明细暂不可用；房间聚合容量仍可查看，办理入住前请刷新确认。"
              action={<Button size="small" onClick={beds.retry}>重试床位明细</Button>}
            />
          ) : beds.stale ? (
            <Alert
              banner
              showIcon
              type="warning"
              title="床位明细刷新失败，当前明细可能不是最新状态。"
              action={<Button size="small" onClick={beds.retry}>重新同步床位</Button>}
            />
          ) : beds.loading && beds.data === null ? (
            <div className="room-bed-loading-note" role="status">正在读取床位明细，房间容量已可查看。</div>
          ) : beds.data !== null && beds.data.pageInfo.total > beds.data.items.length ? (
            <Alert banner showIcon type="info" title="床位超过当前明细页上限；未返回的床位仍计入聚合容量。" />
          ) : null}

          {rooms.loading && rooms.data === null ? (
            <div className="m02-loading-grid" aria-busy="true" aria-live="polite">
              <ApartmentOutlined aria-hidden="true" />
              <strong>正在读取房间床位</strong>
            </div>
          ) : (rooms.data?.items.length ?? 0) === 0 ? (
            <Empty className="m02-grid-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前搜索和筛选下没有房间" />
          ) : (
            <section className="room-directory-grid" aria-label="房间床位目录">
              {rooms.data?.items.map((room) => {
                const floor = floorById.get(room.floorId);
                const buildingName = floor === undefined
                  ? '楼栋信息暂不可用'
                  : buildingNameById.get(floor.buildingId) ?? '楼栋信息暂不可用';
                return (
                  <RoomCard
                    key={room.id}
                    beds={beds.data === null ? null : bedsByRoom.get(room.id) ?? []}
                    buildingName={buildingName}
                    floorName={floor?.name ?? '楼层信息暂不可用'}
                    room={room}
                  />
                );
              })}
            </section>
          )}

          <div className="m02-pagination-row">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={rooms.data?.pageInfo.total ?? 0}
              pageSizeOptions={[6, 12, 24]}
              showSizeChanger
              showTotal={(total) => `共 ${total} 个房间`}
              onChange={(nextPage, nextPageSize) => {
                setPage(nextPageSize === pageSize ? nextPage : 1);
                setPageSize(nextPageSize);
              }}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
