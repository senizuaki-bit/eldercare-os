import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_CORRELATION_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

export function correlationIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header(CORRELATION_HEADER);
  const correlationId = supplied && SAFE_CORRELATION_ID.test(supplied) ? supplied : randomUUID();

  response.setHeader(CORRELATION_HEADER, correlationId);
  response.locals.correlationId = correlationId;
  (request as Request & { correlationId?: string }).correlationId = correlationId;
  next();
}

export function getCorrelationId(response: Response): string {
  return String(response.locals.correlationId ?? 'unknown-correlation');
}
