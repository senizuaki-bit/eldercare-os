import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelM03Operation,
  finishM03Operation,
  getOrCreateM03OperationKey,
  m03OperationStorageKey
} from './m03-operation-key';

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('M03 logical operation keys', () => {
  it('reuses one persisted key through transport retries and clears it only after success', () => {
    const scope = 'elder:voice-demo';
    const first = getOrCreateM03OperationKey(scope, 'elder-demo-voice');
    const retry = getOrCreateM03OperationKey(scope, 'elder-demo-voice');

    expect(retry).toBe(first);
    expect(window.sessionStorage.getItem(m03OperationStorageKey(scope))).toBe(first);

    finishM03Operation(scope, first);
    expect(window.sessionStorage.getItem(m03OperationStorageKey(scope))).toBeNull();
    expect(getOrCreateM03OperationKey(scope, 'elder-demo-voice')).not.toBe(first);
  });

  it('does not let a stale response clear a newer logical operation', () => {
    const scope = 'elder:rating:work-order-1:5';
    const current = getOrCreateM03OperationKey(scope, 'elder-rating');

    finishM03Operation(scope, 'elder-rating-stale-response');
    expect(getOrCreateM03OperationKey(scope, 'elder-rating')).toBe(current);

    cancelM03Operation(scope);
    expect(window.sessionStorage.getItem(m03OperationStorageKey(scope))).toBeNull();
  });
});
