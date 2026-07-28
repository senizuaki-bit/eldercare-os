import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_RESOLUTION_CHECKLIST_CODES,
  normalizeEmergencyResolutionChecklist,
} from './emergency-resolution-checklist.js';

describe('M04 emergency resolution checklist', () => {
  it('accepts exactly the fixed checklist snapshot', () => {
    expect(
      normalizeEmergencyResolutionChecklist([
        'FOLLOW_UP_HANDOFF_CONFIRMED',
        'SCENE_SAFETY_CONFIRMED',
        'ELDER_STATE_CONFIRMED',
      ]),
    ).toEqual(EMERGENCY_RESOLUTION_CHECKLIST_CODES);
  });

  const invalidChecklists: readonly (readonly [readonly string[]])[] = [
    [[]],
    [['SCENE_SAFETY_CONFIRMED']],
    [[
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
      'UNKNOWN',
    ]],
    [[
      'SCENE_SAFETY_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'ELDER_STATE_CONFIRMED',
      'FOLLOW_UP_HANDOFF_CONFIRMED',
    ]],
  ];

  it.each(invalidChecklists)('rejects missing, unknown or duplicate values: %j', (input) => {
    expect(() => normalizeEmergencyResolutionChecklist(input)).toThrowError(
      expect.objectContaining({
        safeCode: 'EMERGENCY_RESOLUTION_CHECKLIST_INCOMPLETE',
      }),
    );
  });
});
