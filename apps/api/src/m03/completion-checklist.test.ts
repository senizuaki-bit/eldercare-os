import { HIGH_RISK_COMPLETION_CHECKLIST_CODES } from '@eldercare/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertCompletionChecklistInput,
  completionChecklistRequirement,
  createCompletionChecklistSnapshot,
  persistedCompletionChecklistMatches,
} from './completion-checklist.js';

const lowRiskFacts = {
  priority: 'ROUTINE',
  primaryNeed: {
    category: 'DAILY_LIVING',
    requiresHumanReview: false,
    safetyRuleCodes: [],
  },
} as const;

const fullConfirmation = HIGH_RISK_COMPLETION_CHECKLIST_CODES.map((code) => ({
  code,
  confirmed: true as const,
}));

describe('high-risk completion checklist', () => {
  it('classifies a manual health need as high risk even without a flag or immediate priority', () => {
    expect(completionChecklistRequirement({
      ...lowRiskFacts,
      primaryNeed: { ...lowRiskFacts.primaryNeed, category: 'HEALTH_CONCERN' },
    })).toEqual({
      required: true,
      riskReasons: ['NEED_CATEGORY_HEALTH_CONCERN'],
      expectedCodes: [...HIGH_RISK_COMPLETION_CHECKLIST_CODES],
    });
  });

  it('classifies human-review, emergency, immediate, and safety-rule facts deterministically', () => {
    expect(completionChecklistRequirement({
      priority: 'IMMEDIATE_REVIEW',
      primaryNeed: {
        category: 'EMERGENCY_CONCERN',
        requiresHumanReview: true,
        safetyRuleCodes: ['EMERGENCY_CONCERN_REQUIRES_DETERMINISTIC_REVIEW'],
      },
    }).riskReasons).toEqual([
      'PRIORITY_IMMEDIATE_REVIEW',
      'NEED_REQUIRES_HUMAN_REVIEW',
      'NEED_CATEGORY_EMERGENCY_CONCERN',
      'SAFETY_RULE_PRESENT',
    ]);
  });

  it('rejects a missing or partial high-risk checklist before persistence', () => {
    const requirement = completionChecklistRequirement({
      ...lowRiskFacts,
      primaryNeed: { ...lowRiskFacts.primaryNeed, requiresHumanReview: true },
    });
    expect(() => assertCompletionChecklistInput(requirement, undefined)).toThrow();
    expect(() => assertCompletionChecklistInput(requirement, fullConfirmation.slice(0, 2))).toThrow();
  });

  it('creates a versioned canonical snapshot for a complete confirmation', () => {
    const requirement = completionChecklistRequirement({
      ...lowRiskFacts,
      primaryNeed: { ...lowRiskFacts.primaryNeed, category: 'HEALTH_CONCERN' },
    });
    const confirmedAt = new Date('2026-07-22T08:00:00.000Z');
    const snapshot = createCompletionChecklistSnapshot(requirement, fullConfirmation, confirmedAt);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      required: true,
      riskReasons: ['NEED_CATEGORY_HEALTH_CONCERN'],
      expectedCodes: [...HIGH_RISK_COMPLETION_CHECKLIST_CODES],
      confirmations: HIGH_RISK_COMPLETION_CHECKLIST_CODES.map((code) => ({
        code,
        confirmed: true,
        confirmedAt: confirmedAt.toISOString(),
      })),
    });
    expect(persistedCompletionChecklistMatches(snapshot, fullConfirmation)).toBe(true);
  });

  it('requires low-risk clients to omit the checklist and records an empty snapshot', () => {
    const requirement = completionChecklistRequirement(lowRiskFacts);
    expect(() => assertCompletionChecklistInput(requirement, [])).toThrow();
    const snapshot = createCompletionChecklistSnapshot(
      requirement,
      undefined,
      new Date('2026-07-22T08:00:00.000Z'),
    );
    expect(snapshot).toEqual({
      schemaVersion: 1,
      required: false,
      riskReasons: [],
      expectedCodes: [],
      confirmations: [],
    });
    expect(persistedCompletionChecklistMatches(snapshot, undefined)).toBe(true);
  });
});
