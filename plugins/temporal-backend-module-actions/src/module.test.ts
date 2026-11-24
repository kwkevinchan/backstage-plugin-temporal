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

import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { temporalActionsModule } from './module';

describe('temporalActionsModule', () => {
  it('fails to start when app.baseUrl is missing from config', async () => {
    await expect(
      startTestBackend({
        features: [
          temporalActionsModule,
          catalogServiceMock.factory({ entities: [] }),
          mockServices.rootConfig.factory({ data: {} }),
        ],
      }),
    ).rejects.toThrow(/app\.baseUrl/);
  });

  it('registers the actions, and they call the plugin as the user in its default namespace', async () => {
    const registry = actionsRegistryServiceMock();
    await startTestBackend({
      features: [
        temporalActionsModule,
        createServiceFactory({
          service: actionsRegistryServiceRef,
          deps: {},
          factory: () => registry,
        }),
        catalogServiceMock.factory({ entities: [] }),
        mockServices.rootConfig.factory({
          data: {
            app: { baseUrl: 'http://backstage' },
            temporal: { connection: { defaultNamespace: 'team-a' } },
          },
        }),
      ],
    });
    expect([...registry.actions.keys()]).toEqual([
      'test:list-workflows',
      'test:get-workflow',
      'test:start-workflow',
      'test:signal-workflow',
      'test:update-workflow',
    ]);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));
    try {
      await registry.invoke({
        id: 'test:signal-workflow',
        input: { workflowId: 'release-1', runId: 'run-1', name: 'approve' },
        credentials: mockCredentials.user('user:default/alice'),
      });
      expect(String(fetchMock.mock.calls[0][0])).toMatch(
        /\/api\/temporal\/namespaces\/team-a\/workflows\/release-1\/runs\/run-1\/signal$/,
      );
      const headers = (fetchMock.mock.calls[0][1] as any).headers;
      expect(headers.Authorization).toMatch(/^Bearer /);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
