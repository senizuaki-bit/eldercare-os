import type {
  AudioInput,
  ProviderContext,
  StructuredAnalysisProvider,
  StructuredGenerationInput,
  StructuredGenerationResult,
  TranscriptResult,
  TranscriptionProvider,
} from './index.js';

export const HOT_WATER_DIZZINESS_TRANSCRIPT = '我想喝热水，今天有点头晕。';

export const FAKE_AI_FIXTURE_KEYS = [
  'HOT_WATER_DIZZINESS_V1',
  'CARE_COMPLETION_V1',
  'TRANSCRIPTION_FAILURE_V1',
  'ANALYSIS_FAILURE_V1',
] as const;

export const CARE_COMPLETION_TRANSCRIPT = '已为老人提供温水，并确认当前状态平稳；建议本班继续观察。';

export type FakeAIFixtureKey = (typeof FAKE_AI_FIXTURE_KEYS)[number];
export type FakeNeedCategory =
  | 'DAILY_LIVING'
  | 'HEALTH_CONCERN'
  | 'EMERGENCY_CONCERN'
  | 'EMOTIONAL_SUPPORT'
  | 'FACILITY_SUPPORT'
  | 'OTHER';
export type FakeNeedUrgency = 'ROUTINE' | 'PRIORITY' | 'IMMEDIATE_REVIEW';

export interface FakeNeedSubIntent {
  readonly category: FakeNeedCategory;
  readonly summary: string;
  readonly urgencySuggestion: FakeNeedUrgency;
}

export interface FakeNeedAnalysisOutput {
  readonly summary: string;
  readonly categories: readonly FakeNeedCategory[];
  readonly urgencySuggestion: FakeNeedUrgency;
  readonly reportedConcerns: readonly string[];
  readonly safetyFlags: readonly string[];
  readonly emotionObservation: null | {
    readonly label: 'NONE' | 'POSSIBLE_DISTRESS';
    readonly confidence: number;
    readonly evidence: readonly string[];
  };
  readonly followUpQuestions: readonly string[];
  readonly requiresHumanReview: boolean;
  readonly subIntents: readonly FakeNeedSubIntent[];
}

export const HOT_WATER_DIZZINESS_ANALYSIS = {
  summary: '老人希望喝热水，并表示今天有点头晕。',
  categories: ['DAILY_LIVING', 'HEALTH_CONCERN'],
  urgencySuggestion: 'PRIORITY',
  reportedConcerns: ['头晕'],
  safetyFlags: ['DIZZINESS_REQUIRES_REVIEW'],
  emotionObservation: null,
  followUpQuestions: ['头晕是否突然出现，是否伴随胸痛、呼吸困难或跌倒？'],
  requiresHumanReview: true,
  subIntents: [
    {
      category: 'DAILY_LIVING',
      summary: '提供适温热水。',
      urgencySuggestion: 'ROUTINE',
    },
    {
      category: 'HEALTH_CONCERN',
      summary: '人工查看老人今天报告的头晕。',
      urgencySuggestion: 'PRIORITY',
    },
  ],
} as const satisfies FakeNeedAnalysisOutput;

export const DETERMINISTIC_FAKE_PROVIDER = {
  provider: 'deterministic-fake',
  transcriptionModel: 'fixture-transcriber-v1',
  analysisModel: 'fixture-needs-v1',
  promptVersion: 'need-analysis-v1',
  schemaVersion: 'need-analysis-output-v1',
} as const;

export type DeterministicFakeAIErrorCode =
  | 'TRANSCRIPTION_FIXTURE_FAILED'
  | 'ANALYSIS_FIXTURE_FAILED'
  | 'UNKNOWN_FIXTURE'
  | 'UNSUPPORTED_INSTRUCTION'
  | 'UNSUPPORTED_INPUT';

export class DeterministicFakeAIError extends Error {
  readonly code: DeterministicFakeAIErrorCode;

  constructor(code: DeterministicFakeAIErrorCode) {
    super(code);
    this.name = 'DeterministicFakeAIError';
    this.code = code;
  }
}

export class DeterministicFakeTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: AudioInput, context: ProviderContext): Promise<TranscriptResult> {
    void context;
    await Promise.resolve();
    const fixtureKey = resolveAudioFixtureKey(input);
    if (fixtureKey === 'TRANSCRIPTION_FAILURE_V1') {
      throw new DeterministicFakeAIError('TRANSCRIPTION_FIXTURE_FAILED');
    }
    if (fixtureKey === 'CARE_COMPLETION_V1') {
      return {
        text: CARE_COMPLETION_TRANSCRIPT,
        confidence: 0.99,
        durationMs: 2_800,
      };
    }
    if (fixtureKey !== 'HOT_WATER_DIZZINESS_V1' && fixtureKey !== 'ANALYSIS_FAILURE_V1') {
      throw new DeterministicFakeAIError('UNKNOWN_FIXTURE');
    }
    return {
      text: HOT_WATER_DIZZINESS_TRANSCRIPT,
      confidence: 0.98,
      durationMs: 3_200,
    };
  }
}

