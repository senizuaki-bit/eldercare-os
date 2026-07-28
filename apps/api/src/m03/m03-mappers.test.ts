import { describe, expect, it } from 'vitest';

import { mapWorkOrderDetail, type WorkOrderRecord } from './m03-mappers.js';

const organizationId = '10000000-0000-4000-8000-000000000002';
const facilityId = '20000000-0000-4000-8000-000000000001';
const elderId = '30000000-0000-4000-8000-000000000001';
const needId = '40000000-0000-4000-8000-000000000001';
const analysisId = '41000000-0000-4000-8000-000000000001';
const transcriptId = '42000000-0000-4000-8000-000000000001';
const workOrderId = '50000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-07-22T08:00:00.000Z');

describe('M03 work-order admin detail retention projection', () => {
  it('does not project analysis whose retention deadline has elapsed but cleanup has not run', () => {
    const detail = mapWorkOrderDetail(workOrderRecord({
      retentionUntil: new Date('2000-07-22T08:00:00.000Z'),
    }), []);

    expect(detail.analysis).toBeNull();
  });

  it('does not project analysis whose retained content has already been deleted', () => {
    const detail = mapWorkOrderDetail(workOrderRecord({
      contentDeletedAt: new Date('2026-07-22T08:05:00.000Z'),
      retentionUntil: new Date('2099-07-22T08:00:00.000Z'),
    }), []);

    expect(detail.analysis).toBeNull();
  });

  it('continues to project unexpired, non-deleted analysis metadata', () => {
    const detail = mapWorkOrderDetail(workOrderRecord({
      retentionUntil: new Date('2099-07-22T08:00:00.000Z'),
    }), []);

    expect(detail.analysis).toEqual(expect.objectContaining({
      id: analysisId,
      status: 'PENDING',
    }));
  });

  it('does not project analysis after either required voice consent is withdrawn', () => {
    const detail = mapWorkOrderDetail(workOrderRecord(
      { retentionUntil: new Date('2099-07-22T08:00:00.000Z') },
      'WITHDRAWN',
    ), []);

    expect(detail.analysis).toBeNull();
  });
});

function workOrderRecord(
  analysisOverrides: Partial<WorkOrderRecord['primaryNeed']['aiAnalysis'] & object>,
  analysisConsentDecision: 'GRANTED' | 'WITHDRAWN' = 'GRANTED',
): WorkOrderRecord {
  const analysis = {
    id: analysisId,
    organizationId,
    facilityId,
    elderId,
    transcriptId,
    status: 'PENDING',
    output: null,
    confidence: null,
    evidence: [],
    provider: 'deterministic-fake',
    model: 'fake-transcription-v1',
    promptVersion: 'm03-v1',
    schemaVersion: 'm03-v1',
    failureCode: null,
    retentionUntil: new Date('2099-07-22T08:00:00.000Z'),
    contentDeletedAt: null,
    correlationId: 'm03-mapper-retention-test',
    version: 1,
    createdAt,
    completedAt: null,
    ...analysisOverrides,
  };
  return {
    id: workOrderId,
    organizationId,
    facilityId,
    elderId,
    primaryNeedId: needId,
    code: 'WO-MAPPER-001',
    title: 'Mapper retention fixture',
    summary: 'Mapper retention fixture',
    priority: 'ROUTINE',
    status: 'NEW',
    dueAt: new Date('2099-07-22T09:00:00.000Z'),
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    verifiedAt: null,
    closedAt: null,
    cancelledAt: null,
    correlationId: 'm03-mapper-retention-test',
    version: 1,
    createdAt,
    updatedAt: createdAt,
    assignments: [],
    transitions: [],
    arrivals: [],
    completion: null,
    familySummary: null,
    ratings: [],
    primaryNeed: {
      id: needId,
      organizationId,
      facilityId,
      elderId,
      voiceSubmissionId: null,
      aiAnalysisId: analysisId,
      source: 'VOICE',
      summary: 'Mapper retention fixture',
      category: 'OTHER',
      urgencySuggestion: 'ROUTINE',
      priority: 'ROUTINE',
      requiresHumanReview: false,
      safetyRuleCodes: [],
      status: 'NEW',
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReasonCode: null,
      correlationId: 'm03-mapper-retention-test',
      version: 1,
      createdAt,
      updatedAt: createdAt,
      aiAnalysis: analysis,
    },
    elder: {
      id: elderId,
      displayName: '演示长者',
      preferredName: null,
      recordNumber: 'DEMO-MAPPER-001',
      consentRecords: [
        {
          purpose: 'VOICE_CAPTURE',
          decision: 'GRANTED',
          consentVersion: 1,
          effectiveAt: createdAt,
          expiresAt: null,
        },
        {
          purpose: 'TRANSCRIPTION_AI_ANALYSIS',
          decision: analysisConsentDecision,
          consentVersion: analysisConsentDecision === 'GRANTED' ? 1 : 2,
          effectiveAt: createdAt,
          expiresAt: null,
        },
      ],
      stays: [],
    },
  } as unknown as WorkOrderRecord;
}
