import { z } from 'zod';

import { isoTimestampSchema, pageInfoSchema, uuidSchema } from './common.js';
import {
  loginNameSchema,
  organizationSlugSchema,
  permissionCodeSchema,
  roleCodeSchema,
} from './auth.js';

export const userStatusSchema = z.enum(['ACTIVE', 'LOCKED', 'DISABLED']);
export const organizationStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
export const facilityStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
export const dataScopeKindSchema = z.enum([
  'PLATFORM',
  'ORGANIZATION',
  'FACILITY',
  'FLOOR',
  'CARE_TEAM',
  'ASSIGNED_ELDER',
  'ACTIVE_SHIFT',
  'LINKED_ELDER',
  'OWN_RECORD',
]);
const scopeKeySchema = z
  .string()
  .min(1)
  .max(192)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const resourceTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const organizationSummarySchema = z
  .object({
    id: uuidSchema,
    slug: organizationSlugSchema,
    name: z.string().min(1).max(160),
    status: organizationStatusSchema,
  })
  .strict();

export const facilitySummarySchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(64),
    status: facilityStatusSchema,
  })
  .strict();

export const dataScopeSchema = z
  .object({
    id: uuidSchema,
    kind: dataScopeKindSchema,
    scopeKey: scopeKeySchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema.nullable(),
    resourceType: resourceTypeSchema.nullable(),
    resourceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .nullable(),
    validFrom: isoTimestampSchema,
    validUntil: isoTimestampSchema.nullable(),
  })
  .strict();

export const roleSummarySchema = z
  .object({
    id: uuidSchema,
    code: roleCodeSchema,
    name: z.string().min(1).max(128),
    description: z.string().max(512).nullable(),
    isSystem: z.boolean(),
    permissions: z.array(permissionCodeSchema).max(512),
  })
  .strict();

export const roleListItemSchema = roleSummarySchema
  .extend({
    assignedUserCount: z.number().int().min(0),
    scopeKinds: z.array(dataScopeKindSchema).max(32),
  })
  .strict();

export const userRoleAssignmentSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    role: roleSummarySchema,
    scopes: z.array(dataScopeSchema).max(256),
    activeFrom: isoTimestampSchema,
    expiresAt: isoTimestampSchema.nullable(),
  })
  .strict();

export const userSummarySchema = z
  .object({
    id: uuidSchema,
    loginName: loginNameSchema,
    displayName: z.string().min(1).max(128),
    status: userStatusSchema,
    lastLoginAt: isoTimestampSchema.nullable(),
    accessVersion: z.number().int().min(1),
    assignments: z.array(userRoleAssignmentSchema).max(128),
  })
  .strict();

export const usersPageSchema = z
  .object({ items: z.array(userSummarySchema), pageInfo: pageInfoSchema })
  .strict();
export const rolesPageSchema = z
  .object({ items: z.array(roleListItemSchema), pageInfo: pageInfoSchema })
  .strict();

export const usersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    organizationId: uuidSchema.optional(),
    facilityId: uuidSchema.optional(),
    status: userStatusSchema.optional(),
    sort: z.enum(['loginName', 'displayName', 'status', 'lastLoginAt']).default('displayName'),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const rolesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(128).optional(),
    sort: z.enum(['code', 'name', 'assignedUserCount']).default('name'),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const accessScopeInputSchema = z
  .object({
    kind: dataScopeKindSchema,
    scopeKey: scopeKeySchema,
    facilityId: uuidSchema.optional(),
    resourceType: resourceTypeSchema.optional(),
    resourceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .optional(),
    validFrom: isoTimestampSchema.optional(),
    validUntil: isoTimestampSchema.optional(),
  })
  .strict()
  .superRefine((scope, context) => {
    const hasFacility = scope.facilityId !== undefined;
    const hasResourceType = scope.resourceType !== undefined;
    const hasResourceId = scope.resourceId !== undefined;
    const isTenantWide = ['PLATFORM', 'ORGANIZATION', 'OWN_RECORD'].includes(scope.kind);
    const isFacilityBound = ['FACILITY', 'ACTIVE_SHIFT'].includes(scope.kind);
    const isResourceBound = ['FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'LINKED_ELDER'].includes(
      scope.kind,
    );

    if (isTenantWide && (hasFacility || hasResourceType || hasResourceId)) {
      context.addIssue({
        code: 'custom',
        message: `${scope.kind} scope cannot include facility or resource fields`,
      });
    }
    if (isFacilityBound && (!hasFacility || hasResourceType || hasResourceId)) {
      context.addIssue({
        code: 'custom',
        message: `${scope.kind} scope requires only facilityId`,
      });
    }
    if (scope.kind === 'ACTIVE_SHIFT' && scope.validUntil === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'ACTIVE_SHIFT scope requires a bounded validUntil',
      });
    }
    if (isResourceBound && (!hasFacility || !hasResourceType || !hasResourceId)) {
      context.addIssue({
        code: 'custom',
        message: `${scope.kind} scope requires facilityId, resourceType and resourceId`,
      });
    }
    if (
      scope.validFrom !== undefined &&
      scope.validUntil !== undefined &&
      Date.parse(scope.validUntil) <= Date.parse(scope.validFrom)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'must be later than validFrom',
      });
    }
  });

export const accessAssignmentInputSchema = z
  .object({
    roleId: uuidSchema,
    activeFrom: isoTimestampSchema.optional(),
    expiresAt: isoTimestampSchema.optional(),
    scopes: z.array(accessScopeInputSchema).min(1).max(128),
  })
  .strict()
  .superRefine((assignment, context) => {
    if (
      assignment.activeFrom !== undefined &&
      assignment.expiresAt !== undefined &&
      Date.parse(assignment.expiresAt) <= Date.parse(assignment.activeFrom)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'must be later than activeFrom',
      });
    }

    const scopeKeys = new Set<string>();
    for (const [index, scope] of assignment.scopes.entries()) {
      if (scopeKeys.has(scope.scopeKey)) {
        context.addIssue({
          code: 'custom',
          path: ['scopes', index, 'scopeKey'],
          message: 'must be unique within an assignment',
        });
      }
      scopeKeys.add(scope.scopeKey);
    }
  });

export const replaceUserAccessRequestSchema = z
  .object({
    organizationId: uuidSchema,
    expectedAccessVersion: z.number().int().min(1),
    assignments: z.array(accessAssignmentInputSchema).max(32),
  })
  .strict();

export type UserStatus = z.infer<typeof userStatusSchema>;
export type DataScopeKind = z.infer<typeof dataScopeKindSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type RoleSummary = z.infer<typeof roleSummarySchema>;
export type RoleListItem = z.infer<typeof roleListItemSchema>;
export type UsersPage = z.infer<typeof usersPageSchema>;
export type RolesPage = z.infer<typeof rolesPageSchema>;
export type UsersQuery = z.output<typeof usersQuerySchema>;
export type RolesQuery = z.output<typeof rolesQuerySchema>;
export type ReplaceUserAccessRequest = z.infer<typeof replaceUserAccessRequestSchema>;
