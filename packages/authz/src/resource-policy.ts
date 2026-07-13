import type {
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationTarget,
} from './types.js';

export type ResourceRelationshipKind =
  | 'LINKED_ELDER'
  | 'ASSIGNED_CAREGIVER'
  | 'ACTIVE_SHIFT';

export interface ResourceRelationshipInput {
  readonly context: AuthorizationContext;
  readonly target: AuthorizationTarget;
  readonly now: Date;
}

export interface ResourceRelationshipResolver {
  readonly kind: ResourceRelationshipKind;
  isRelated(input: ResourceRelationshipInput): Promise<boolean>;
}

export interface ResourcePolicyInput extends ResourceRelationshipInput {
  readonly action: string;
  readonly subject: string;
}

export interface ResourcePolicy {
  readonly subject: string;
  authorize(input: ResourcePolicyInput): Promise<AuthorizationDecision>;
}

export class ResourcePolicyRegistry {
  readonly #policies = new Map<string, ResourcePolicy>();

  register(policy: ResourcePolicy): void {
    if (this.#policies.has(policy.subject)) {
      throw new Error(`A resource policy is already registered for ${policy.subject}`);
    }
    this.#policies.set(policy.subject, policy);
  }

  async authorize(input: ResourcePolicyInput): Promise<AuthorizationDecision> {
    const policy = this.#policies.get(input.subject);
    if (policy === undefined) {
      return { allowed: false, reasonCode: 'RESOURCE_POLICY_MISSING' };
    }
    return policy.authorize(input);
  }
}

export class ResourceRelationshipRegistry {
  readonly #resolvers = new Map<ResourceRelationshipKind, ResourceRelationshipResolver>();

  register(resolver: ResourceRelationshipResolver): void {
    if (this.#resolvers.has(resolver.kind)) {
      throw new Error(`A relationship resolver is already registered for ${resolver.kind}`);
    }
    this.#resolvers.set(resolver.kind, resolver);
  }

  async isRelated(
    kind: ResourceRelationshipKind,
    input: ResourceRelationshipInput,
  ): Promise<boolean> {
    return (await this.#resolvers.get(kind)?.isRelated(input)) ?? false;
  }
}
