import { z } from 'zod';

import { isoTimestampSchema, pageInfoSchema, uuidSchema } from './common.js';

export const auditActorTypeSchema = z.enum(['USER', 'ANONYMOUS', 'SYSTEM']);
export const auditOutcomeSchema = z.enum(['SUCCESS', 'DENIED', 'FAILURE']);
const auditIdentifierSchema = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const auditEventSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema.nullable(),
    actorUserId: uuidSchema.nullable(),
    actorType: auditActorTypeSchema,
    action: auditIdentifierSchema(128),
    outcome: auditOutcomeSchema,
    resourceType: auditIdentifierSchema(64).nullable(),
    resourceId: auditIdentifierSchema(128).nullable(),
    reasonCode: auditIdentifierSchema(96).nullable(),
    correlationId: auditIdentifierSchema(128).refine((value) => value.length >= 8, {
      message: 'must contain at least 8 characters',
    }),
    safeMetadata: z.record(z.string().min(1).max(64), z.unknown()),
    occurredAt: isoTimestampSchema,
  })
  .strict();

export const auditEventsPageSchema = z
  .object({ items: z.array(auditEventSchema), pageInfo: pageInfoSchema })
  .strict();

export const auditEventsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    organizationId: uuidSchema.optional(),
    facilityId: uuidSchema.optional(),
    actorUserId: uuidSchema.optional(),
    action: auditIdentifierSchema(128).optional(),
    outcome: auditOutcomeSchema.optional(),
    correlationId: auditIdentifierSchema(128)
      .refine((value) => value.length >= 8, { message: 'must contain at least 8 characters' })
      .optional(),
    occurredFrom: isoTimestampSchema.optional(),
    occurredTo: isoTimestampSchema.optional(),
  })
  .strict();

export type AuditActorType = z.infer<typeof auditActorTypeSchema>;
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventsPage = z.infer<typeof auditEventsPageSchema>;
export type AuditEventsQuery = z.output<typeof auditEventsQuerySchema>;
