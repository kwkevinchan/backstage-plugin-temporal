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
import { createBackendModule } from '@backstage/backend-plugin-api';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import {
  temporalExtensionPoint,
  TemporalWorkflowEnricher,
} from '@kwkevinchan/backstage-plugin-temporal-node';
import request from 'supertest';
import { temporalPlugin } from './plugin';
import {
  badEntity,
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  FakeWorkflowService,
  customKindEntity,
  ordersEntity,
  otherEntity,
} from './testUtils';

const entities = [ordersEntity, otherEntity, badEntity, customKindEntity];
const ref = 'component:default/orders';

async function start(options?: {
  permission?: AuthorizeResult.ALLOW | AuthorizeResult.DENY;
  enricher?: TemporalWorkflowEnricher;
  workflowService?: FakeWorkflowService;
  entityRefAttribute?: string;
}) {
  const workflowService =
    options?.workflowService ?? createFakeWorkflowService();
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({
        result: options?.permission ?? AuthorizeResult.ALLOW,
      })),
    ) as any,
  });
  const features: any[] = [
    temporalPlugin,
    catalogServiceMock.factory({ entities }),
    fakeTemporalServiceFactory(workflowService, {
      entityRefAttribute: options?.entityRefAttribute,
    }),
    permissions.factory,
  ];
  if (options?.enricher) {
    const enricher = options.enricher;
    features.push(
      createBackendModule({
        pluginId: 'temporal',
        moduleId: 'test-enricher',
        register(reg) {
          reg.registerInit({
            deps: { temporal: temporalExtensionPoint },
            async init({ temporal }) {
              temporal.addWorkflowEnricher(enricher);
            },
          });
        },
      }),
    );
  }
  const { server } = await startTestBackend({ features });
  return { server, workflowService, permissions };
}

