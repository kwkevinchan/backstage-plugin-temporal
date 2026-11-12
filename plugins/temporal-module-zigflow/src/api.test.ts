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

import { loadEntityDefinition } from './api';

describe('loadEntityDefinition', () => {
  const discoveryApi = { getBaseUrl: async () => '/api/temporal' };
  const load = (response: Response) =>
    loadEntityDefinition(
      { discoveryApi, fetchApi: { fetch: async () => response } },
      'temporalworkflow:default/flow',
    );

  it('says that the backend module is missing when the route does not exist', async () => {
    await expect(load(new Response('', { status: 404 }))).rejects.toThrow(
      /serves no workflow definitions: add @kwkevinchan\/backstage-plugin-temporal-backend-module-zigflow/,
    );
  });

  it('keeps the error of the backend for a 404 with an error body', async () => {
    const error = await load(
      new Response(
        JSON.stringify({
          error: { name: 'NotFoundError', message: 'No such entity' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    ).catch(e => e);
    expect(error.name).toBe('ResponseError');
  });
});
