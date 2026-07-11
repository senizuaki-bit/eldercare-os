export type Environment = Readonly<Record<string, string | undefined>>;

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(scope: 'service' | 'browser', issues: readonly ConfigIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path || 'configuration'}: ${issue.message}`)
      .join('; ');
    super(`Invalid ${scope} configuration: ${summary}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}
