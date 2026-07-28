import {
  completionChecklistSnapshotSchema,
  HIGH_RISK_COMPLETION_CHECKLIST_CODES,
  type CompletionChecklistCode,
  type CompletionChecklistRiskReason,
  type CompletionChecklistSnapshot,
  type WorkOrderCompletionRequest,
} from '@eldercare/contracts';
import type { Prisma } from '@eldercare/db';

import { m03Conflict } from './m03-errors.js';

export interface CompletionRiskFacts {
  readonly priority: string;
  readonly primaryNeed: {
    readonly category: string;
    readonly requiresHumanReview: boolean;
    readonly safetyRuleCodes: unknown;
  };
}

export interface CompletionChecklistRequirement {
  readonly required: boolean;
  readonly riskReasons: readonly CompletionChecklistRiskReason[];
  readonly expectedCodes: readonly CompletionChecklistCode[];
}

export function completionChecklistRequirement(
  facts: CompletionRiskFacts,
): CompletionChecklistRequirement {
  const riskReasons: CompletionChecklistRiskReason[] = [];
  if (facts.priority === 'IMMEDIATE_REVIEW') {
    riskReasons.push('PRIORITY_IMMEDIATE_REVIEW');
  }
  if (facts.primaryNeed.requiresHumanReview) {
    riskReasons.push('NEED_REQUIRES_HUMAN_REVIEW');
  }
  if (facts.primaryNeed.category === 'HEALTH_CONCERN') {
    riskReasons.push('NEED_CATEGORY_HEALTH_CONCERN');
  }
  if (facts.primaryNeed.category === 'EMERGENCY_CONCERN') {
    riskReasons.push('NEED_CATEGORY_EMERGENCY_CONCERN');
  }
  if (
    Array.isArray(facts.primaryNeed.safetyRuleCodes) &&
    facts.primaryNeed.safetyRuleCodes.some((code) => typeof code === 'string' && code.length > 0)
  ) {
    riskReasons.push('SAFETY_RULE_PRESENT');
  }
  return {
    required: riskReasons.length > 0,
    riskReasons,
    expectedCodes: riskReasons.length > 0 ? [...HIGH_RISK_COMPLETION_CHECKLIST_CODES] : [],
  };
}

export function assertCompletionChecklistInput(
  requirement: CompletionChecklistRequirement,
  input: WorkOrderCompletionRequest['completionChecklist'],
): void {
  if (!requirement.required) {
    if (input !== undefined) throw m03Conflict('COMPLETION_CHECKLIST_NOT_ALLOWED');
    return;
  }
  if (input === undefined) throw m03Conflict('COMPLETION_CHECKLIST_REQUIRED');
  const submittedCodes = new Set(input.map((item) => item.code));
  if (
    submittedCodes.size !== requirement.expectedCodes.length ||
    requirement.expectedCodes.some((code) => !submittedCodes.has(code))
  ) {
    throw m03Conflict('COMPLETION_CHECKLIST_INCOMPLETE');
  }
}

export function createCompletionChecklistSnapshot(
  requirement: CompletionChecklistRequirement,
  input: WorkOrderCompletionRequest['completionChecklist'],
  confirmedAt: Date,
): CompletionChecklistSnapshot {
  assertCompletionChecklistInput(requirement, input);
  const confirmedAtIso = confirmedAt.toISOString();
  return {
    schemaVersion: 1,
    required: requirement.required,
    riskReasons: [...requirement.riskReasons],
    expectedCodes: [...requirement.expectedCodes],
    confirmations: requirement.expectedCodes.map((code) => ({
      code,
      confirmed: true,
      confirmedAt: confirmedAtIso,
    })),
  };
}

export function normalizedCompletionChecklistCodes(
  input: WorkOrderCompletionRequest['completionChecklist'],
): readonly CompletionChecklistCode[] {
  if (input === undefined) return [];
  const submittedCodes = new Set(input.map((item) => item.code));
  return HIGH_RISK_COMPLETION_CHECKLIST_CODES.filter((code) => submittedCodes.has(code));
}

export function persistedCompletionChecklistMatches(
  value: Prisma.JsonValue,
  input: WorkOrderCompletionRequest['completionChecklist'],
): boolean {
  const parsed = completionChecklistSnapshotSchema.safeParse(value);
  if (!parsed.success) return false;
  const expectedInputCodes = normalizedCompletionChecklistCodes(input);
  return parsed.data.required === (input !== undefined) &&
    parsed.data.expectedCodes.length === expectedInputCodes.length &&
    parsed.data.expectedCodes.every((code, index) => code === expectedInputCodes[index]) &&
    parsed.data.confirmations.every((item, index) => item.code === expectedInputCodes[index]);
}
