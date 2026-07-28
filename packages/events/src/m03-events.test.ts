import { describe, expect, it } from 'vitest';

import { M03_EVENT_TYPES, isM03EventType } from './index.js';

describe('M03 event catalog', () => {
  it('keeps arrival as an event and not a work-order state', () => {
    expect(M03_EVENT_TYPES).toContain('WORK_ORDER.ARRIVED');
    expect(isM03EventType('WORK_ORDER.ARRIVED')).toBe(true);
    expect(isM03EventType('WORK_ORDER.UNKNOWN')).toBe(false);
  });

  it('includes the manual-fallback and privacy-safe publishing outcomes', () => {
    expect(M03_EVENT_TYPES).toContain('TRANSCRIPT.FAILED');
    expect(M03_EVENT_TYPES).toContain('AI_NEED_ANALYSIS.FAILED');
    expect(M03_EVENT_TYPES).toContain('FAMILY_SUMMARY.PUBLISHED');
    expect(M03_EVENT_TYPES).toContain('RATING.SUBMITTED');
  });

  it('includes the review and pre-dispatch revision events emitted by M03', () => {
    expect(M03_EVENT_TYPES).toContain('NEED.REVIEWED');
    expect(M03_EVENT_TYPES).toContain('WORK_ORDER.REVISED');
    expect(isM03EventType('NEED.REVIEWED')).toBe(true);
    expect(isM03EventType('WORK_ORDER.REVISED')).toBe(true);
  });
});
