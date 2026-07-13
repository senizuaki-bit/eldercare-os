import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { ErrorEnvelope } from '@eldercare/contracts';
import type { Response } from 'express';
import { SafeHttpException } from './safe-http.exception.js';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const { body, status } = createSafeErrorEnvelope(
      exception,
      String(response.locals.correlationId ?? 'unknown-correlation')
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
  const safeException = exception instanceof SafeHttpException ? exception : undefined;
  const defaults = defaultErrorForStatus(status);

  return {
    status,
    body: {
      error: {
        code: safeException?.safeCode ?? defaults.code,
        message: safeException?.safeMessage ?? defaults.message,
        correlationId,
        ...(safeException?.safeDetails === undefined
          ? {}
          : { details: [...safeException.safeDetails] }),
      },
      timestamp: new Date().toISOString(),
    },
  };
}

function defaultErrorForStatus(status: number): { code: string; message: string } {
  if (status === Number(HttpStatus.BAD_REQUEST)) {
    return { code: 'INVALID_REQUEST', message: '请检查请求内容' };
  }
  if (status === Number(HttpStatus.UNAUTHORIZED)) {
    return { code: 'UNAUTHENTICATED', message: '登录状态无效或已过期' };
  }
  if (status === Number(HttpStatus.FORBIDDEN)) {
    return { code: 'FORBIDDEN', message: '当前身份无权执行此操作' };
  }
  if (status === Number(HttpStatus.NOT_FOUND)) {
    return { code: 'RESOURCE_NOT_FOUND', message: '记录不存在或不可访问' };
  }
  if (status === Number(HttpStatus.CONFLICT)) {
    return { code: 'CONFLICT', message: '当前数据已发生变化，请刷新后重试' };
  }
  if (status === Number(HttpStatus.TOO_MANY_REQUESTS)) {
    return { code: 'RATE_LIMITED', message: '尝试次数过多，请稍后再试' };
  }
  if (status >= 500) {
    return { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用' };
  }
  return { code: `HTTP_${status}`, message: '请求无法完成' };
}
