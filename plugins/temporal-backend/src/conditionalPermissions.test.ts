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
  TestDatabases,
} from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import {
  AuthorizeResult,
  isResourcePermission,
} from '@backstage/plugin-permission-common';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { temporalPermissions, temporalWorkflowReadPermission } from './common';
import catalogBackend from '@backstage/plugin-catalog-backend';
import permissionBackend from '@backstage/plugin-permission-backend';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import {
  createTemporalWorkflowConditionalDecision,
  temporalWorkflowConditions,
} from './alpha';
import { catalogModuleTemporalWorkflowKind } from './catalog';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

jest.setTimeout(120_000);

/**
 * The backends the tests started. They are stopped before the databases are
 * closed (hooks run in the order they are declared).
 */
const backends: Array<{ stop(): Promise<void> }> = [];
afterAll(async () => {
  await Promise.all(backends.map(backend => backend.stop()));
});

/**
 * The catalog's database. The backend does not close the connection pool of
 * the default in-memory database when it stops, which leaves its timer
 * running; `TestDatabases` closes what it creates after the tests.
 */
const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

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
    const knex = await databases.init('SQLITE_3');
    const backend = await startTestBackend({
      features: [
        temporalPlugin,
        temporalAccessServiceFactory,
        mockServices.database.factory({ knex }),
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
    const { server } = backend;
    backends.push(backend);

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
    const api = await withOpenApiValidation(server);
    const owner = await request(api)
      .get(url)
      .set('Authorization', mockCredentials.user.header('user:default/alice'));
    expect(owner.status).toBe(200);
    expect(owner.body.items).toHaveLength(1);

    const other = await request(api)
      .get(url)
      .set('Authorization', mockCredentials.user.header('user:default/bob'));
    expect(other.status).toBe(403);

    // The same holds for the history of a single workflow.
    const history =
      '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history?entityRef=component:default/orders';
    await request(api)
      .get(history)
      .set('Authorization', mockCredentials.user.header('user:default/alice'))
      .expect(200);
    await request(api)
      .get(history)
      .set('Authorization', mockCredentials.user.header('user:default/bob'))
      .expect(403);
  });
});

const workflowPolicyModule = createBackendModule({
  pluginId: 'permission',
  moduleId: 'test-workflow-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy({
          async handle(req, user) {
            if (isResourcePermission(req.permission, 'temporal-workflow')) {
              return createTemporalWorkflowConditionalDecision(req.permission, {
                allOf: [
                  temporalWorkflowConditions.inNamespace({
                    namespaces: ['default'],
                  }),
                  temporalWorkflowConditions.isInitiator({
                    claims: user?.info.ownershipEntityRefs ?? [],
                  }),
                ],
              });
            }
            return { result: AuthorizeResult.ALLOW };
          },
        });
      },
    });
  },
});

describe('conditional temporal-workflow decisions from a policy', () => {
  it('uses the rules of the plugin through the permission backend', async () => {
    const workflowService = createFakeWorkflowService();
    const backend = await startTestBackend({
      features: [
        temporalPlugin,
        temporalAccessServiceFactory,
        permissionBackend,
        workflowPolicyModule,
        catalogServiceMock.factory({ entities: [] }),
        fakeTemporalServiceFactory(workflowService, {
          initiatorAttribute: 'BackstageInitiator',
        }),
        httpAuthWithActor,
        mockServices.rootConfig.factory({
          data: { permission: { enabled: true } },
        }),
      ],
    });
    const { server } = backend;
    backends.push(backend);

    const metadata = await request(server)
      .get('/api/temporal/.well-known/backstage/permissions/metadata')
      .set('Authorization', mockCredentials.service.header());
    expect(metadata.status).toBe(200);
    expect(
      metadata.body.rules.map((rule: { name: string }) => rule.name).sort(),
    ).toEqual([
      'HAS_TASK_QUEUE',
      'HAS_WORKFLOW_TYPE',
      'IN_NAMESPACE',
      'IS_INITIATOR',
    ]);

    const res = await request(await withOpenApiValidation(server))
      .get('/api/temporal/workflows')
      .set('Authorization', mockCredentials.user.header('user:default/alice'));
    expect(res.status).toBe(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining(
          "(BackstageInitiator = 'user:default/alice')",
        ),
      }),
    );
  });
});

