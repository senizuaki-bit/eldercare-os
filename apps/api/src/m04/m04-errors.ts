import { HttpStatus } from '@nestjs/common';
import { SafeHttpException } from '../common/safe-http.exception.js';

export function m04BadRequest(
  code: string,
  message = '请求内容不符合紧急事件规则',
): SafeHttpException {
  return new SafeHttpException(HttpStatus.BAD_REQUEST, code, message);
}

export function m04Conflict(
  code: string,
  message = '紧急事件已发生变化，请刷新后重试',
): SafeHttpException {
  return new SafeHttpException(HttpStatus.CONFLICT, code, message);
}

export function m04Forbidden(
  code: string,
  message = '当前身份无权执行该紧急事件操作',
): SafeHttpException {
  return new SafeHttpException(HttpStatus.FORBIDDEN, code, message);
}
