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

import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { TemporalPluginClient } from './client';

describe('TemporalPluginClient', () => {
  const fetchMock = jest.fn();
  const original = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as any;
  });
  afterAll(() => {
    global.fetch = original;
  });

  function client() {
    const discovery = mockServices.discovery.mock({
      getBaseUrl: async () => 'http://backend/api/temporal',
    });
    const auth = mockServices.auth.mock({
      getPluginRequestToken: async () => ({ token: 'obo-token' }),
    });
    return { c: new TemporalPluginClient(discovery, auth), auth };
  }

  it('starts the workflow of an entity on behalf of the user', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ namespace: 'default', workflowId: 'w', runId: 'r' }),
      ),
    );
    const { c, auth } = client();
    const user = mockCredentials.user('user:default/alice');
    await c.start(
      { entityRef: 'temporalworkflow:default/release', args: [1] },
      user,
    );
    expect(auth.getPluginRequestToken).toHaveBeenCalledWith({
      onBehalfOf: user,
      targetPluginId: 'temporal',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://backend/api/temporal/entities/temporalworkflow/default/release/workflows',
    );
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer obo-token');
    expect(JSON.parse(init.body)).toEqual({ args: [1] });
  });

  it('sends an update with the entity as a query parameter', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: 1 })));
    const { c } = client();
    const result = await c.send(
      'update',
      { namespace: 'default', workflowId: 'w 1' },
      { name: 'approve', args: [] },
      'component:default/orders',
      mockCredentials.user(),
    );
    expect(result).toEqual({ result: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://backend/api/temporal/namespaces/default/workflows/w%201/update?entityRef=component%3Adefault%2Forders',
    );
  });

  it('starts any workflow type without an entity', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ namespace: 'n', workflowId: 'w', runId: 'r' }),
      ),
    );
    const { c } = client();
    await c.start(
      { workflowType: 'orderWorkflow', taskQueue: 'orders', namespace: 'n' },
      mockCredentials.user(),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend/api/temporal/workflows');
    expect(JSON.parse(init.body)).toEqual({
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
      namespace: 'n',
    });
  });

  it('reads the steps of a run for its result', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ result: 'ok', activities: [] })),
    );
    const { c } = client();
    const steps = await c.steps(
      { namespace: 'default', workflowId: 'w', runId: 'r' },
      undefined,
      mockCredentials.user(),
    );
    expect(steps.result).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://backend/api/temporal/namespaces/default/workflows/w/runs/r/steps',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('says when the token of the user has expired', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const { c } = client();
    await expect(
      c.describe(
        { namespace: 'default', workflowId: 'w' },
        undefined,
        mockCredentials.user(),
      ),
    ).rejects.toThrow(/token may have expired/);
  });

  it('throws the error of the backend', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { name: 'NotAllowedError', message: 'no' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { c } = client();
    await expect(
      c.describe(
        { namespace: 'default', workflowId: 'w' },
        undefined,
        mockCredentials.user(),
      ),
    ).rejects.toThrow(/403/);
  });

  describe('when the operations are turned off in the Temporal backend', () => {
    // A route that does not exist: 404 without an error body.
    const missingRoute = () => new Response('', { status: 404 });
    const message =
      /does not serve the operations that change workflows: temporal\.control\.enabled is false/;

    it('says so when a workflow is started', async () => {
      fetchMock.mockResolvedValue(missingRoute());
      const { c } = client();
      await expect(
        c.start(
          { entityRef: 'temporalworkflow:default/release' },
          mockCredentials.user(),
        ),
      ).rejects.toThrow(message);
      await expect(
        c.start(
          { workflowType: 'orderWorkflow', taskQueue: 'orders' },
          mockCredentials.user(),
        ),
      ).rejects.toThrow(message);
    });

    it('says so when a signal or an update is sent', async () => {
      const { c } = client();
      for (const kind of ['signal', 'update'] as const) {
        fetchMock.mockResolvedValue(missingRoute());
        await expect(
          c.send(
            kind,
            { namespace: 'default', workflowId: 'w' },
            { name: 'approve', args: [] },
            undefined,
            mockCredentials.user(),
          ),
        ).rejects.toThrow(message);
      }
    });

    it('keeps the error of the backend for a 404 with an error body', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { name: 'NotFoundError', message: 'No such entity' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      const { c } = client();
      const error = await c
        .start(
          { entityRef: 'temporalworkflow:default/missing' },
          mockCredentials.user(),
        )
        .catch(e => e);
      expect(error.message).not.toMatch(message);
      expect(error.name).toBe('ResponseError');
    });

    it('does not change the routes that read', async () => {
      fetchMock.mockResolvedValue(missingRoute());
      const { c } = client();
      const error = await c
        .describe(
          { namespace: 'default', workflowId: 'w' },
          undefined,
          mockCredentials.user(),
        )
        .catch(e => e);
      expect(error.message).not.toMatch(message);
      expect(error.name).toBe('ResponseError');
    });
  });
});
