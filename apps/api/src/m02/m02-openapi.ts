import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators.js';

interface JsonSchemaProvider {
  toJSONSchema(options?: { target?: string }): unknown;
}

export function M02ReadOperation(
  permission: string,
  summary: string,
  responseType: Type<unknown>,
): MethodDecorator {
  return applyDecorators(
    RequirePermissions(permission),
    ApiOperation({ summary }),
    ApiOkResponse({ type: responseType }),
    ApiBadRequestResponse({ description: 'The request is invalid.' }),
    ApiForbiddenResponse({ description: 'The permission is missing.' }),
    ApiNotFoundResponse({ description: 'The record does not exist or is inaccessible.' }),
  );
}

export function M02WriteOperation(
  permission: string | readonly string[],
  summary: string,
  responseType: Type<unknown>,
  requestSchema: JsonSchemaProvider,
  responseStatus: 'created' | 'ok' = 'ok',
): MethodDecorator {
  const permissions = typeof permission === 'string' ? [permission] : permission;
  return applyDecorators(
    RequirePermissions(...permissions),
    ApiSecurity('csrf'),
    ApiOperation({ summary }),
    ApiBody(openApiBody(requestSchema)),
    responseStatus === 'created'
      ? ApiCreatedResponse({ type: responseType })
      : ApiOkResponse({ type: responseType }),
    ApiBadRequestResponse({ description: 'The request is invalid.' }),
    ApiConflictResponse({ description: 'The expected version or state is stale.' }),
    ApiForbiddenResponse({ description: 'The permission is missing.' }),
    ApiNotFoundResponse({ description: 'The record does not exist or is inaccessible.' }),
  );
}

export function openApiBody(schema: JsonSchemaProvider): ApiBodyOptions {
  const jsonSchema = schema.toJSONSchema({ target: 'openapi-3.0' });
  if (jsonSchema === null || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    throw new Error('The request validator did not produce an OpenAPI schema');
  }
  return {
    schema: jsonSchema as Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  };
}
