import { HttpException } from '@nestjs/common';
import type { ErrorDetail } from '@eldercare/contracts';

export class SafeHttpException extends HttpException {
  constructor(
    status: number,
    readonly safeCode: string,
    readonly safeMessage: string,
    readonly safeDetails?: readonly ErrorDetail[],
  ) {
    super({ code: safeCode }, status);
  }
}
