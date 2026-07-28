import { describe, expect, it } from 'vitest';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  allowedEmergencyTransitions,
  assertEmergencyCommandActor,
  assertEmergencyTransition,
  assertResponseMilestone,
} from './emergency-state-machine.js';

describe('M04 emergency state machine', () => {
  it('exposes only the documented linear transitions', () => {
    expect(allowedEmergencyTransitions('OPEN')).toEqual(['ACKNOWLEDGED']);
    expect(allowedEmergencyTransitions('ACKNOWLEDGED')).toEqual(['RESPONDING']);
    expect(allowedEmergencyTransitions('RESPONDING')).toEqual(['RESOLVED']);
    expect(allowedEmergencyTransitions('RESOLVED')).toEqual(['REVIEWED']);
    expect(allowedEmergencyTransitions('REVIEWED')).toEqual([]);
  });

  it.each([
    ['OPEN', 'ACKNOWLEDGED'],
    ['ACKNOWLEDGED', 'RESPONDING'],
    ['RESPONDING', 'RESOLVED'],
    ['RESOLVED', 'REVIEWED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertEmergencyTransition(from, to)).not.toThrow();
  });

  it.each([
    ['OPEN', 'RESPONDING'],
    ['ACKNOWLEDGED', 'RESOLVED'],
    ['RESPONDING', 'REVIEWED'],
    ['RESOLVED', 'ACKNOWLEDGED'],
    ['REVIEWED', 'OPEN'],
  ] as const)('rejects an attempted skipped or reverse transition %s -> %s', (from, to) => {
    expect(() => assertEmergencyTransition(from, to)).toThrowError(
      expect.objectContaining({ safeCode: 'INVALID_EMERGENCY_TRANSITION' }),
    );
  });

  it.each(['SYSTEM', 'DEVICE', 'AGENT', 'AI'] as const)(
    'prevents %s from resolving or reviewing an emergency',
    (actorType) => {
      for (const command of ['RESOLVE', 'REVIEW'] as const) {
        try {
          assertEmergencyCommandActor(command, actorType);
          throw new Error('expected actor check to fail');
        } catch (error) {
          expect(error).toBeInstanceOf(SafeHttpException);
          expect((error as SafeHttpException).safeCode).toBe('HUMAN_ACTOR_REQUIRED');
        }
      }
    },
  );

  it('accepts a human user for every state-changing command', () => {
    for (const command of [
      'ACKNOWLEDGE',
      'MARK_EN_ROUTE',
      'MARK_ON_SITE',
      'RESOLVE',
      'REVIEW',
    ] as const) {
      expect(() => assertEmergencyCommandActor(command, 'USER')).not.toThrow();
    }
  });

  it('requires en-route before on-site and prevents duplicate milestones', () => {
    expect(() =>
      assertResponseMilestone('ACKNOWLEDGED', 'EN_ROUTE', 'ACKNOWLEDGED'),
    ).not.toThrow();
    expect(() =>
      assertResponseMilestone('RESPONDING', 'ON_SITE', 'EN_ROUTE'),
    ).not.toThrow();
    expect(() =>
      assertResponseMilestone('ACKNOWLEDGED', 'ON_SITE', 'ACKNOWLEDGED'),
    ).toThrowError(expect.objectContaining({ safeCode: 'ON_SITE_NOT_ALLOWED' }));
    expect(() =>
      assertResponseMilestone('RESPONDING', 'EN_ROUTE', 'EN_ROUTE'),
    ).toThrowError(expect.objectContaining({ safeCode: 'EN_ROUTE_NOT_ALLOWED' }));
  });
});
