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
  ApiQuery,
  ApiSecurity,
  ApiUnauthorizedResponse,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { errorEnvelopeSchema } from '@eldercare/contracts';
import { RequirePermissions } from '../auth/auth.decorators.js';

interface JsonSchemaProvider {
  toJSONSchema(options?: {
    target?: string;
    io?: 'input' | 'output';
  }): unknown;
}

interface M04OperationOptions {
  readonly querySchema?: JsonSchemaProvider;
  readonly uuidParams?: readonly string[];
}

type OpenApiSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

interface OpenApiObjectSchema extends Record<string, unknown> {
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
}

const errorResponseSchema = openApiSchema(errorEnvelopeSchema, 'output');

export function M04ReadOperation(
  permission: string | readonly string[],
  summary: string,
  responseSchema: JsonSchemaProvider,
  options: M04OperationOptions = {},
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiOkResponse({ schema: openApiSchema(responseSchema, 'output') }),
    ...commonErrorDecorators(),
  );
}

export function M04WriteOperation(
  permission: string | readonly string[],
  summary: string,
  responseSchema: JsonSchemaProvider,
  requestSchema: JsonSchemaProvider,
  options: M04OperationOptions = {},
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(...permissions(permission)),
    HttpCode(HttpStatus.OK),
    ApiSecurity('csrf'),
    ApiOperation({ summary }),
    ...routeParameterDecorators(options),
    ApiBody({ schema: openApiSchema(requestSchema, 'input') }),
    ApiOkResponse({ schema: openApiSchema(responseSchema, 'output') }),
    ...commonErrorDecorators(true),
  );
}

function openApiSchema(
  schema: JsonSchemaProvider,
  io: 'input' | 'output',
): OpenApiSchema {
  const jsonSchema = schema.toJSONSchema({ target: 'openapi-3.0', io });
  if (
    jsonSchema === null ||
    typeof jsonSchema !== 'object' ||
    Array.isArray(jsonSchema)
  ) {
    throw new Error('The validator did not produce an OpenAPI schema');
  }
  const openApi = { ...(jsonSchema as Record<string, unknown>) };
  delete openApi['$schema'];
  return openApi;
}

function permissions(permission: string | readonly string[]): readonly string[] {
  return typeof permission === 'string' ? [permission] : permission;
}

function routeParameterDecorators(
  options: M04OperationOptions,
): MethodDecorator[] {
  const decorators: MethodDecorator[] = [];
  for (const name of options.uuidParams ?? []) {
    decorators.push(
      ApiParam({
        name,
        required: true,
        schema: { type: 'string', format: 'uuid' },
      }),
    );
  }

  if (options.querySchema !== undefined) {
    const schema = openApiSchema(
      options.querySchema,
      'input',
    ) as OpenApiObjectSchema;
    const required = new Set(schema.required ?? []);
    for (const [name, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      decorators.push(
        ApiQuery({
          name,
          required: required.has(name),
          schema: propertySchema,
        }),
      );
    }
  }
  return decorators;
}

function commonErrorDecorators(includeConflict = false): MethodDecorator[] {
  return [
    ApiBadRequestResponse({
      description: 'The request is invalid.',
      schema: errorResponseSchema,
    }),
    ApiUnauthorizedResponse({
      description: 'Authentication is required.',
      schema: errorResponseSchema,
    }),
    ApiForbiddenResponse({
      description: 'The permission is missing.',
      schema: errorResponseSchema,
    }),
    ApiNotFoundResponse({
      description: 'The record does not exist or is inaccessible.',
      schema: errorResponseSchema,
    }),
    ...(includeConflict
      ? [
          ApiConflictResponse({
            description:
              'The expected version, state or idempotency fingerprint is stale.',
            schema: errorResponseSchema,
          }),
        ]
      : []),
    ApiInternalServerErrorResponse({
      description: 'The request could not be completed.',
      schema: errorResponseSchema,
    }),
  ];
}
