import { InternalServerErrorException } from '@nestjs/common';
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
  });
});
