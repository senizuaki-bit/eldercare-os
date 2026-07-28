import { m04Conflict, m04Forbidden } from './m04-errors.js';

export type EmergencyState =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESPONDING'
  | 'RESOLVED'
  | 'REVIEWED';

export type EmergencyCommand =
  | 'ACKNOWLEDGE'
  | 'MARK_EN_ROUTE'
  | 'MARK_ON_SITE'
  | 'RESOLVE'
  | 'REVIEW';

export type EmergencyActorType = 'USER' | 'SYSTEM' | 'DEVICE' | 'AGENT' | 'AI';

const ALLOWED_TRANSITIONS: Readonly<Record<EmergencyState, readonly EmergencyState[]>> = {
  OPEN: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['RESPONDING'],
  RESPONDING: ['RESOLVED'],
  RESOLVED: ['REVIEWED'],
  REVIEWED: [],
};

const HUMAN_ONLY_COMMANDS = new Set<EmergencyCommand>([
  'ACKNOWLEDGE',
  'MARK_EN_ROUTE',
  'MARK_ON_SITE',
  'RESOLVE',
  'REVIEW',
]);

export function allowedEmergencyTransitions(
  status: EmergencyState,
): readonly EmergencyState[] {
  return ALLOWED_TRANSITIONS[status];
}

export function assertEmergencyTransition(
  fromStatus: EmergencyState,
  toStatus: EmergencyState,
): void {
  if (!ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw m04Conflict(
      'INVALID_EMERGENCY_TRANSITION',
      `紧急事件不能从 ${fromStatus} 转为 ${toStatus}`,
    );
  }
}

export function assertEmergencyCommandActor(
  command: EmergencyCommand,
  actorType: EmergencyActorType,
): void {
  if (HUMAN_ONLY_COMMANDS.has(command) && actorType !== 'USER') {
    throw m04Forbidden(
      'HUMAN_ACTOR_REQUIRED',
      `${command} 必须由经过授权的工作人员执行`,
    );
  }
}

export function assertResponseMilestone(
  status: EmergencyState,
  milestone: 'EN_ROUTE' | 'ON_SITE',
  currentResponderStatus: 'ASSIGNED' | 'ACKNOWLEDGED' | 'EN_ROUTE' | 'ON_SITE' | 'RELEASED',
): void {
  if (!['ACKNOWLEDGED', 'RESPONDING'].includes(status)) {
    throw m04Conflict(
      'RESPONSE_MILESTONE_NOT_ALLOWED',
      '只有已确认且正在响应的紧急事件可以登记响应里程碑',
    );
  }

  if (milestone === 'EN_ROUTE' && currentResponderStatus !== 'ACKNOWLEDGED') {
    throw m04Conflict(
      'EN_ROUTE_NOT_ALLOWED',
      '只有已确认的响应人员可以登记出发',
    );
  }

  if (milestone === 'ON_SITE' && currentResponderStatus !== 'EN_ROUTE') {
    throw m04Conflict(
      'ON_SITE_NOT_ALLOWED',
      '只有已出发的响应人员可以登记到场',
    );
  }
}
