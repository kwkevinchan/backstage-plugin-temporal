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
 * The default export of the package, added with one `backend.add()` next to
 * the real catalog backend: the read routes, the routes that change
 * workflows and the `TemporalWorkflow` kind are all there, and the routes
 * that change workflows go away with `temporal.control.enabled: false`.
 */
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
  TestDatabases,
} from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import catalogBackend from '@backstage/plugin-catalog-backend';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import request from 'supertest';
import temporalBackend from './index';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
} from './testUtils';

jest.setTimeout(120_000);

const backends: Array<{ stop(): Promise<void> }> = [];
afterAll(async () => {
  await Promise.all(backends.map(backend => backend.stop()));
});

const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: {
    name: 'order-workflow',
    namespace: 'default',
    annotations: {
      'backstage.io/managed-by-location': 'url:https://example.com/a.yaml',
      'backstage.io/managed-by-origin-location':
        'url:https://example.com/a.yaml',
    },
  },
  spec: { owner: 'group:default/team-a', workflowType: 'orderWorkflow' },
};

const entityProviderModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'test-entities',
  register(reg) {
    reg.registerInit({
      deps: { catalog: catalogProcessingExtensionPoint },
      async init({ catalog }) {
        catalog.addEntityProvider({
          getProviderName: () => 'test-entities',
          async connect(connection) {
            await connection.applyMutation({
              type: 'full',
              entities: [{ entity: workflowEntity, locationKey: 'test' }],
            });
          },
        });
      },
    });
  },
});

async function start(control?: object) {
  const knex = await databases.init('SQLITE_3');
  const backend = await startTestBackend({
    features: [
      // The default export, as backend.add(import('...-temporal-backend'))
      // adds it.
      temporalBackend,
      catalogBackend,
      entityProviderModule,
      mockServices.database.factory({ knex }),
      mockServices.permissions.factory({ result: AuthorizeResult.ALLOW }),
      fakeTemporalServiceFactory(createFakeWorkflowService()),
      mockServices.rootConfig.factory({
        data: {
          catalog: {
            processingInterval: { seconds: 1 },
            rules: [{ allow: ['TemporalWorkflow'] }],
          },
          temporal: control ? { control } : {},
        },
      }),
    ],
  });
  backends.push(backend);
  return backend.server;
}

/** The catalog's answer for the entity, once it has processed it. */
async function waitForWorkflowEntity(
  server: Awaited<ReturnType<typeof start>>,
) {
  let res: request.Response | undefined;
  for (let i = 0; i < 20; i++) {
    res = await request(server)
      .get(
        '/api/catalog/entities/by-name/temporalworkflow/default/order-workflow',
      )
      .set('Authorization', mockCredentials.service.header());
    if (res.status === 200) break;
    await new Promise(r => setTimeout(r, 500));
  }
  return res!;
}

// The fake workflow service describes a failed workflow: a route that
// changes workflows answers 409 (not running) when it exists, 404 when not.
const cancel = '/api/temporal/namespaces/default/workflows/wf-1/cancel';

describe('the default export of the package', () => {
  it('installs the read routes, the control routes and the TemporalWorkflow kind', async () => {
    const server = await start();

    const list = await request(server).get('/api/temporal/workflows');
    expect(list.status).toBe(200);

    const res = await request(server).post(cancel).send({});
    expect(res.status).toBe(409);

    const entity = await waitForWorkflowEntity(server);
    expect(entity.status).toBe(200);
    expect(entity.body.kind).toBe('TemporalWorkflow');
    expect(entity.body.relations).toContainEqual(
      expect.objectContaining({
        type: 'ownedBy',
        targetRef: 'group:default/team-a',
      }),
    );
  });

  it('leaves the control routes out when temporal.control.enabled is false', async () => {
    const server = await start({ enabled: false });

    const list = await request(server).get('/api/temporal/workflows');
    expect(list.status).toBe(200);

    const res = await request(server).post(cancel).send({});
    expect(res.status).toBe(404);

    const entity = await waitForWorkflowEntity(server);
    expect(entity.status).toBe(200);
  });
});
