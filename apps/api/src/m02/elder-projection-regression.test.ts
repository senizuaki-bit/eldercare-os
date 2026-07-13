import { describe, expect, it } from 'vitest';
import { createAdmissionNumber, selectAllowedFieldsForCurrentGrant } from './elders.service.js';

describe('family sharing consent versions', () => {
  it('does not reactivate preferences from a withdrawn grant after a later re-grant', () => {
    const now = new Date('2026-07-13T08:00:00.000Z');
    const fields = selectAllowedFieldsForCurrentGrant(
      [
        {
          field: 'CURRENT_RESIDENCE',
          allowed: true,
          consentRecordId: 'withdrawn-grant',
          validFrom: new Date('2026-07-01T00:00:00.000Z'),
          validUntil: null,
          version: 2,
        },
        {
          field: 'PREFERRED_NAME',
          allowed: true,
          consentRecordId: 'current-regrant',
          validFrom: new Date('2026-07-13T00:00:00.000Z'),
          validUntil: null,
          version: 1,
        },
      ],
      'current-regrant',
      now,
    );

    expect(fields).toEqual(['PREFERRED_NAME']);
  });
});

describe('admission number bounds', () => {
  it('keeps a deterministic max-record-number admission key within varchar(64)', () => {
    const value = createAdmissionNumber(
      'R'.repeat(64),
      '87000000-0000-4000-8000-000000000001',
      new Date('2026-07-13T01:02:03.000Z'),
    );
    expect(value).toHaveLength(64);
    expect(value).toBe(createAdmissionNumber(
      'R'.repeat(64),
      '87000000-0000-4000-8000-000000000001',
      new Date('2026-07-13T01:02:03.000Z'),
    ));
  });
});
