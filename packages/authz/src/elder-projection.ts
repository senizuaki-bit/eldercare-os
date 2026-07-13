export const FAMILY_SHAREABLE_ELDER_FIELDS = [
  'PREFERRED_NAME',
  'CURRENT_RESIDENCE',
  'CARE_LEVEL',
  'ACCESSIBILITY_SUMMARY',
  'COMMUNICATION_PREFERENCE',
  'PERSONAL_BASELINE_SUMMARY',
  'CONSENT_SUMMARY',
  'TIMELINE_SUMMARY',
] as const;

export type FamilyShareableElderField = (typeof FAMILY_SHAREABLE_ELDER_FIELDS)[number];

export interface ElderProjectionSource {
  readonly id: string;
  readonly displayName: string;
  readonly preferredName?: string | null;
  readonly currentResidence?: unknown;
  readonly careLevel?: unknown;
  readonly accessibilitySummary?: unknown;
  readonly communicationPreference?: unknown;
  readonly personalBaselineSummary?: unknown;
  readonly consentSummary?: unknown;
  readonly timelineSummary?: unknown;
  readonly birthDate?: unknown;
  readonly emergencyContacts?: unknown;
  readonly internalNotes?: unknown;
  readonly caregiverLocation?: unknown;
  readonly rawTranscript?: unknown;
}

export interface FamilySafeElderProjection {
  readonly id: string;
  readonly displayName: string;
  readonly preferredName?: string | null;
  readonly currentResidence?: unknown;
  readonly careLevel?: unknown;
  readonly accessibilitySummary?: unknown;
  readonly communicationPreference?: unknown;
  readonly personalBaselineSummary?: unknown;
  readonly consentSummary?: unknown;
  readonly timelineSummary?: unknown;
  readonly sharedFields: readonly FamilyShareableElderField[];
}

export interface CaregiverElderProjection {
  readonly id: string;
  readonly displayName: string;
  readonly preferredName?: string | null;
  readonly currentResidence?: unknown;
  readonly careLevel?: unknown;
  readonly accessibilitySummary?: unknown;
}

export function projectFamilySafeElder(
  source: ElderProjectionSource,
  allowedFields: readonly FamilyShareableElderField[],
): FamilySafeElderProjection {
  const allowed = new Set(allowedFields);
  const result: Record<string, unknown> = {
    id: source.id,
    displayName: source.displayName,
    sharedFields: FAMILY_SHAREABLE_ELDER_FIELDS.filter((field) => allowed.has(field)),
  };
  copyAllowed(result, source, allowed, 'PREFERRED_NAME', 'preferredName');
  copyAllowed(result, source, allowed, 'CURRENT_RESIDENCE', 'currentResidence');
  copyAllowed(result, source, allowed, 'CARE_LEVEL', 'careLevel');
  copyAllowed(result, source, allowed, 'ACCESSIBILITY_SUMMARY', 'accessibilitySummary');
  copyAllowed(result, source, allowed, 'COMMUNICATION_PREFERENCE', 'communicationPreference');
  copyAllowed(result, source, allowed, 'PERSONAL_BASELINE_SUMMARY', 'personalBaselineSummary');
  copyAllowed(result, source, allowed, 'CONSENT_SUMMARY', 'consentSummary');
  copyAllowed(result, source, allowed, 'TIMELINE_SUMMARY', 'timelineSummary');
  return result as unknown as FamilySafeElderProjection;
}

export function projectCaregiverElder(source: ElderProjectionSource): CaregiverElderProjection {
  return {
    id: source.id,
    displayName: source.displayName,
    ...(source.preferredName === undefined ? {} : { preferredName: source.preferredName }),
    ...(source.currentResidence === undefined ? {} : { currentResidence: source.currentResidence }),
    ...(source.careLevel === undefined ? {} : { careLevel: source.careLevel }),
    ...(source.accessibilitySummary === undefined
      ? {}
      : { accessibilitySummary: source.accessibilitySummary }),
  };
}

function copyAllowed(
  target: Record<string, unknown>,
  source: ElderProjectionSource,
  allowed: ReadonlySet<FamilyShareableElderField>,
  field: FamilyShareableElderField,
  key: keyof ElderProjectionSource,
): void {
  const value = source[key];
  if (allowed.has(field) && value !== undefined) target[key] = value;
}
