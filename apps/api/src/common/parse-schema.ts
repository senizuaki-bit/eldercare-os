import { HttpStatus } from '@nestjs/common';
import { SafeHttpException } from './safe-http.exception.js';

interface ParseIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
}

interface SafeParseSchema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: { readonly issues: readonly ParseIssue[] } };
}

export function parseSchema<T>(schema: SafeParseSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new SafeHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_REQUEST',
    '请检查请求内容',
    result.error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.map(String).join('.') || 'request',
      code: issue.code,
    })),
  );
}
