import { describe, expect, it, vi } from 'vitest';
import { SafeHttpException } from '../common/safe-http.exception.js';
import {
  assertVoiceUpload,
  MAX_VOICE_BYTES,
  ObjectStorageService,
} from './object-storage.service.js';

describe('M03 voice object policy', () => {
  it('accepts bounded supported audio', () => {
    expect(() => assertVoiceUpload('audio/wav', 44)).not.toThrow();
    expect(() => assertVoiceUpload('audio/webm', MAX_VOICE_BYTES)).not.toThrow();
  });

  it('rejects executable, empty and oversized objects', () => {
    expect(() => assertVoiceUpload('application/javascript', 100)).toThrow(SafeHttpException);
    expect(() => assertVoiceUpload('audio/wav', 0)).toThrow(SafeHttpException);
    expect(() => assertVoiceUpload('audio/wav', MAX_VOICE_BYTES + 1)).toThrow(SafeHttpException);
  });

  it('keeps client uploads in staging and accepts only unguessable sealed keys for reads', () => {
    const storage = storageService();
    const staging = storage.stagingObjectKey('org', 'facility', 'elder', 'submission');
    const sealed = storage.sealedObjectKey(
      'org',
      'facility',
      'elder',
      'submission',
      '70000000-0000-4000-8000-000000000001',
    );

    expect(storage.isStagingObjectKey(staging, 'org', 'facility', 'elder', 'submission')).toBe(true);
    expect(storage.isSealedObjectKey(staging, 'org', 'facility', 'elder', 'submission')).toBe(false);
    expect(storage.isSealedObjectKey(sealed, 'org', 'facility', 'elder', 'submission')).toBe(true);
    expect(
      storage.isSealedObjectKey(
        'voice/sealed/org/facility/elder/submission/predictable',
        'org',
        'facility',
        'elder',
        'submission',
      ),
    ).toBe(false);
  });

  it('conditionally copies the reserved source ETag under an abortable lease', async () => {
    const storage = storageService();
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ContentLength: 44,
        ContentType: 'audio/wav',
        Metadata: { sha256: 'a'.repeat(64) },
        ETag: '"sealed-etag"',
      });
    Reflect.set(storage, 'client', { send });

    await expect(
      storage.copyToSealed(
        'voice/staging/org/facility/elder/submission',
        'voice/sealed/org/facility/elder/submission/70000000-0000-4000-8000-000000000001',
        '"source-etag"',
        new Date(Date.now() + 10_000),
      ),
    ).resolves.toMatchObject({ eTag: '"sealed-etag"' });
    expect(send).toHaveBeenCalledTimes(2);
    const copyCommand: unknown = send.mock.calls[0]?.[0];
    const sendOptions: unknown = send.mock.calls[0]?.[1];
    expect(copyCommand).toMatchObject({
      input: {
        CopySourceIfMatch: '"source-etag"',
        Key: 'voice/sealed/org/facility/elder/submission/70000000-0000-4000-8000-000000000001',
      },
    });
    expect(sendOptions).toHaveProperty('abortSignal');
  });
});

function storageService(): ObjectStorageService {
  return new ObjectStorageService({
    minioEndpoint: 'http://127.0.0.1:9000',
    minioAccessKey: 'test-access',
    minioSecretKey: 'test-secret',
    minioBucket: 'eldercare-private',
  } as never);
}