describe('temporal backend plugin', () => {
  it('lists workflows of an entity with a query from its annotations', async () => {
    const { server, workflowService, permissions } = await start();
    const res = await request(server).get(
      '/api/temporal/entities/component/default/orders/workflows?status=Running&pageSize=5',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      namespace: 'default',
      nextPageToken: 'Bwc=',
      items: [
        expect.objectContaining({
          workflowId: 'wf-1',
          runId: 'wf-1-run',
          status: 'Completed',
          webUiUrl:
            'http://temporal-ui/namespaces/default/workflows/wf-1/wf-1-run/history',
        }),
      ],
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith({
      namespace: 'default',
      query:
        "(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') AND ExecutionStatus = 'Running'",
      pageSize: 5,
      nextPageToken: undefined,
    });
    expect(permissions.authorize).toHaveBeenCalledWith(
      [
        {
          permission: expect.objectContaining({
            name: 'temporal.workflow.read',
            resourceType: 'catalog-entity',
          }),
          resourceRef: ref,
        },
      ],
      { credentials: mockCredentials.user() },
    );
  });

  it('passes the page token back to Temporal', async () => {
    const { server, workflowService } = await start();
    await request(server)
      .get(
        '/api/temporal/entities/component/default/orders/workflows?pageToken=Bwc%3D',
      )
      .expect(200);
    expect(
      Array.from(
        (workflowService.listWorkflowExecutions.mock.calls[0] as any)[0]
          .nextPageToken,
      ),
    ).toEqual([7, 7]);
  });

  it('rejects query injection and bad input', async () => {
    const { server, workflowService } = await start();
    const bad = await request(server).get(
      '/api/temporal/entities/component/default/bad/workflows',
    );
    expect(bad.status).toBe(400);
    const status = await request(server).get(
      `/api/temporal/entities/component/default/orders/workflows?status=${encodeURIComponent(
        "Running' OR '1'='1",
      )}`,
    );
    expect(status.status).toBe(400);
    const pageSize = await request(server).get(
      '/api/temporal/entities/component/default/orders/workflows?pageSize=100000',
    );
    expect(pageSize.status).toBe(400);
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown entities and 400 for other namespaces', async () => {
    const { server } = await start();
    await request(server)
      .get('/api/temporal/entities/component/default/missing/workflows')
      .expect(404);
    await request(server)
      .get(`/api/temporal/namespaces/secret/workflows/wf-1?entityRef=${ref}`)
      .expect(400);
  });

  it('returns 403 when the permission is denied', async () => {
    const { server, workflowService } = await start({
      permission: AuthorizeResult.DENY,
    });
    await request(server)
      .get('/api/temporal/entities/component/default/orders/workflows')
      .expect(403);
    await request(server)
      .get(`/api/temporal/namespaces/default/workflows/wf-1?entityRef=${ref}`)
      .expect(403);
    await request(server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/history?entityRef=${ref}`,
      )
      .expect(403);
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });

  it('requires a user', async () => {
    const { server } = await start();
    await request(server)
      .get('/api/temporal/entities/component/default/orders/workflows')
      .set('Authorization', mockCredentials.none.header())
      .expect(401);
  });

  it('describes a workflow with its failure chain', async () => {
    const { server } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workflowId: 'wf-1',
      status: 'Failed',
      failure: {
        message: 'outer',
        type: 'Outer',
        cause: { message: 'inner' },
      },
      pendingActivities: [],
    });
  });

  it('hides workflows that do not belong to the entity', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: executionInfo({
        workflowId: 'wf-x',
        taskQueue: 'billing',
      }),
      pendingActivities: [],
    });
    const { server } = await start({ workflowService });
    await request(server)
      .get(`/api/temporal/namespaces/default/workflows/wf-x?entityRef=${ref}`)
      .expect(404);
  });

  it('uses the entity reference search attribute without entityRef', async () => {
    const workflowService = createFakeWorkflowService();
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: 'wf-sa',
          taskQueue: 'other',
          type: 'x',
        }),
        searchAttributes: {
          indexedFields: {
            BackstageEntityRef: {
              metadata: { encoding: b64('json/plain') },
              data: b64(JSON.stringify(ref)),
            },
          },
        },
      } as any,
      pendingActivities: [],
    });
    const { server, permissions } = await start({
      workflowService,
      entityRefAttribute: 'BackstageEntityRef',
    });
    const res = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-sa',
    );
    expect(res.status).toBe(200);
    expect(res.body.entityRef).toBe(ref);
    expect(permissions.authorize).toHaveBeenCalledWith(
      [expect.objectContaining({ resourceRef: ref })],
      expect.anything(),
    );

    const { server: server2 } = await start({ workflowService });
    await request(server2)
      .get('/api/temporal/namespaces/default/workflows/wf-sa')
      .expect(403);
  });

  it('pages through history with the history permission', async () => {
    const { server, workflowService, permissions } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/history?entityRef=${ref}&pageSize=10`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      events: [
        {
          eventId: '1',
          eventType: 'WorkflowExecutionStarted',
          attributes: {
            input: { payloads: [{ encoding: 'json/plain', value: 42 }] },
          },
        },
      ],
    });
    expect(workflowService.getWorkflowExecutionHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        execution: { workflowId: 'wf-1', runId: 'wf-1-run' },
        maximumPageSize: 10,
      }),
    );
    expect(permissions.authorize).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          permission: expect.objectContaining({
            name: 'temporal.workflow.history.read',
          }),
        }),
      ],
      expect.anything(),
    );
  });

  it('returns inputs and outputs with the history permission', async () => {
    const { server, permissions } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/steps?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      input: { encoding: 'json/plain', value: 42 },
      activities: [],
      truncated: false,
    });
    expect(permissions.authorize).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          permission: expect.objectContaining({
            name: 'temporal.workflow.history.read',
          }),
        }),
      ],
      expect.anything(),
    );
    const denied = await start({ permission: AuthorizeResult.DENY });
    await request(denied.server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/steps?entityRef=${ref}`,
      )
      .expect(403);
  });

  it('lists workflows for entities of any kind', async () => {
    const { server, workflowService } = await start();
    await request(server)
      .get('/api/temporal/entities/workflow/default/nightly/workflows')
      .expect(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({ query: "WorkflowType = 'nightly'" }),
    );
  });

  it('runs workflow enrichers on lists and details', async () => {
    const enrich = jest.fn(async (items: any[]) =>
      items.map(item => ({ ...item, extensions: { test: { seen: true } } })),
    );
    const { server } = await start({ enricher: { id: 'test', enrich } });
    const list = await request(server).get(
      '/api/temporal/entities/component/default/orders/workflows',
    );
    expect(list.body.items[0].extensions).toEqual({ test: { seen: true } });
    const detail = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1?entityRef=${ref}`,
    );
    expect(detail.body.extensions).toEqual({ test: { seen: true } });
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(enrich).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        namespace: 'default',
        entity: expect.objectContaining({
          metadata: expect.objectContaining({ name: 'orders' }),
        }),
      }),
    );
  });

  it('keeps going when an enricher fails', async () => {
    const { server } = await start({
      enricher: {
        id: 'broken',
        enrich: async () => {
          throw new Error('nope');
        },
      },
    });
    await request(server)
      .get('/api/temporal/entities/component/default/orders/workflows')
      .expect(200);
  });
});
