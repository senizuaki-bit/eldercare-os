import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import type { VoiceUploadIntentRequest } from '@eldercare/contracts';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SERVICE_CONFIG } from '../tokens.js';
import { m03BadRequest } from './m03-errors.js';

export const MAX_VOICE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_VOICE_MIME_TYPES = [
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
] as const;

export interface StoredVoiceMetadata {
  readonly contentLength: number;
  readonly contentType: string;
  readonly checksumSha256: string | null;
  readonly eTag: string | null;
}

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: ServiceConfig) {
    this.client = new S3Client({
      endpoint: config.minioEndpoint,
      forcePathStyle: true,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.minioAccessKey,
        secretAccessKey: config.minioSecretKey,
      },
    });
  }

  get bucketName(): string {
    return this.config.minioBucket;
  }

  stagingObjectKey(organizationId: string, facilityId: string, elderId: string, submissionId: string): string {
    return `voice/staging/${organizationId}/${facilityId}/${elderId}/${submissionId}`;
  }

  sealedObjectKey(
    organizationId: string,
    facilityId: string,
    elderId: string,
    submissionId: string,
    nonce: string,
  ): string {
    return `voice/sealed/${organizationId}/${facilityId}/${elderId}/${submissionId}/${nonce}`;
  }

  isStagingObjectKey(
    objectKey: string,
    organizationId: string,
    facilityId: string,
    elderId: string,
    submissionId: string,
  ): boolean {
    return objectKey === this.stagingObjectKey(organizationId, facilityId, elderId, submissionId);
  }

  isSealedObjectKey(
    objectKey: string,
    organizationId: string,
    facilityId: string,
    elderId: string,
    submissionId: string,
  ): boolean {
    const prefix = `voice/sealed/${organizationId}/${facilityId}/${elderId}/${submissionId}/`;
    const nonce = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : '';
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce);
  }

  async createUpload(
    objectKey: string,
    request: VoiceUploadIntentRequest,
  ): Promise<{ method: 'POST'; url: string; fields: Record<string, string>; expiresAt: string }> {
    assertVoiceUpload(request.mimeType, request.sizeBytes);
    const metadata = request.checksumSha256 === undefined ? {} : { sha256: request.checksumSha256 };
    const expiresSeconds = this.config.voiceUploadAuthorizationTtlSeconds;
    const upload = await createPresignedPost(this.client, {
      Bucket: this.config.minioBucket,
      Key: objectKey,
      Expires: expiresSeconds,
      Fields: {
        'Content-Type': request.mimeType,
        ...(request.checksumSha256 === undefined ? {} : { 'x-amz-meta-sha256': request.checksumSha256 }),
      },
      Conditions: [
        ['content-length-range', 1, Math.min(request.sizeBytes, MAX_VOICE_BYTES)],
        ['eq', '$Content-Type', request.mimeType],
        ...(request.checksumSha256 === undefined
          ? []
          : [['eq', '$x-amz-meta-sha256', request.checksumSha256] as ['eq', string, string]]),
      ],
      ...(Object.keys(metadata).length === 0 ? {} : {}),
    });
    return {
      method: 'POST',
      url: upload.url,
      fields: upload.fields,
      expiresAt: new Date(Date.now() + expiresSeconds * 1_000).toISOString(),
    };
  }

  async inspect(objectKey: string): Promise<StoredVoiceMetadata> {
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.config.minioBucket,
      Key: objectKey,
    }));
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'application/octet-stream',
      checksumSha256: result.Metadata?.['sha256'] ?? null,
      eTag: result.ETag ?? null,
    };
  }

  async copyToSealed(
    sourceObjectKey: string,
    sealedObjectKey: string,
    sourceETag: string,
    leaseUntil: Date,
  ): Promise<StoredVoiceMetadata> {
    const remainingMs = leaseUntil.getTime() - Date.now();
    if (remainingMs <= 0) throw m03BadRequest('VOICE_SEAL_LEASE_EXPIRED', '封存租约已过期');
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), remainingMs);
    try {
      await this.client.send(new CopyObjectCommand({
        Bucket: this.config.minioBucket,
        Key: sealedObjectKey,
        CopySource: encodeURI(`${this.config.minioBucket}/${sourceObjectKey}`),
        CopySourceIfMatch: sourceETag,
        MetadataDirective: 'COPY',
      }), { abortSignal: abortController.signal });
    } finally {
      clearTimeout(abortTimer);
    }
    return this.inspect(sealedObjectKey);
  }

  assertUploadedObject(
    expected: { mimeType: string; sizeBytes: number; checksumSha256: string | null },
    actual: StoredVoiceMetadata,
  ): void {
    assertVoiceUpload(actual.contentType, actual.contentLength);
    if (actual.contentType !== expected.mimeType || actual.contentLength !== expected.sizeBytes) {
      throw m03BadRequest('VOICE_OBJECT_MISMATCH', '上传对象的类型或大小与申请不一致');
    }
    if (expected.checksumSha256 !== null && actual.checksumSha256 !== expected.checksumSha256) {
      throw m03BadRequest('VOICE_CHECKSUM_MISMATCH', '上传对象校验值不一致');
    }
  }

  async putDemoFixture(objectKey: string): Promise<{ sizeBytes: number; checksumSha256: string }> {
    const body = demoWaveBuffer();
    const { checksumSha256 } = this.demoFixtureMetadata();
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.minioBucket,
      Key: objectKey,
      Body: body,
      ContentLength: body.byteLength,
      ContentType: 'audio/wav',
      Metadata: { sha256: checksumSha256, fixture: 'deterministic-local-demo' },
    }));
    return { sizeBytes: body.byteLength, checksumSha256 };
  }

  demoFixtureMetadata(): { mimeType: 'audio/wav'; sizeBytes: number; checksumSha256: string } {
    const body = demoWaveBuffer();
    return {
      mimeType: 'audio/wav',
      sizeBytes: body.byteLength,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  async createReadUrl(objectKey: string): Promise<{ url: string; expiresAt: string }> {
    const expiresSeconds = 60;
    return {
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.config.minioBucket, Key: objectKey }),
        { expiresIn: expiresSeconds },
      ),
      expiresAt: new Date(Date.now() + expiresSeconds * 1_000).toISOString(),
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.minioBucket, Key: objectKey }));
  }
}

export function assertVoiceUpload(mimeType: string, sizeBytes: number): void {
  if (!(ACCEPTED_VOICE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw m03BadRequest('VOICE_MIME_NOT_ALLOWED', '仅支持 webm、wav、mp3 或 mp4 音频');
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_VOICE_BYTES) {
    throw m03BadRequest('VOICE_SIZE_NOT_ALLOWED', '音频大小必须在 1 字节到 10MB 之间');
  }
}

function demoWaveBuffer(): Buffer {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
}
