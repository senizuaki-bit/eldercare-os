import { z } from 'zod';

import { ConfigValidationError, type Environment } from './shared.js';

function usesHttpProtocol(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const browserConfigSchema = z
  .object({
    NEXT_PUBLIC_API_BASE_URL: z
      .string()
      .url()
      .refine(usesHttpProtocol, {
        message: 'must use http or https',
      }),
  })
  .transform((value) => ({
    apiBaseUrl: value.NEXT_PUBLIC_API_BASE_URL,
  }));

export type BrowserConfig = z.output<typeof browserConfigSchema>;

export function parseBrowserConfig(environment: Environment): BrowserConfig {
  const result = browserConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigValidationError(
      'browser',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  return result.data;
}
