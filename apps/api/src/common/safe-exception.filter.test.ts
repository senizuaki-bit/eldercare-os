import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { errorEnvelopeSchema } from '@eldercare/contracts';
import { describe, expect, it } from 'vitest';
import { createSafeErrorEnvelope } from './safe-exception.filter.js';

describe('createSafeErrorEnvelope', () => {
  it('never exposes a sensitive 5xx message or non-contract fields', () => {
    const result = createSafeErrorEnvelope(
      new InternalServerErrorException('postgresql://admin:topsecret@db/internal'),
      'corr-safe-1234'
    );

    expect(result.status).toBe(500);
    expect(errorEnvelopeSchema.parse(result.body)).toEqual(result.body);
    expect(JSON.stringify(result.body)).not.toMatch(/topsecret|postgresql|stack|path/i);
    expect(result.body.error.message).toBe('服务暂时不可用');
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('does not echo arbitrary client exception messages', () => {
    const result = createSafeErrorEnvelope(
      new ForbiddenException('account alice@example.test cannot read secret-record-22'),
      'corr-safe-5678',
    );

    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: '当前身份无权执行此操作',
    });
    expect(JSON.stringify(result.body)).not.toMatch(/alice|secret-record/i);
  });
});
