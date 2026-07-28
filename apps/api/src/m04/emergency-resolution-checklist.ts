import { m04BadRequest } from './m04-errors.js';

export const EMERGENCY_RESOLUTION_CHECKLIST_CODES = [
  'SCENE_SAFETY_CONFIRMED',
  'ELDER_STATE_CONFIRMED',
  'FOLLOW_UP_HANDOFF_CONFIRMED',
] as const;

export type EmergencyResolutionChecklistCode =
  (typeof EMERGENCY_RESOLUTION_CHECKLIST_CODES)[number];

export function normalizeEmergencyResolutionChecklist(
  value: readonly string[],
): EmergencyResolutionChecklistCode[] {
  const unique = new Set(value);
  const normalized = [...unique].sort();
  const expected = [...EMERGENCY_RESOLUTION_CHECKLIST_CODES].sort();
  if (
    value.length !== unique.size ||
    normalized.length !== expected.length ||
    normalized.some((item, index) => item !== expected[index])
  ) {
    throw m04BadRequest(
      'EMERGENCY_RESOLUTION_CHECKLIST_INCOMPLETE',
      '请逐项确认现场安全、老人状态和后续交接',
    );
  }
  return [...EMERGENCY_RESOLUTION_CHECKLIST_CODES];
}
