import {
  rolesPageSchema,
  sessionContextSchema,
  usersPageSchema,
  type DataScopeKind,
  type PageInfo,
  type RoleListItem,
  type RoleSummary,
  type SessionAccessContext,
  type SessionContext as SharedSessionContext,
  type UserSummary
} from '@eldercare/contracts';

export type AuthSession = SharedSessionContext;
export type SessionContext = SessionAccessContext;
export type AdminUserSummary = UserSummary;
export type AdminRoleSummary = RoleListItem;
export type { DataScopeKind, PageInfo, RoleSummary };

export interface PaginatedResponse<T> {
  items: T[];
  pageInfo: PageInfo;
}

export class ContractValidationError extends Error {
  constructor(contractName: string) {
    super(`Invalid ${contractName} response`);
    this.name = 'ContractValidationError';
  }
}

export function parseAuthSession(value: unknown): AuthSession {
  const parsed = sessionContextSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractValidationError('auth session');
  }

  return parsed.data;
}

export function parseAdminUsers(value: unknown): PaginatedResponse<AdminUserSummary> {
  const parsed = usersPageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractValidationError('admin users');
  }

  return parsed.data;
}

export function parseAdminRoles(value: unknown): PaginatedResponse<AdminRoleSummary> {
  const parsed = rolesPageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContractValidationError('admin roles');
  }

  return parsed.data;
}
