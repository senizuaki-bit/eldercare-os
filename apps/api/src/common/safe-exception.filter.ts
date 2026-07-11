import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { ErrorEnvelope } from '@eldercare/contracts';
import type { Response } from 'express';

type ExceptionBody = { message?: string | string[]; error?: string };

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const { body, status } = createSafeErrorEnvelope(
      exception,
      String(response.locals.correlationId ?? 'unknown')
    );
    response.status(status).json(body);
  }
}

export function createSafeErrorEnvelope(
  exception: unknown,
  correlationId: string
): { status: number; body: ErrorEnvelope } {
  const isHttpException = exception instanceof HttpException;
  const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const raw = isHttpException ? exception.getResponse() : undefined;
  const body = typeof raw === 'object' && raw !== null ? (raw as ExceptionBody) : undefined;
  const rawMessage = body?.message;
  const clientSafeMessage = Array.isArray(rawMessage)
    ? rawMessage.join('; ')
    : rawMessage ?? '请求无法完成';

  return {
    status,
    body: {
      error: {
        code: `HTTP_${status}`,
        message: status >= 500 ? '服务暂时不可用' : clientSafeMessage,
        correlationId
      },
      timestamp: new Date().toISOString()
    }
  };
}
