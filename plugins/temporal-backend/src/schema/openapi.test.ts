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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createControlRouter } from '../routes/controlRoutes';
import { createRouter } from '../routes/router';

const spec = parse(readFileSync(resolve(__dirname, 'openapi.yaml'), 'utf8'));

/** `METHOD /path` of every route of an Express router, in OpenAPI form. */
function routesOf(router: any): string[] {
  const routes: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const paths: string[] = [layer.route.path].flat();
    for (const path of paths) {
      const openApiPath = path.replace(/:([A-Za-z]+)(\([^)]*\))?/g, '{$1}');
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${openApiPath}`);
      }
    }
  }
  return routes.sort();
}

/** `METHOD /path` of the operations of the spec that `include` selects. */
function operationsOf(include: (operation: any) => boolean): string[] {
  const operations: string[] = [];
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    for (const [method, operation] of Object.entries<any>(item)) {
      if (include(operation)) {
        operations.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return operations.sort();
}

// The routes the plugin mounts and the operations of the spec, both ways:
// a route without an operation, or an operation without a route, fails.
// The request and response bodies are checked by the route tests, through
// the validating proxy (src/__testUtils__/openapi.ts).
describe('the OpenAPI spec', () => {
  it('describes every read route, and no other', async () => {
    const router = await createRouter({} as any);
    expect(
      operationsOf(o => !o['x-temporal-control'] && !o['x-temporal-module']),
    ).toEqual(routesOf(router));
  });

  it('describes every route of temporal.control as x-temporal-control', () => {
    const router = createControlRouter({} as any);
    expect(operationsOf(o => o['x-temporal-control'] === true)).toEqual(
      routesOf(router),
    );
  });

  it('marks the experimental routes', () => {
    expect(operationsOf(o => o['x-temporal-experimental'] === true)).toEqual([
      'GET /namespaces/{namespace}/workflows/{workflowId}/llm-calls/{eventId}',
      'GET /namespaces/{namespace}/workflows/{workflowId}/loops',
      'GET /namespaces/{namespace}/workflows/{workflowId}/runs/{runId}/llm-calls/{eventId}',
      'GET /namespaces/{namespace}/workflows/{workflowId}/runs/{runId}/loops',
    ]);
  });
});
