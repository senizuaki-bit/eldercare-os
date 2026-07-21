import { describe, expect, it } from 'vitest';

import { projectCaregiverElder, projectFamilySafeElder } from './elder-projection.js';

const source = {
  id: 'elder-a',
  displayName: '虚构老人甲',
  preferredName: '张阿姨',
  currentResidence: { roomLabel: 'A201', bedLabel: '1' },
  careLevel: { label: '协助照护' },
  accessibilitySummary: { largeText: true },
  communicationPreference: { preferredLanguage: 'zh-CN' },
  personalBaselineSummary: ['习惯早起'],
  consentSummary: [{ purpose: 'FAMILY_SHARING', active: true }],
  timelineSummary: [{ eventType: 'ELDER.ADMITTED' }],
  birthDate: '1940-01-01',
  emergencyContacts: [{ value: 'fictional-contact' }],
  internalNotes: '内部备注',
  caregiverLocation: { x: 10, y: 20 },
  rawTranscript: '完整转写',
};

describe('elder projections', () => {
  it('projects only explicitly shared family fields and never leaks denylisted source fields', () => {
    const result = projectFamilySafeElder(source, [
      'PREFERRED_NAME',
      'CURRENT_RESIDENCE',
      'CARE_LEVEL',
    ]);
    expect(result).toMatchObject({
      id: 'elder-a',
      displayName: '虚构老人甲',
      preferredName: '张阿姨',
      currentResidence: { roomLabel: 'A201', bedLabel: '1' },
      careLevel: { label: '协助照护' },
      sharedFields: ['PREFERRED_NAME', 'CURRENT_RESIDENCE', 'CARE_LEVEL'],
    });
    expect(result).not.toHaveProperty('birthDate');
    expect(result).not.toHaveProperty('emergencyContacts');
    expect(result).not.toHaveProperty('internalNotes');
    expect(result).not.toHaveProperty('caregiverLocation');
    expect(result).not.toHaveProperty('rawTranscript');
    expect(result).not.toHaveProperty('timelineSummary');
  });

  it('uses a fixed caregiver minimum projection regardless of extra source fields', () => {
    expect(projectCaregiverElder(source)).toEqual({
      id: 'elder-a',
      displayName: '虚构老人甲',
      preferredName: '张阿姨',
      currentResidence: { roomLabel: 'A201', bedLabel: '1' },
      careLevel: { label: '协助照护' },
      accessibilitySummary: { largeText: true },
    });
  });

  it('deduplicates and orders family shared fields by the policy whitelist', () => {
    expect(
      projectFamilySafeElder(source, ['TIMELINE_SUMMARY', 'PREFERRED_NAME', 'TIMELINE_SUMMARY'])
        .sharedFields,
    ).toEqual(['PREFERRED_NAME', 'TIMELINE_SUMMARY']);
  });
});
