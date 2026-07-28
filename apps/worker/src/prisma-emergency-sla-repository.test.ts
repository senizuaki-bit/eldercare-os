import { describe, expect, it } from 'vitest';
import { stageStillOutstanding } from './prisma-emergency-sla-repository.js';

describe('stageStillOutstanding', () => {
  it('cancels acknowledgement only after a human acknowledgement', () => {
    expect(
      stageStillOutstanding('ACKNOWLEDGEMENT', {
        status: 'OPEN',
        onSiteAt: null,
        resolvedAt: null,
      }),
    ).toBe(true);
    expect(
      stageStillOutstanding('ACKNOWLEDGEMENT', {
        status: 'ACKNOWLEDGED',
        onSiteAt: null,
        resolvedAt: null,
      }),
    ).toBe(false);
  });

  it('keeps arrival active through en-route and cancels it at on-site', () => {
    expect(
      stageStillOutstanding('ARRIVAL', {
        status: 'RESPONDING',
        onSiteAt: null,
        resolvedAt: null,
      }),
    ).toBe(true);
    expect(
      stageStillOutstanding('ARRIVAL', {
        status: 'RESPONDING',
        onSiteAt: new Date(),
        resolvedAt: null,
      }),
    ).toBe(false);
  });

  it('keeps resolution active until resolved or reviewed', () => {
    expect(
      stageStillOutstanding('RESOLUTION', {
        status: 'RESPONDING',
        onSiteAt: new Date(),
        resolvedAt: null,
      }),
    ).toBe(true);
    expect(
      stageStillOutstanding('RESOLUTION', {
        status: 'RESOLVED',
        onSiteAt: new Date(),
        resolvedAt: new Date(),
      }),
    ).toBe(false);
  });
});
