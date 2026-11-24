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

import { mockCredentials } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { resolveWorkflowNamespace } from './workflowNamespace';

const user = mockCredentials.user('user:default/alice');

const entity = (annotations: Record<string, string>) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'orders', annotations },
  spec: {},
});

function options(entities: any[]) {
  return {
    catalog: catalogServiceMock({ entities }),
    defaultNamespace: 'default',
  };
}

describe('resolveWorkflowNamespace', () => {
  it('uses the namespace given, without reading the catalog', async () => {
    await expect(
      resolveWorkflowNamespace(
        options([]),
        { namespace: 'n', entityRef: 'component:default/orders' },
        user,
      ),
    ).resolves.toBe('n');
  });

  it('uses the default namespace without an entity', async () => {
    await expect(resolveWorkflowNamespace(options([]), {}, user)).resolves.toBe(
      'default',
    );
  });

  it('uses the namespace of the entity, else the default one', async () => {
    const withNamespace = entity({
      'temporal.io/workflow-type': 'w',
      'temporal.io/task-queue': 'q',
      'temporal.io/namespace': 'team-a',
    });
    const without = entity({
      'temporal.io/workflow-type': 'w',
      'temporal.io/task-queue': 'q',
    });
    const input = { entityRef: 'component:default/orders' };
    await expect(
      resolveWorkflowNamespace(options([withNamespace]), input, user),
    ).resolves.toBe('team-a');
    await expect(
      resolveWorkflowNamespace(options([without]), input, user),
    ).resolves.toBe('default');
  });

  it('says so when the entity cannot be read', async () => {
    await expect(
      resolveWorkflowNamespace(
        options([]),
        { entityRef: 'component:default/orders' },
        user,
      ),
    ).rejects.toThrow(/Cannot read the entity component:default\/orders/);
  });
});
