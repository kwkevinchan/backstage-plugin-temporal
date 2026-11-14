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
import { wrapServer } from '@backstage/backend-openapi-utils/testUtils';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { parse } from 'yaml';

/** Where the test backend mounts the routes of the Temporal plugin. */
const PLUGIN_BASE_PATH = '/api/temporal';

/**
 * A server for supertest that sends every request to `backend` (the server
 * of `startTestBackend`) through the validating proxy of
 * `@backstage/backend-openapi-utils`, with the OpenAPI spec of the Temporal
 * backend plugin, which describes the definition route of this module: a
 * request, or a response, that does not match it fails the test.
 */
export async function withOpenApiValidation(backend: Server): Promise<Server> {
  const spec = parse(
    readFileSync(
      resolvePackagePath(
        '@kwkevinchan/backstage-plugin-temporal-backend',
        'src/schema/openapi.yaml',
      ),
      'utf8',
    ),
  );
  spec.paths = Object.fromEntries(
    Object.entries(spec.paths).map(([path, item]) => [
      `${PLUGIN_BASE_PATH}${path}`,
      item,
    ]),
  );
  const app = express();
  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  app.use((req, res) => {
    backend.emit('request', req, res);
  });
  return wrapServer(app);
}
