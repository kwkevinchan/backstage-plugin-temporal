/*
 * Copyright 2026 The backstage-plugin-temporal Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const SPEC_ROUTE = '/openapi.json';

type OpenApiDocument = Record<string, any>;

let cachedSpec: OpenApiDocument | undefined;

/** The OpenAPI document of the plugin, read from the package once. */
export function loadOpenApiSpec(): OpenApiDocument {
  cachedSpec ??= parse(
    readFileSync(
      resolvePackagePath(
        '@kwkevinchan/backstage-plugin-temporal-backend',
        'src/schema/openapi.yaml',
      ),
      'utf8',
    ),
  ) as OpenApiDocument;
  return cachedSpec;
}

/**
 * The operation of the route itself. It is added when the document is
 * served, not written in `openapi.yaml`: the lint of the spec files does not
 * allow a file extension in a path.
 */
const SPEC_OPERATION = {
  get: {
    operationId: 'getOpenApiSpec',
    summary: 'Get this API description',
    description:
      'This OpenAPI document as JSON, for the catalog module `@backstage/plugin-catalog-backend-module-backstage-openapi` and other tools. The paths carry the base URL of the plugin (`/api/temporal` in a default backend), so a tool can merge the document with those of other plugins. The operations that change workflows are left out when `temporal.control.enabled` is false. The definition route of the Zigflow backend module stays in the document whether or not the module is installed; without the module it answers 404.\n\nNeeds Backstage credentials, like every route; no permission is checked.',
    tags: ['Specification'],
    responses: {
      '200': {
        description: 'The OpenAPI document.',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '500': { $ref: '#/components/responses/InternalServerError' },
    },
  },
};

/**
 * The document as one backend serves it: the paths under `basePath` (the
 * plugin's URL path, which the document itself does not know), and without
 * the operations that change workflows when `controlEnabled` is false.
 */
export function openApiSpecFor(
  spec: OpenApiDocument,
  options: { basePath: string; controlEnabled: boolean },
): OpenApiDocument {
  const paths: Record<string, any> = {};
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    const kept = Object.fromEntries(
      Object.entries<any>(item).filter(
        ([, operation]) =>
          options.controlEnabled || operation['x-temporal-control'] !== true,
      ),
    );
    if (Object.keys(kept).length > 0) {
      paths[`${options.basePath}${path}`] = kept;
    }
  }
  paths[`${options.basePath}${SPEC_ROUTE}`] = SPEC_OPERATION;
  return {
    ...spec,
    tags: [
      ...(spec.tags ?? []),
      { name: 'Specification', description: 'This API description.' },
    ],
    paths,
  };
}

/**
 * The path the plugin is served under, from the URL of a request to
 * `/openapi.json`: how `@backstage/backend-openapi-utils` finds it.
 */
export function basePathOfSpecRequest(originalUrl: string): string {
  const path = originalUrl.split('?')[0];
  return path.endsWith(SPEC_ROUTE) ? path.slice(0, -SPEC_ROUTE.length) : '';
}
