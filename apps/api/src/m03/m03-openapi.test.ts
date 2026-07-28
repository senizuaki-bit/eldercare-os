import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { M03_PERMISSIONS } from '@eldercare/authz';
import { workOrderCompletionRequestSchema } from '@eldercare/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REQUIRED_PERMISSIONS } from '../auth/auth.decorators.js';
import { parseSchema } from '../common/parse-schema.js';
import { SafeHttpException } from '../common/safe-http.exception.js';
import { createOpenApiDocument } from '../http-application.js';
import { AdminNeedsController } from './admin-needs.controller.js';
import { AdminWorkOrdersController } from './admin-work-orders.controller.js';
import {
  CaregiverWorkOrdersController,
  ElderServicesController,
  ElderVoiceController,
  FamilySummariesController,
} from './portal.controller.js';
import { SensitiveVoiceController } from './sensitive-voice.controller.js';
import { AdminTaskUpdatesController, CaregiverTaskUpdatesController } from './task-updates.controller.js';

type HttpMethod = 'get' | 'post';

const JSON_OPERATIONS = [
  ['get', '/admin/organizations/{organizationId}/facilities/{facilityId}/needs', ['items', 'pageInfo']],
  ['get', '/admin/organizations/{organizationId}/facilities/{facilityId}/needs/{needId}', ['id', 'elder']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/needs/manual', ['id', 'status']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/needs/{needId}/review', ['id', 'elder']],
  ['get', '/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders', ['items', 'pageInfo']],
  ['get', '/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders/{workOrderId}', ['id', 'need', 'ruleResults']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders/{workOrderId}/assign', ['id', 'need', 'ruleResults']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders/{workOrderId}/verify', ['id', 'need', 'familySummary']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders/{workOrderId}/close', ['id', 'need', 'familySummary']],
  ['post', '/elder/voice-submissions/demo', ['submission', 'needs', 'workOrder']],
  ['post', '/elder/voice-submissions/upload-intents', ['submissionId', 'upload', 'acceptedMimeTypes']],
  ['post', '/elder/voice-submissions/human-help', ['need', 'workOrder', 'humanReviewRequired']],
  ['get', '/elder/voice-submissions/{submissionId}', ['submission', 'needs', 'workOrder']],
  ['post', '/elder/voice-submissions/{submissionId}/finalize', ['submission', 'needs', 'workOrder']],
  ['post', '/elder/voice-submissions/{submissionId}/cancel', ['id', 'status']],
  ['get', '/caregiver/work-orders', ['items', 'pageInfo']],
  ['get', '/caregiver/work-orders/{workOrderId}', ['id', 'elderDisplayName', 'operationalAttention']],
  ['post', '/caregiver/work-orders/{workOrderId}/accept', ['id', 'elderDisplayName', 'operationalAttention']],
  ['post', '/caregiver/work-orders/{workOrderId}/arrive', ['id', 'workOrderId', 'arrivedAt']],
  ['post', '/caregiver/work-orders/{workOrderId}/start', ['id', 'elderDisplayName', 'operationalAttention']],
  ['post', '/caregiver/work-orders/{workOrderId}/voice-submissions/upload-intents', ['submissionId', 'upload']],
  ['post', '/caregiver/work-orders/{workOrderId}/voice-submissions/{submissionId}/finalize', ['submission', 'transcript', 'completionDraft']],
  ['post', '/caregiver/work-orders/{workOrderId}/voice-submissions/{submissionId}/cancel', ['id', 'status']],
  ['post', '/caregiver/work-orders/{workOrderId}/complete', ['id', 'elderDisplayName', 'operationalAttention']],
  ['get', '/elder/services', ['items', 'pageInfo']],
  ['post', '/elder/work-orders/{workOrderId}/verify', ['id', 'status']],
  ['post', '/elder/work-orders/{workOrderId}/ratings', ['id', 'score']],
  ['get', '/family/summaries', ['items', 'pageInfo']],
  ['get', '/admin/organizations/{organizationId}/facilities/{facilityId}/voice-submissions/{submissionId}/transcript', ['id', 'text']],
  ['post', '/admin/organizations/{organizationId}/facilities/{facilityId}/voice-submissions/{submissionId}/audio-read-url', ['submissionId', 'url', 'expiresAt']],
] as const satisfies readonly (readonly [HttpMethod, string, readonly string[]])[];

describe('M03 generated OpenAPI contract', () => {
  let app: INestApplication;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminNeedsController,
        AdminWorkOrdersController,
        ElderVoiceController,
        CaregiverWorkOrdersController,
        ElderServicesController,
        FamilySummariesController,
        SensitiveVoiceController,
        CaregiverTaskUpdatesController,
        AdminTaskUpdatesController,
      ],
    }).useMocker(() => ({})).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = createOpenApiDocument(app, { appVersion: 'm03-contract-test' }) as unknown as Record<string, unknown>;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('publishes a concrete response and uniform error envelope for every JSON route', () => {
    expect(JSON_OPERATIONS).toHaveLength(30);
    for (const [method, path, requiredFields] of JSON_OPERATIONS) {
      const operation = openApiOperation(document, path, method);
      const responseSchema = openApiResponseSchema(operation, '200', 'application/json');
      const required = stringArray(responseSchema, 'required');
      expect(required, `${method.toUpperCase()} ${path}`).toEqual(expect.arrayContaining([...requiredFields]));
      expect(responseSchema).not.toEqual({ type: 'object' });

      for (const status of method === 'post'
        ? ['400', '401', '403', '404', '409', '500']
        : ['400', '401', '403', '404', '500']) {
        const errorSchema = openApiResponseSchema(operation, status, 'application/json');
        expect(stringArray(errorSchema, 'required'), `${method.toUpperCase()} ${path} ${status}`)
          .toEqual(expect.arrayContaining(['error', 'timestamp']));
      }
    }
  });

  it('requires family-summary publish permission on administrator verification', () => {
    const verifyHandler = Reflect.get(
      AdminWorkOrdersController.prototype,
      'verify',
    ) as object;
    expect(Reflect.getMetadata(
      REQUIRED_PERMISSIONS,
      verifyHandler,
    )).toEqual([
      M03_PERMISSIONS.WORK_ORDER_VERIFY,
      M03_PERMISSIONS.AI_ANALYSIS_READ,
      M03_PERMISSIONS.FAMILY_SUMMARY_PUBLISH,
    ]);
  });

  it('documents list queries as optional and every path identifier as UUID', () => {
    const needsList = openApiOperation(
      document,
      '/admin/organizations/{organizationId}/facilities/{facilityId}/needs',
      'get',
    );
    const queryParameters = parameterRecords(needsList).filter((parameter) => parameter.in === 'query');
    expect(queryParameters.map((parameter) => parameter.name)).toEqual(expect.arrayContaining([
      'page',
      'pageSize',
      'search',
      'elderId',
      'category',
      'priority',
      'status',
      'requiresHumanReview',
      'sort',
      'direction',
    ]));
    expect(queryParameters.every((parameter) => parameter.required === false)).toBe(true);

    for (const [, path] of JSON_OPERATIONS) {
      const pathItem = recordAt(recordAt(document, 'paths'), path);
      for (const method of ['get', 'post'] as const) {
        const candidate = pathItem[method];
        if (!isRecord(candidate)) continue;
        for (const parameter of parameterRecords(candidate).filter((item) => item.in === 'path')) {
          expect(recordAt(parameter, 'schema').format, `${method.toUpperCase()} ${path} ${String(parameter.name)}`).toBe('uuid');
        }
      }
    }
  });

  it('preserves literal transitions and union request constraints', () => {
    const accept = requestBodySchema(openApiOperation(document, '/caregiver/work-orders/{workOrderId}/accept', 'post'));
    expect(recordAt(recordAt(accept, 'properties'), 'targetStatus').enum).toEqual(['ACCEPTED']);

    const verify = requestBodySchema(openApiOperation(document, '/elder/work-orders/{workOrderId}/verify', 'post'));
    expect(recordAt(recordAt(verify, 'properties'), 'targetStatus').enum).toEqual(['VERIFIED']);

    for (const [path, variants] of [
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/needs/{needId}/review', 2],
      ['/admin/organizations/{organizationId}/facilities/{facilityId}/work-orders/{workOrderId}/assign', 3],
      ['/caregiver/work-orders/{workOrderId}/complete', 2],
    ] as const) {
      const schema = requestBodySchema(openApiOperation(document, path, 'post'));
      const union = Array.isArray(schema.oneOf) ? schema.oneOf : schema.anyOf;
      expect(union, path).toBeInstanceOf(Array);
      expect(union, path).toHaveLength(variants);
    }

    const completion = requestBodySchema(openApiOperation(
      document,
      '/caregiver/work-orders/{workOrderId}/complete',
      'post',
    ));
    const completionUnion = Array.isArray(completion.oneOf) ? completion.oneOf : completion.anyOf;
    if (!Array.isArray(completionUnion)) throw new Error('Expected completion request union');
    const completionVariants = completionUnion.filter(isRecord);
    const textVariant = completionVariants.find((variant) =>
      stringArray(recordAt(recordAt(variant, 'properties'), 'noteSource'), 'enum').includes('TEXT'));
    const voiceVariant = completionVariants.find((variant) =>
      stringArray(recordAt(recordAt(variant, 'properties'), 'noteSource'), 'enum').includes('VOICE'));
    if (textVariant === undefined || voiceVariant === undefined) {
      throw new Error('Expected TEXT and VOICE completion variants');
    }
    expect(recordAt(textVariant, 'properties')).not.toHaveProperty('voiceSubmissionId');
    expect(textVariant.additionalProperties).toBe(false);
    expect(stringArray(textVariant, 'required')).toContain('noteText');
    expect(stringArray(voiceVariant, 'required')).toContain('voiceSubmissionId');
    expect(recordAt(recordAt(voiceVariant, 'properties'), 'voiceSubmissionId').format).toBe('uuid');
  });

  it('turns mismatched completion note sources into stable 400 request errors', () => {
    for (const body of [
      {
        expectedVersion: 5,
        noteSource: 'TEXT',
        noteText: 'Completed safely.',
        voiceSubmissionId: '60000000-0000-4000-8000-000000000001',
        reasonCode: 'CAREGIVER_COMPLETED',
        idempotencyKey: 'completion-contract-text-with-voice',
      },
      {
        expectedVersion: 5,
        noteSource: 'VOICE',
        reasonCode: 'CAREGIVER_COMPLETED',
        idempotencyKey: 'completion-contract-voice-without-id',
      },
    ]) {
      let error: unknown;
      try {
        parseSchema(workOrderCompletionRequestSchema, body);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(SafeHttpException);
      expect((error as SafeHttpException).getStatus()).toBe(400);
      expect((error as SafeHttpException).safeCode).toBe('INVALID_REQUEST');
    }
  });

  it('documents both SSE routes as text/event-stream with a private event-data schema', () => {
    for (const path of [
      '/caregiver/task-updates',
      '/admin/organizations/{organizationId}/facilities/{facilityId}/task-updates',
    ]) {
      const operation = openApiOperation(document, path, 'get');
      const response = recordAt(recordAt(operation, 'responses'), '200');
      const eventStream = recordAt(recordAt(response, 'content'), 'text/event-stream');
      const eventSchema = recordAt(eventStream, 'x-event-data-schema');
      expect(stringArray(eventSchema, 'required')).toEqual(expect.arrayContaining([
        'eventId',
        'eventType',
        'workOrderId',
        'status',
        'version',
        'occurredAt',
      ]));
      expect(recordAt(eventSchema, 'properties')).not.toHaveProperty('elderId');
    }
  });
});

function openApiOperation(
  document: Record<string, unknown>,
  path: string,
  method: HttpMethod,
): Record<string, unknown> {
  return recordAt(recordAt(recordAt(document, 'paths'), path), method);
}

function openApiResponseSchema(
  operation: Record<string, unknown>,
  status: string,
  mediaType: string,
): Record<string, unknown> {
  const response = recordAt(recordAt(operation, 'responses'), status);
  return recordAt(recordAt(recordAt(response, 'content'), mediaType), 'schema');
}

function requestBodySchema(operation: Record<string, unknown>): Record<string, unknown> {
  const body = recordAt(operation, 'requestBody');
  return recordAt(recordAt(recordAt(body, 'content'), 'application/json'), 'schema');
}

function parameterRecords(operation: Record<string, unknown>): Record<string, unknown>[] {
  const value = operation.parameters;
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Expected ${key} to be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
