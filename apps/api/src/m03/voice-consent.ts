const REQUIRED_VOICE_CONSENT_PURPOSES = [
  'VOICE_CAPTURE',
  'TRANSCRIPTION_AI_ANALYSIS',
] as const;

export interface VoiceConsentDecisionRecord {
  readonly purpose: string;
  readonly decision: string;
  readonly consentVersion: number;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
}

export function voiceConsentFailureCode(
  records: readonly VoiceConsentDecisionRecord[],
  now: Date,
): 'CONSENT_REQUIRED' | 'CONSENT_WITHDRAWN' | null {
  const latest = new Map<string, VoiceConsentDecisionRecord>();
  for (const record of records) {
    if (record.effectiveAt > now) continue;
    const previous = latest.get(record.purpose);
    if (previous === undefined || record.consentVersion > previous.consentVersion) {
      latest.set(record.purpose, record);
    }
  }
  for (const purpose of REQUIRED_VOICE_CONSENT_PURPOSES) {
    const record = latest.get(purpose);
    if (record?.decision === 'WITHDRAWN') return 'CONSENT_WITHDRAWN';
    if (
      record === undefined ||
      record.decision !== 'GRANTED' ||
      (record.expiresAt !== null && record.expiresAt <= now)
    ) {
      return 'CONSENT_REQUIRED';
    }
  }
  return null;
}
