import { HttpStatus } from '@nestjs/common';
import { SafeHttpException } from '../common/safe-http.exception.js';

export function m03BadRequest(code: string, message = '请求内容不符合需求工单规则'): SafeHttpException {
  return new SafeHttpException(HttpStatus.BAD_REQUEST, code, message);
}
export function m03Conflict(code: string, message = '记录已变化，请刷新后重试'): SafeHttpException {
  return new SafeHttpException(HttpStatus.CONFLICT, code, message);
}

export function m03Unprocessable(code: string, message = '当前内容无法自动处理，已保留人工处理路径'): SafeHttpException {
  return new SafeHttpException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}
