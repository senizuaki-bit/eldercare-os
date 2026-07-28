import { applyDecorators, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { errorEnvelopeSchema } from '@eldercare/contracts';
import { RequirePermissions } from '../auth/auth.decorators.js';

interface JsonSchemaProvider {
  toJSONSchema(options?: { target?: string; io?: 'input' | 'output' }): unknown;
}

interface M03OperationOptions {
  readonly querySchema?: JsonSchemaProvider;
  readonly uuidParams?: readonly string[];
}

type OpenApiSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

interface OpenApiObjectSchema extends Record<string, unknown> {
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
}

const errorResponseSchema = openApiSchema(errorEnvelopeSchema, 'output');

export function M03ReadOperation(
  permission: string | readonly string[],
  summary: string,
  responseSchema: JsonSchemaProvider,
  options: M03OperationOptions = {},
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiOkResponse({ schema: openApiSchema(responseSchema, 'output') }),
    ...commonErrorDecorators(),
  );
}

export function M03WriteOperation(
  permission: string | readonly string[],
  summary: string,
  responseSchema: JsonSchemaProvider,
  requestSchema: JsonSchemaProvider,
  options: M03OperationOptions = {},
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    HttpCode(HttpStatus.OK),
    ApiSecurity('csrf'),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiBody(openApiBody(requestSchema)),
    ApiOkResponse({ schema: openApiSchema(responseSchema, 'output') }),
    ...commonErrorDecorators(true),
  );
}

export function M03ActionOperation(
  permission: string | readonly string[],
  summary: string,
  responseSchema: JsonSchemaProvider,
  options: M03OperationOptions = {},
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    HttpCode(HttpStatus.OK),
    ApiSecurity('csrf'),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiOkResponse({ schema: openApiSchema(responseSchema, 'output') }),
    ...commonErrorDecorators(true),
  );
}

export function M03SseOperation(
  permission: string | readonly string[],
  summary: string,
  eventDataSchema: JsonSchemaProvider,
  options: M03OperationOptions = {},
): MethodDecorator {
  const eventSchema = openApiSchema(eventDataSchema, 'output');
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiProduces('text/event-stream'),
    ApiOkResponse({
      description: 'Server-sent events. Each data field is JSON matching x-event-data-schema.',
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          'x-event-data-schema': eventSchema,
        },
      } as never,
    }),
    ...commonErrorDecorators(),
  );
}

export function openApiSchema(
  schema: JsonSchemaProvider,
  io: 'input' | 'output',
): OpenApiSchema {
  const jsonSchema = schema.toJSONSchema({ target: 'openapi-3.0', io });
  if (jsonSchema === null || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    throw new Error('The validator did not produce an OpenAPI schema');
  }
  const openApi = { ...(jsonSchema as Record<string, unknown>) };
  delete openApi['$schema'];
  return openApi;
}

function openApiBody(schema: JsonSchemaProvider): ApiBodyOptions {
  return { schema: openApiSchema(schema, 'input') };
}

function permissions(permission: string | readonly string[]): readonly string[] {
  return typeof permission === 'string' ? [permission] : permission;
}

function routeParameterDecorators(options: M03OperationOptions): MethodDecorator[] {
  const decorators: MethodDecorator[] = [];
  for (const name of options.uuidParams ?? []) {
    decorators.push(ApiParam({
      name,
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }));
  }
  if (options.querySchema !== undefined) {
    const schema = openApiSchema(options.querySchema, 'input') as OpenApiObjectSchema;
    const required = new Set(schema.required ?? []);
    for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
      decorators.push(ApiQuery({
        name,
        required: required.has(name),
        schema: propertySchema,
      }));
    }
  }
  return decorators;
}

function commonErrorDecorators(includeConflict = false): MethodDecorator[] {
  return [
    ApiBadRequestResponse({ description: 'The request is invalid.', schema: errorResponseSchema }),
    ApiUnauthorizedResponse({ description: 'Authentication is required.', schema: errorResponseSchema }),
    ApiForbiddenResponse({ description: 'The permission is missing.', schema: errorResponseSchema }),
    ApiNotFoundResponse({
      description: 'The record does not exist or is inaccessible.',
      schema: errorResponseSchema,
    }),
    ...(includeConflict
      ? [ApiConflictResponse({
          description: 'The expected version, state or idempotency fingerprint is stale.',
          schema: errorResponseSchema,
        })]
      : []),
    ApiInternalServerErrorResponse({ description: 'The request could not be completed.', schema: errorResponseSchema }),
  ];
}
