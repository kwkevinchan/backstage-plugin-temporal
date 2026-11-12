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

/*
 * The client against a real Temporal backend plugin (the default export of
 * the backend package) in a test backend: a route that does not exist is a
 * 404 without a body, the plugin's own 404 has an error body.
 */
import { createServiceFactory } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { ResponseError } from '@backstage/errors';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import temporalBackend from '@kwkevinchan/backstage-plugin-temporal-backend';
import {
  TemporalService,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { AddressInfo } from 'node:net';
import { CONTROL_DISABLED_MESSAGE, TemporalPluginClient } from './client';

/** Temporal is never reached in these tests. */
const temporal: TemporalService = {
  getClient: async () => {
    throw new Error('not used');
  },
  getConnection: async () => {
    throw new Error('not used');
  },
  getDefaultNamespace: () => 'default',
  getAllowedNamespaces: () => ['default'],
  isNamespaceAllowed: ns => ns === 'default',
  getSearchAttributeNames: () => ({}),
  getWebUiUrl: () => undefined,
};

const backends: Array<{ stop(): Promise<void> }> = [];
afterAll(async () => {
  await Promise.all(backends.map(b => b.stop()));
});

async function client(control: object) {
  const backend = await startTestBackend({
    features: [
      temporalBackend,
      catalogServiceMock.factory({ entities: [] }),
      createServiceFactory({
        service: temporalServiceRef,
        deps: {},
        factory: () => temporal,
      }),
      mockServices.permissions.factory({ result: 'ALLOW' as any }),
      mockServices.rootConfig.factory({ data: { temporal: { control } } }),
    ],
  });
  backends.push(backend);
  const { port } = backend.server.address() as AddressInfo;
  const discovery = mockServices.discovery.mock({
    getBaseUrl: async () => `http://localhost:${port}/api/temporal`,
  });
  const auth = mockServices.auth.mock({
    getPluginRequestToken: async () => ({
      token: mockCredentials.user.token('user:default/alice'),
    }),
  });
  return new TemporalPluginClient(discovery, auth);
}

const user = mockCredentials.user('user:default/alice');

describe('TemporalPluginClient against the Temporal backend plugin', () => {
  it('says that the operations are off when the backend turned them off', async () => {
    const c = await client({ enabled: false });
    await expect(
      c.start({ entityRef: 'temporalworkflow:default/release' }, user),
    ).rejects.toThrow(CONTROL_DISABLED_MESSAGE);
    await expect(
      c.start({ workflowType: 'orderWorkflow', taskQueue: 'orders' }, user),
    ).rejects.toThrow(CONTROL_DISABLED_MESSAGE);
    for (const kind of ['signal', 'update'] as const) {
      await expect(
        c.send(
          kind,
          { namespace: 'default', workflowId: 'w' },
          { name: 'approve', args: [] },
          undefined,
          user,
        ),
      ).rejects.toThrow(CONTROL_DISABLED_MESSAGE);
    }
  });

  it("keeps the backend's 404 for an entity that does not exist", async () => {
    const c = await client({});
    const error = await c
      .start({ entityRef: 'temporalworkflow:default/missing' }, user)
      .catch(e => e);
    expect(error).toBeInstanceOf(ResponseError);
    expect(error.statusCode).toBe(404);
    expect(error.message).not.toContain(CONTROL_DISABLED_MESSAGE);
  });
});
