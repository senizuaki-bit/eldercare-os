import { describe, expect, it } from 'vitest';

import type { ProviderContext } from './index.js';
import type { HOT_WATER_DIZZINESS_ANALYSIS } from './fake.js';
import {
  CARE_COMPLETION_TRANSCRIPT,
  DeterministicFakeNeedAnalysisProvider,
  DeterministicFakeTranscriptionProvider,
  HOT_WATER_DIZZINESS_TRANSCRIPT,
  evaluateDeterministicNeedRisk,
  splitDeterministicNeedAnalysis,
} from './fake.js';

const context: ProviderContext = {
  correlationId: 'correlation-0001',
  provider: 'deterministic-fake',
  model: 'fixture-v1',
  promptVersion: 'need-analysis-v1',
  schemaVersion: 'need-analysis-output-v1',
};

describe('deterministic fake M03 AI', () => {
  it('transcribes the canonical fixture exactly and reproducibly', async () => {
    const provider = new DeterministicFakeTranscriptionProvider();
    const first = await provider.transcribe(
      {
        objectKey: 'fixtures/HOT_WATER_DIZZINESS_V1.webm',
        mimeType: 'audio/webm',
      },
      context,
    );
    const second = await provider.transcribe(
      {
        objectKey: 'another-key',
        mimeType: 'audio/webm',
        fixtureKey: 'HOT_WATER_DIZZINESS_V1',
      },
      context,
    );
    expect(first).toEqual(second);
    expect(first.text).toBe('我想喝热水，今天有点头晕。');
  });

  it('produces a separate deterministic caregiver completion draft fixture', async () => {
    const provider = new DeterministicFakeTranscriptionProvider();
    await expect(provider.transcribe({
      objectKey: 'private-object',
      mimeType: 'audio/webm',
      fixtureKey: 'CARE_COMPLETION_V1',
    }, context)).resolves.toMatchObject({
      text: CARE_COMPLETION_TRANSCRIPT,
      confidence: 0.99,
    });
  });

  it('splits daily living and health concerns while forcing deterministic review', async () => {
    const provider = new DeterministicFakeNeedAnalysisProvider();
    const result = await provider.generate<typeof HOT_WATER_DIZZINESS_ANALYSIS>(
      {
        instructionKey: 'need.analysis.v1',
        input: {
          fixtureKey: 'HOT_WATER_DIZZINESS_V1',
          transcript: HOT_WATER_DIZZINESS_TRANSCRIPT,
        },
      },
      context,
    );
    expect(result.output.categories).toEqual(['DAILY_LIVING', 'HEALTH_CONCERN']);
    expect(splitDeterministicNeedAnalysis(result.output)).toHaveLength(2);
    expect(
      evaluateDeterministicNeedRisk({
        categories: result.output.categories,
        reportedConcerns: result.output.reportedConcerns,
        safetyFlags: result.output.safetyFlags,
      }),
    ).toEqual({
      suggestedPriority: 'PRIORITY',
      requiresHumanReview: true,
      requiresEmergencyRuleEvaluation: false,
      matchedRuleCodes: ['HEALTH_CONCERN_REQUIRES_HUMAN_REVIEW'],
      aiDecisionFinal: false,
    });
  });

  it('never treats fake AI as the final emergency decision', () => {
    expect(
      evaluateDeterministicNeedRisk({
        categories: ['EMERGENCY_CONCERN'],
        reportedConcerns: [],
        safetyFlags: ['BREATHING_DIFFICULTY'],
      }),
    ).toMatchObject({
      suggestedPriority: 'IMMEDIATE_REVIEW',
      requiresEmergencyRuleEvaluation: true,
      aiDecisionFinal: false,
    });
  });

  it('provides explicit fixture failures for manual-fallback tests', async () => {
    const transcriber = new DeterministicFakeTranscriptionProvider();
    await expect(
      transcriber.transcribe(
        {
          objectKey: 'fixtures/TRANSCRIPTION_FAILURE_V1.webm',
          mimeType: 'audio/webm',
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'TRANSCRIPTION_FIXTURE_FAILED',
    });

    const analysisFailureTranscript = await transcriber.transcribe(
      {
        objectKey: 'fixtures/ANALYSIS_FAILURE_V1.webm',
        mimeType: 'audio/webm',
      },
      context,
    );
    expect(analysisFailureTranscript.text).toBe(HOT_WATER_DIZZINESS_TRANSCRIPT);

    const analyzer = new DeterministicFakeNeedAnalysisProvider();
    await expect(
      analyzer.generate({
        instructionKey: 'need.analysis.v1',
        input: {
          fixtureKey: 'ANALYSIS_FAILURE_V1',
          transcript: analysisFailureTranscript.text,
        },
      }, context),
    ).rejects.toMatchObject({ code: 'ANALYSIS_FIXTURE_FAILED' });
  });
});
