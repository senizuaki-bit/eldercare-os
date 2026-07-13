import { HttpStatus } from '@nestjs/common';
import { SafeHttpException } from '../common/safe-http.exception.js';

export function m02Conflict(code = 'VERSION_CONFLICT'): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.CONFLICT,
    code,
    'The record changed. Refresh and try again.',
  );
}

export function m02InvalidState(code: string): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.CONFLICT,
    code,
    'The requested transition is not valid for the current state.',
  );
}

export function m02InvalidRequest(field: string, code: string): SafeHttpException {
  return new SafeHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_REQUEST',
    'Please check the request.',
    [{ field, code }],
  );
}
