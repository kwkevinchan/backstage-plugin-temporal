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
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { scaffolderTemporalModule } from './module';

describe('scaffolderTemporalModule', () => {
  it('adds the three Temporal actions to the scaffolder', async () => {
    const addActions = jest.fn();
    await startTestBackend({
      extensionPoints: [[scaffolderActionsExtensionPoint, { addActions }]],
      features: [
        scaffolderTemporalModule,
        mockServices.rootConfig.factory({
          data: { app: { baseUrl: 'http://backstage' } },
        }),
      ],
    });
    const ids = addActions.mock.calls.flat().map((a: { id: string }) => a.id);
    expect(ids).toEqual([
      'temporal:workflow:start',
      'temporal:workflow:wait',
      'temporal:workflow:signal',
    ]);
  });

  it('signals in the default namespace of the Temporal backend plugin', async () => {
    const addActions = jest.fn();
    await startTestBackend({
      extensionPoints: [[scaffolderActionsExtensionPoint, { addActions }]],
      features: [
        scaffolderTemporalModule,
        mockServices.rootConfig.factory({
          data: {
            app: { baseUrl: 'http://backstage' },
            temporal: { connection: { defaultNamespace: 'team-a' } },
          },
        }),
      ],
    });
    const signal = addActions.mock.calls
      .flat()
      .find((a: { id: string }) => a.id === 'temporal:workflow:signal');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));
    try {
      const ctx = createMockActionContext({
        input: { workflowId: 'release-1', name: 'approve' },
      });
      Object.assign(ctx, {
        getInitiatorCredentials: async () =>
          mockCredentials.user('user:default/alice'),
        checkpoint: async ({ fn }: any) => fn(),
      });
      await signal.handler(ctx);
      expect(String(fetchMock.mock.calls[0][0])).toMatch(
        /\/api\/temporal\/namespaces\/team-a\/workflows\/release-1\/signal$/,
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
