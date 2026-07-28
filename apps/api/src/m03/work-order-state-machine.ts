import type { WorkOrderStatus } from '@eldercare/contracts';
import { m03Conflict } from './m03-errors.js';

const ALLOWED_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  NEW: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['VERIFIED'],
  VERIFIED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function allowedWorkOrderTransitions(status: WorkOrderStatus): readonly WorkOrderStatus[] {
  return ALLOWED_TRANSITIONS[status];
}
export function assertWorkOrderTransition(
  fromStatus: WorkOrderStatus,
  toStatus: WorkOrderStatus,
): void {
  if (!ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw m03Conflict('INVALID_WORK_ORDER_TRANSITION', `工单不能从 ${fromStatus} 转为 ${toStatus}`);
  }
}

export function assertArrivalAllowed(status: WorkOrderStatus, arrivedAt: Date | null): void {
  if (status !== 'ACCEPTED') {
    throw m03Conflict('ARRIVAL_NOT_ALLOWED', '只有已接单任务可以登记到场');
  }
  if (arrivedAt !== null) {
    throw m03Conflict('ARRIVAL_ALREADY_RECORDED', '该任务已经登记到场');
  }
}