export class DeterministicFakeNeedAnalysisProvider implements StructuredAnalysisProvider {
  async generate<TOutput>(
    input: StructuredGenerationInput,
    context: ProviderContext,
  ): Promise<StructuredGenerationResult<TOutput>> {
    void context;
    await Promise.resolve();
    if (input.instructionKey !== 'need.analysis.v1') {
      throw new DeterministicFakeAIError('UNSUPPORTED_INSTRUCTION');
    }
    const fixture = parseAnalysisInput(input.input);
    if (fixture.fixtureKey === 'ANALYSIS_FAILURE_V1') {
      throw new DeterministicFakeAIError('ANALYSIS_FIXTURE_FAILED');
    }
    if (
      fixture.fixtureKey !== 'HOT_WATER_DIZZINESS_V1' ||
      fixture.transcript !== HOT_WATER_DIZZINESS_TRANSCRIPT
    ) {
      throw new DeterministicFakeAIError('UNSUPPORTED_INPUT');
    }
    return {
      output: HOT_WATER_DIZZINESS_ANALYSIS as TOutput,
      confidence: 0.96,
      evidence: ['老人原话包含“喝热水”与“头晕”两个明确意图。'],
    };
  }
}

export interface DeterministicRiskInput {
  readonly categories: readonly FakeNeedCategory[];
  readonly reportedConcerns: readonly string[];
  readonly safetyFlags: readonly string[];
}

export interface DeterministicRiskResult {
  readonly suggestedPriority: FakeNeedUrgency;
  readonly requiresHumanReview: boolean;
  readonly requiresEmergencyRuleEvaluation: boolean;
  readonly matchedRuleCodes: readonly string[];
  /** An LLM/fake adapter never makes the final emergency decision. */
  readonly aiDecisionFinal: false;
}

const immediateConcernFlags = new Set([
  'LOSS_OF_CONSCIOUSNESS',
  'BREATHING_DIFFICULTY',
  'CHEST_PAIN',
  'FALL_WITH_INJURY',
]);

export function evaluateDeterministicNeedRisk(
  input: DeterministicRiskInput,
): DeterministicRiskResult {
  const emergencyMatched =
    input.categories.includes('EMERGENCY_CONCERN') ||
    input.safetyFlags.some((flag) => immediateConcernFlags.has(flag));
  if (emergencyMatched) {
    return {
      suggestedPriority: 'IMMEDIATE_REVIEW',
      requiresHumanReview: true,
      requiresEmergencyRuleEvaluation: true,
      matchedRuleCodes: ['EMERGENCY_CONCERN_REQUIRES_DETERMINISTIC_REVIEW'],
      aiDecisionFinal: false,
    };
  }

  const healthMatched =
    input.categories.includes('HEALTH_CONCERN') ||
    input.reportedConcerns.some((concern) => concern.includes('头晕')) ||
    input.safetyFlags.includes('DIZZINESS_REQUIRES_REVIEW');
  if (healthMatched) {
    return {
      suggestedPriority: 'PRIORITY',
      requiresHumanReview: true,
      requiresEmergencyRuleEvaluation: false,
      matchedRuleCodes: ['HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW'],
      aiDecisionFinal: false,
    };
  }

  return {
    suggestedPriority: 'ROUTINE',
    requiresHumanReview: false,
    requiresEmergencyRuleEvaluation: false,
    matchedRuleCodes: [],
    aiDecisionFinal: false,
  };
}

export function splitDeterministicNeedAnalysis(
  analysis: FakeNeedAnalysisOutput,
): readonly FakeNeedSubIntent[] {
  return analysis.subIntents.map((intent) => ({ ...intent }));
}

function resolveAudioFixtureKey(input: AudioInput): string {
  if (input.fixtureKey !== undefined) return input.fixtureKey;
  return FAKE_AI_FIXTURE_KEYS.find((key) => input.objectKey.includes(key)) ?? '';
}

function parseAnalysisInput(input: unknown): { fixtureKey: string; transcript: string } {
  if (typeof input !== 'object' || input === null) {
    throw new DeterministicFakeAIError('UNSUPPORTED_INPUT');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.fixtureKey !== 'string' || typeof record.transcript !== 'string') {
    throw new DeterministicFakeAIError('UNSUPPORTED_INPUT');
  }
  return { fixtureKey: record.fixtureKey, transcript: record.transcript };
}
