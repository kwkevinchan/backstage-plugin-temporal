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

// The rule of the core plugin is not public, so the test reads it from its source.
// eslint-disable-next-line @backstage/no-relative-monorepo-imports
import { hasErrorBody as coreHasErrorBody } from '../../temporal/src/common/errorBody';
import { DefinitionClient, hasErrorBody, MODULE_MISSING_MESSAGE } from './api';

describe('DefinitionClient', () => {
  const discoveryApi = { getBaseUrl: async () => '/api/temporal' };
  const load = (response: Response) =>
    new DefinitionClient({
      discoveryApi,
      fetchApi: { fetch: async () => response },
    }).getEntityDefinition('temporalworkflow:default/flow');

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
    const result = await new DefinitionClient({
      discoveryApi,
      fetchApi: { fetch },
    }).getEntityDefinition('TemporalWorkflow:Team A/Order/Flow');
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
      /serves no workflow definitions: add @kwkevinchan\/backstage-plugin-temporal-backend-module-zigflow/,
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
      new DefinitionClient({
        discoveryApi,
        fetchApi: { fetch },
      }).getEntityDefinition('::invalid::'),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('hasErrorBody', () => {
  it('tells an error body apart like the core plugin', async () => {
    const bodies = [
      JSON.stringify({ error: { name: 'NotFoundError', message: 'x' } }),
      JSON.stringify({ error: { message: 'no name' } }),
      JSON.stringify({ error: 'text' }),
      JSON.stringify({}),
      'null',
      'not json',
      '',
    ];
    for (const body of bodies) {
      const response = () => new Response(body, { status: 404 });
      expect(await hasErrorBody(response())).toBe(
        await coreHasErrorBody(response()),
      );
    }
    expect(await hasErrorBody(new Response(bodies[0], { status: 404 }))).toBe(
      true,
    );
  });
});
