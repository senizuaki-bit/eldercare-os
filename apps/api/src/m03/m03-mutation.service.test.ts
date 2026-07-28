import { describe, expect, it } from 'vitest';
import { createM03OutboxKey } from './m03-mutation.service.js';

describe('M03 outbox idempotency key', () => {
  it('is deterministic and aggregate-version scoped', () => {
    const first = createM03OutboxKey('correlation-123', 'WORK_ORDER.ACCEPTED', 'aggregate-1', 3);
    const repeated = createM03OutboxKey('correlation-123', 'WORK_ORDER.ACCEPTED', 'aggregate-1', 3);
    const next = createM03OutboxKey('correlation-123', 'WORK_ORDER.ACCEPTED', 'aggregate-1', 4);
    expect(first).toBe(repeated);
    expect(first).not.toBe(next);
    expect(first).toMatch(/^m03-v1:[a-f0-9]{64}$/);
  });
});
