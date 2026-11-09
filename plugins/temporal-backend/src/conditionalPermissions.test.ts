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
 * R7: a policy may answer a temporal permission (resource type
 * `catalog-entity`) with a *conditional* decision that uses catalog rules,
 * for example `isEntityOwner`. This test runs the real permission backend and
 * the real catalog backend and checks that the permission backend hands the
 * condition to the catalog to resolve, so that owners get 200 and others 403.
 */
import {
  BackstageCredentials,
  coreServices,
  createBackendModule,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import {
  AuthorizeResult,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { temporalPermissions } from '@kwkevinchan/backstage-plugin-temporal-common';
import catalogBackend from '@backstage/plugin-catalog-backend';
import permissionBackend from '@backstage/plugin-permission-backend';
import request from 'supertest';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
} from './testUtils';

jest.setTimeout(120_000);

const entities: Entity[] = [
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'orders',
      namespace: 'default',
      annotations: {
        'backstage.io/managed-by-location': 'url:http://example.com/orders',
        'backstage.io/managed-by-origin-location':
          'url:http://example.com/orders',
        'temporal.io/task-queue': 'orders',
      },
    },
    spec: {
      type: 'service',
      lifecycle: 'production',
      owner: 'user:default/alice',
    },
  },
];

/**
 * The mock auth services drop the `actor` of on-behalf-of tokens, so a call
 * from the permission backend to the catalog on behalf of a user looks like a
 * direct user call, which `apply-conditions` rejects. The real auth service
 * sets the actor to the calling plugin. This wrapper restores that.
 */
const MOCK_SERVICE_TOKEN_PREFIX = 'mock-service-token:';
const httpAuthWithActor = createServiceFactory({
  service: coreServices.httpAuth,
  deps: { plugin: coreServices.pluginMetadata },
  factory({ plugin }) {
    const inner = mockServices.httpAuth({ pluginId: plugin.getId() });
    return {
      async credentials(req: any, options?: any) {
        const credentials: BackstageCredentials = await inner.credentials(
          req,
          options,
        );
        const header: string = req.headers?.authorization ?? '';
        const token = header.replace(/^Bearer /, '');
        if (
          token.startsWith(MOCK_SERVICE_TOKEN_PREFIX) &&
          JSON.parse(token.slice(MOCK_SERVICE_TOKEN_PREFIX.length)).obo &&
          credentials.principal &&
          (credentials.principal as any).type === 'user'
        ) {
          return mockCredentials.user(
            (credentials.principal as any).userEntityRef,
            { actor: { subject: 'plugin:mock-caller' } },
          ) as any;
        }
        return credentials as any;
      },
      issueUserCookie: (res: any, options?: any) =>
        inner.issueUserCookie(res, options),
    };
  },
});

const temporalPermissionNames = new Set(temporalPermissions.map(p => p.name));

const ownerPolicyModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'test-owner-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy({
          async handle(req, user) {
            if (
              temporalPermissionNames.has(req.permission.name) &&
              isResourcePermission(req.permission, 'catalog-entity')
            ) {
              return createCatalogConditionalDecision(
                req.permission,
                catalogConditions.isEntityOwner({
                  claims: user?.info.ownershipEntityRefs ?? [],
                }),
              );
            }
            return { result: AuthorizeResult.ALLOW };
          },
        });
      },
    });
  },
});

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
              entities: entities.map(entity => ({
                entity,
                locationKey: 'test-entities',
              })),
            });
          },
        });
      },
    });
  },
});

describe('conditional catalog-entity decisions for temporal permissions (R7)', () => {
  it('lets the catalog resolve isEntityOwner for temporal routes', async () => {
    const { server } = await startTestBackend({
      features: [
        temporalPlugin,
        catalogBackend,
        entityProviderModule,
        permissionBackend,
        ownerPolicyModule,
        fakeTemporalServiceFactory(createFakeWorkflowService()),
        httpAuthWithActor,
        mockServices.rootConfig.factory({
          data: {
            permission: { enabled: true },
            catalog: { processingInterval: { seconds: 1 } },
          },
        }),
      ],
    });

    // Wait until the catalog has processed the entity (relations included).
    let lastCatalogResponse = '';
    const catalogReady = async () => {
      const res = await request(server)
        .get('/api/catalog/entities/by-name/component/default/orders')
        .set('Authorization', mockCredentials.service.header());
      lastCatalogResponse = `${res.status} ${JSON.stringify(res.body)}`;
      return res.status === 200 && (res.body.relations ?? []).length > 0;
    };
    for (let i = 0; i < 20 && !(await catalogReady()); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    expect({ ready: await catalogReady(), lastCatalogResponse }).toEqual({
      ready: true,
      lastCatalogResponse: expect.stringMatching(/^200 /),
    });

    const url = '/api/temporal/entities/component/default/orders/workflows';
    const owner = await request(server)
      .get(url)
      .set('Authorization', mockCredentials.user.header('user:default/alice'));
    expect(owner.status).toBe(200);
    expect(owner.body.items).toHaveLength(1);

    const other = await request(server)
      .get(url)
      .set('Authorization', mockCredentials.user.header('user:default/bob'));
    expect(other.status).toBe(403);

    // The same holds for the history permission on a single workflow.
    const history =
      '/api/temporal/namespaces/default/workflows/wf-1/history?entityRef=component:default/orders';
    await request(server)
      .get(history)
      .set('Authorization', mockCredentials.user.header('user:default/alice'))
      .expect(200);
    await request(server)
      .get(history)
      .set('Authorization', mockCredentials.user.header('user:default/bob'))
      .expect(403);
  });
});
