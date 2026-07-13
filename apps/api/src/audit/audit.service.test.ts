import { describe, expect, it } from 'vitest';
import { sanitizeAuditMetadata } from './audit.service.js';

describe('sanitizeAuditMetadata', () => {
  it('keeps only allowlisted audit summaries and removes credentials', () => {
    const result = sanitizeAuditMetadata({
      password: 'never-store-this',
      roleKeys: ['CAREGIVER'],
      targetFacilityId: 'facility-safe',
      tokenHash: 'never-store-this-either',
    });

    expect(result).toEqual({
      roleKeys: ['CAREGIVER'],
      targetFacilityId: 'facility-safe',
    });
    expect(JSON.stringify(result)).not.toContain('never-store');
  });
});
