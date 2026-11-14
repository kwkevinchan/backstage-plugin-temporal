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
import { createRouter } from './router';

// The definition route is described in the OpenAPI spec of the Temporal
// backend plugin, as an operation of this module.
describe('the OpenAPI spec of the Temporal backend plugin', () => {
  it('describes the route of this module, and no other', async () => {
    const spec = parse(
      readFileSync(
        resolvePackagePath(
          '@kwkevinchan/backstage-plugin-temporal-backend',
          'src/schema/openapi.yaml',
        ),
        'utf8',
      ),
    );
    const operations: string[] = [];
    for (const [path, item] of Object.entries<any>(spec.paths)) {
      for (const [method, operation] of Object.entries<any>(item)) {
        if (
          operation['x-temporal-module'] ===
          '@kwkevinchan/backstage-plugin-temporal-backend-module-zigflow'
        ) {
          operations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    const router: any = await createRouter({} as any);
    const routes = router.stack
      .filter((layer: any) => layer.route)
      .flatMap((layer: any) =>
        Object.keys(layer.route.methods).map(
          method =>
            `${method.toUpperCase()} ${layer.route.path.replace(
              /:([A-Za-z]+)/g,
              '{$1}',
            )}`,
        ),
      );
    expect(operations).toEqual(routes);
  });
});
