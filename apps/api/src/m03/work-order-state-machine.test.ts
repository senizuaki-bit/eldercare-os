import { describe, expect, it } from 'vitest';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  allowedWorkOrderTransitions,
  assertArrivalAllowed,
  assertWorkOrderTransition,
} from './work-order-state-machine.js';

describe('M03 work-order state machine', () => {
  it('preserves the auditable happy-path sequence', () => {
    const sequence = ['NEW', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'] as const;
    for (let index = 0; index < sequence.length - 1; index += 1) {
      expect(() => assertWorkOrderTransition(sequence[index]!, sequence[index + 1]!)).not.toThrow();
    }
    expect(allowedWorkOrderTransitions('CLOSED')).toEqual([]);
  });

  it('rejects skipping verification and terminal-state changes', () => {
    expect(() => assertWorkOrderTransition('IN_PROGRESS', 'CLOSED')).toThrow(SafeHttpException);
    expect(() => assertWorkOrderTransition('CANCELLED', 'NEW')).toThrow(SafeHttpException);
  });

  it('treats arrival as an idempotent command and not a new status', () => {
    expect(() => assertArrivalAllowed('ACCEPTED', null)).not.toThrow();
    expect(() => assertArrivalAllowed('ASSIGNED', null)).toThrow(SafeHttpException);
    expect(() => assertArrivalAllowed('ACCEPTED', new Date())).toThrow(SafeHttpException);
  });
});
