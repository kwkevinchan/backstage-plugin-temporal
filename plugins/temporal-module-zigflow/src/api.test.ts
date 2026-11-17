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

import { loadEntityDefinition, MODULE_MISSING_MESSAGE } from './api';

describe('loadEntityDefinition', () => {
  const discoveryApi = { getBaseUrl: async () => '/api/temporal' };
  const load = (response: Response) =>
    loadEntityDefinition(
      { discoveryApi, fetchApi: { fetch: async () => response } },
      'temporalworkflow:default/flow',
    );

  it('requests the encoded entity definition path and returns parsed JSON on 200', async () => {
    const fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            entityRef: 'temporalworkflow:team a/order/flow',
            format: 'serverless-workflow',
            target: './order.yaml',
            maxBytes: 1024,
            tasks: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const result = await loadEntityDefinition(
      { discoveryApi, fetchApi: { fetch } },
      'TemporalWorkflow:Team A/Order/Flow',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/temporal/entities/temporalworkflow/team%20a/order%2Fflow/definition',
    );
    expect(result).toMatchObject({
      entityRef: 'temporalworkflow:team a/order/flow',
      format: 'serverless-workflow',
      target: './order.yaml',
    });
  });

  it('says that the backend module is missing when the route does not exist', async () => {
    await expect(load(new Response('', { status: 404 }))).rejects.toThrow(
      MODULE_MISSING_MESSAGE,
    );
  });

  it('keeps the error of the backend for a 404 with an error body and non-404 errors', async () => {
    const notFound = await load(
      new Response(
        JSON.stringify({
          error: { name: 'NotFoundError', message: 'No such entity' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    ).catch(e => e);
    expect(notFound.name).toBe('ResponseError');

    const serverError = await load(
      new Response('Internal Server Error', { status: 500 }),
    ).catch(e => e);
    expect(serverError.name).toBe('ResponseError');
    expect(serverError.message).not.toBe(MODULE_MISSING_MESSAGE);
  });

  it('rejects a malformed entityRef before calling fetch', async () => {
    const fetch = jest.fn();
    await expect(
      loadEntityDefinition(
        { discoveryApi, fetchApi: { fetch } },
        '::invalid::',
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
