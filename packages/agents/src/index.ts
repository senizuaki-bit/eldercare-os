/** Restricted-agent contracts only. Routing and execution begin in later milestones. */
export type AgentRiskLevel = 'L0' | 'L1' | 'L2' | 'L3';
export type ApprovalPolicy = 'never' | 'user_confirmation' | 'human_approval';

export interface SchemaContract<T> {
  parse(input: unknown): T;
}

export interface ToolContext {
  readonly organizationId: string;
  readonly facilityId?: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly consentSnapshotIds: readonly string[];
  readonly approvalId?: string;
}

export interface AgentToolDefinition<TInput, TOutput> {
  readonly key: string;
  readonly version: string;
  readonly inputSchema: SchemaContract<TInput>;
  readonly outputSchema: SchemaContract<TOutput>;
  readonly requiredPermissions: readonly string[];
  readonly requiredConsents?: readonly string[];
  readonly riskLevel: AgentRiskLevel;
  readonly approvalPolicy: ApprovalPolicy;
  readonly idempotent: boolean;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

export interface AgentDescriptor {
  readonly key: string;
  readonly version: string;
  readonly allowedToolKeys: readonly string[];
}