describe('conditional catalog-entity decisions across dependsOn entities', () => {
  const dependsOnEntities: Entity[] = [
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'checkout',
        namespace: 'default',
        annotations: {
          'backstage.io/managed-by-location': 'url:http://example.com/checkout',
          'backstage.io/managed-by-origin-location':
            'url:http://example.com/checkout',
          'temporal.io/workflow-type': 'deploymentWorkflow',
        },
      },
      spec: {
        type: 'service',
        lifecycle: 'production',
        owner: 'user:default/alice',
        dependsOn: ['temporalworkflow:default/order-workflow'],
      },
    },
    {
      apiVersion: 'temporal.io/v1alpha1',
      kind: 'TemporalWorkflow',
      metadata: {
        name: 'order-workflow',
        namespace: 'default',
        annotations: {
          'backstage.io/managed-by-location':
            'url:http://example.com/order-workflow',
          'backstage.io/managed-by-origin-location':
            'url:http://example.com/order-workflow',
        },
      },
      spec: {
        owner: 'user:default/bob',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
      },
    },
  ];

  const dependsOnEntityProvider = createBackendModule({
    pluginId: 'catalog',
    moduleId: 'test-depends-on-entities',
    register(reg) {
      reg.registerInit({
        deps: { catalog: catalogProcessingExtensionPoint },
        async init({ catalog }) {
          catalog.addEntityProvider({
            getProviderName: () => 'test-depends-on-entities',
            async connect(connection) {
              await connection.applyMutation({
                type: 'full',
                entities: dependsOnEntities.map(entity => ({
                  entity,
                  locationKey: 'test-depends-on-entities',
                })),
              });
            },
          });
        },
      });
    },
  });

  const readAllowOtherOwnerPolicy = createBackendModule({
    pluginId: 'permission',
    moduleId: 'test-depends-on-owner-policy',
    register(reg) {
      reg.registerInit({
        deps: { policy: policyExtensionPoint },
        async init({ policy }) {
          policy.setPolicy({
            async handle(req, user) {
              if (req.permission.name === temporalWorkflowReadPermission.name) {
                return { result: AuthorizeResult.ALLOW };
              }
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

  it('requires the terminate permission on both the opened entity and matched TemporalWorkflow entity', async () => {
    const knex = await databases.init('SQLITE_3');
    const base = createFakeWorkflowService();
    const workflowService = {
      ...base,
      describeWorkflowExecution: jest.fn(async (req: any) => ({
        workflowExecutionInfo: executionInfo({
          workflowId: req.execution.workflowId,
          status:
            req.execution.workflowId === 'wf-running'
              ? 'WORKFLOW_EXECUTION_STATUS_RUNNING'
              : 'WORKFLOW_EXECUTION_STATUS_FAILED',
        }),
        pendingActivities: [],
      })),
      terminateWorkflowExecution: jest.fn(async () => ({})),
    };
    const backend = await startTestBackend({
      features: [
        temporalPlugin,
        temporalAccessServiceFactory,
        mockServices.database.factory({ knex }),
        catalogBackend,
        catalogModuleTemporalWorkflowKind,
        dependsOnEntityProvider,
        permissionBackend,
        readAllowOtherOwnerPolicy,
        fakeTemporalServiceFactory(workflowService),
        httpAuthWithActor,
        mockServices.rootConfig.factory({
          data: {
            permission: { enabled: true },
            catalog: { processingInterval: { seconds: 1 } },
          },
        }),
      ],
    });
    const { server } = backend;
    backends.push(backend);

    let lastResponse = '';
    const catalogReady = async () => {
      const [comp, wfEntity] = await Promise.all([
        request(server)
          .get('/api/catalog/entities/by-name/component/default/checkout')
          .set('Authorization', mockCredentials.service.header()),
        request(server)
          .get(
            '/api/catalog/entities/by-name/temporalworkflow/default/order-workflow',
          )
          .set('Authorization', mockCredentials.service.header()),
      ]);
      lastResponse = `${comp.status}/${wfEntity.status}`;
      return (
        comp.status === 200 &&
        wfEntity.status === 200 &&
        (comp.body.relations ?? []).length > 0 &&
        (wfEntity.body.relations ?? []).length > 0
      );
    };
    for (let i = 0; i < 20 && !(await catalogReady()); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    expect({ ready: await catalogReady(), lastResponse }).toEqual({
      ready: true,
      lastResponse: '200/200',
    });

    const api = await withOpenApiValidation(server);
    const checkoutRef = 'component:default/checkout';
    const orderWfRef = 'temporalworkflow:default/order-workflow';
    const failedRun =
      '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run';
    const runningRun =
      '/api/temporal/namespaces/default/workflows/wf-running/runs/wf-running-run';

    // Alice owns checkout (A) but not order-workflow (W).
    const aliceDetail = await request(api)
      .get(`${failedRun}?entityRef=${checkoutRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/alice'));
    expect(aliceDetail.status).toBe(200);
    expect(aliceDetail.body.workflowEntityRef).toBe(orderWfRef);
    // The read permission covers the failure details.
    expect(aliceDetail.body.failure.cause).toBeDefined();

    const aliceGraph = await request(api)
      .get(`${failedRun}/graph?entityRef=${checkoutRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/alice'));
    expect(aliceGraph.status).toBe(200);

    const aliceTerminate = await request(api)
      .post(`${runningRun}/terminate?entityRef=${checkoutRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/alice'))
      .send({ reason: 'stop' });
    expect(aliceTerminate.status).toBe(403);
    expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();

    // Bob owns order-workflow (W) but not checkout (A): blocked via checkout, allowed directly via order-workflow.
    const bobViaCheckoutGraph = await request(api)
      .get(`${failedRun}/graph?entityRef=${checkoutRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/bob'));
    expect(bobViaCheckoutGraph.status).toBe(200);

    const bobViaCheckoutTerminate = await request(api)
      .post(`${runningRun}/terminate?entityRef=${checkoutRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/bob'))
      .send({ reason: 'stop' });
    expect(bobViaCheckoutTerminate.status).toBe(403);
    expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();

    const bobDirectGraph = await request(api)
      .get(`${failedRun}/graph?entityRef=${orderWfRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/bob'));
    expect(bobDirectGraph.status).toBe(200);

    const bobDirectTerminate = await request(api)
      .post(`${runningRun}/terminate?entityRef=${orderWfRef}`)
      .set('Authorization', mockCredentials.user.header('user:default/bob'))
      .send({ reason: 'stop' });
    expect(bobDirectTerminate.status).toBe(200);
    expect(workflowService.terminateWorkflowExecution).toHaveBeenCalledTimes(1);
  });
});
