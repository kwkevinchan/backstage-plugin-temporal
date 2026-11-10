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

import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
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
});
