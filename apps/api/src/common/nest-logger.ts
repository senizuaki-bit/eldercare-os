import type { LoggerService } from '@nestjs/common';
import type { LogLevel, Logger } from '@eldercare/observability';
import { createLogger } from '@eldercare/observability';

export class SafeNestLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(level: LogLevel) {
    this.logger = createLogger({ service: 'api', level });
  }

  log(message: unknown, context?: string): void {
    this.logger.info(toSafeMessage(message), context === undefined ? undefined : { context });
  }

  error(message: unknown, _stack?: string, context?: string): void {
    this.logger.error(toSafeMessage(message), context === undefined ? undefined : { context });
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(toSafeMessage(message), context === undefined ? undefined : { context });
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(toSafeMessage(message), context === undefined ? undefined : { context });
  }

  verbose(message: unknown, context?: string): void {
    this.logger.debug(toSafeMessage(message), context === undefined ? undefined : { context });
  }
}

function toSafeMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  return 'Framework event';
}
