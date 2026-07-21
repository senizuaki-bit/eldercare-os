import { z } from 'zod';

export const isoTimestampSchema = z.string().datetime({ offset: true });
export const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a safe identifier');
export const uuidSchema = z.string().uuid();
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export const versionSchema = z.number().int().min(1);
export const dateOnlySchema = z.string().date();
export const recordCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a safe record code');
export const displayTextSchema = z.string().trim().min(1).max(160);
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'must be a safe idempotency key');

export const pageInfoSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
  .strict();

export type PageInfo = z.infer<typeof pageInfoSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
