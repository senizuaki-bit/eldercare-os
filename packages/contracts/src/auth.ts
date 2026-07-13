import { z } from 'zod';

import { isoTimestampSchema, uuidSchema } from './common.js';

export const loginNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(96)
  .regex(/^[\p{L}\p{N}._-]+$/u, 'contains unsupported characters');
export const organizationSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
export const permissionCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);
export const roleCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const loginRequestSchema = z
  .object({
    loginName: loginNameSchema,
    password: z.string().min(1).max(256),
  })
  .strict();

export const authenticatedUserSchema = z
  .object({
    id: uuidSchema,
    username: loginNameSchema,
    displayName: z.string().min(1).max(128),
  })
  .strict();

export const activeOrganizationSchema = z
  .object({
    id: uuidSchema,
    slug: organizationSlugSchema,
    name: z.string().min(1).max(160),
  })
  .strict();

export const sessionAccessContextSchema = z
  .object({
    organizationId: uuidSchema,
    organizationName: z.string().min(1).max(160),
    facilityId: uuidSchema.nullable(),
    facilityName: z.string().min(1).max(160).nullable(),
  })
  .strict();

export const sessionRoleSchema = z
  .object({
    key: roleCodeSchema,
    label: z.string().min(1).max(128),
  })
  .strict();

export const sessionContextSchema = z
  .object({
    user: authenticatedUserSchema,
    activeContext: sessionAccessContextSchema,
    availableContexts: z.array(sessionAccessContextSchema).min(1).max(128),
    roles: z.array(sessionRoleSchema).min(1).max(64),
    permissions: z.array(permissionCodeSchema).max(512),
    portal: z.enum(['admin', 'elder', 'caregiver', 'family']),
    expiresAt: isoTimestampSchema,
  })
  .strict();

export const switchContextRequestSchema = z
  .object({
    organizationId: uuidSchema,
    facilityId: uuidSchema.nullable(),
  })
  .strict();

export const csrfResponseSchema = z
  .object({ csrfToken: z.string().min(32).max(256) })
  .strict();

export const logoutResponseSchema = z.object({ loggedOut: z.literal(true) }).strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type SessionContext = z.infer<typeof sessionContextSchema>;
export type SessionAccessContext = z.infer<typeof sessionAccessContextSchema>;
export type SwitchContextRequest = z.infer<typeof switchContextRequestSchema>;
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
