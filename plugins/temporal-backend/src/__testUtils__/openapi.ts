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

import { wrapServer } from '@backstage/backend-openapi-utils/testUtils';
import express from 'express';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/** Where the test backend mounts the plugin's routes. */
const PLUGIN_BASE_PATH = '/api/temporal';

/**
 * The OpenAPI spec of the plugin with its paths under the plugin's base
 * path, as a test backend serves them.
 */
export function loadOpenApiSpec(): Record<string, any> {
  const spec = parse(
    readFileSync(resolve(__dirname, '../schema/openapi.yaml'), 'utf8'),
  );
  spec.paths = Object.fromEntries(
    Object.entries(spec.paths).map(([path, item]) => [
      `${PLUGIN_BASE_PATH}${path}`,
      item,
    ]),
  );
  return spec;
}

/**
 * A server for supertest that sends every request to `backend` (the server
 * of `startTestBackend`) through the validating proxy of
 * `@backstage/backend-openapi-utils`: a request, or a response, that does
 * not match `src/schema/openapi.yaml` fails the test. Paths that are not in
 * the spec (other plugins, framework routes, routes that do not exist)
 * fail too; send those to `backend` itself.
 */
export async function withOpenApiValidation(backend: Server): Promise<Server> {
  const spec = loadOpenApiSpec();
  const app = express();
  app.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  app.use((req, res) => {
    backend.emit('request', req, res);
  });
  return wrapServer(app);
}
