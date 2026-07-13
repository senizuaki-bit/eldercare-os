import { describe, expect, it } from 'vitest';

import { ResourcePolicyRegistry, ResourceRelationshipRegistry } from './resource-policy.js';
import type { AuthorizationContext } from './types.js';

const context: AuthorizationContext = {
  actorId: 'user-1',
  organizationId: 'org-1',
  roles: ['FAMILY'],
  permissions: [],
  scopes: [],
};
const input = {
  action: 'read',
  subject: 'elder',
  context,
  target: { organizationId: 'org-1', resourceType: 'elder', resourceId: 'elder-1' },
  now: new Date('2026-07-12T00:00:00.000Z'),
};

describe('resource extension points', () => {
  it('denies when a future resource policy is not registered', async () => {
    await expect(new ResourcePolicyRegistry().authorize(input)).resolves.toEqual({
      allowed: false,
      reasonCode: 'RESOURCE_POLICY_MISSING',
    });
  });

  it('denies an unresolved relationship and uses an explicit resolver when registered', async () => {
    const registry = new ResourceRelationshipRegistry();
    for (const kind of ['LINKED_ELDER', 'ASSIGNED_CAREGIVER', 'ACTIVE_SHIFT'] as const) {
      await expect(registry.isRelated(kind, input)).resolves.toBe(false);
    }

    registry.register({ kind: 'LINKED_ELDER', isRelated: () => Promise.resolve(true) });
    await expect(registry.isRelated('LINKED_ELDER', input)).resolves.toBe(true);
  });
});
