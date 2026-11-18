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

import { createServiceFactory } from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { createValidatedOpenApiRouter } from '@backstage/backend-openapi-utils';
import { InputError } from '@backstage/errors';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import express from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { temporalAccessServiceFactory } from '../access/temporalAccessServiceFactory';
import { TemporalService, temporalServiceRef } from '../node';
import { temporalPlugin } from '../plugin';
import {
  createFakeConnection,
  createFakeWorkflowService,
  executionInfo,
  orderWorkflowEntity,
  ordersEntity,
} from '../testUtils';
import { fakeScheduleService } from '../__testUtils__/schedules';
import { loadOpenApiSpec } from '../__testUtils__/openapi';

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});

const wf = '/api/temporal/namespaces/default/workflows/wf-1';
const withEntity = '?entityRef=component:default/orders';

function createWorkflowService() {
  const base = createFakeWorkflowService();
  return {
    ...base,
    describeWorkflowExecution: jest.fn(async (req: any) => ({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: req.execution.workflowId,
          status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
        }),
        searchAttributes: {
          indexedFields: {
            BackstageEntityRef: {
              metadata: {
                encoding: Buffer.from('json/plain').toString('base64'),
              },
              data: Buffer.from(
                JSON.stringify('component:default/orders'),
              ).toString('base64'),
            },
          },
        },
      },
      pendingActivities: [],
    })),
    signalWorkflowExecution: jest.fn(async () => ({})),
    updateWorkflowExecution: jest.fn(async () => ({
      outcome: { success: { payloads: [json({ priority: 'high' })] } },
    })),
    queryWorkflow: jest.fn(async () => ({
      queryResult: { payloads: [json({ notes: ['hello'] })] },
    })),
    startWorkflowExecution: jest.fn(async () => ({ runId: 'new-run' })),
    ...fakeScheduleService([]),
  };
}

function createSpecApp() {
  const router = createValidatedOpenApiRouter(loadOpenApiSpec() as any, {
    validatorOptions: { validateSecurity: false, validateResponses: false },
  });
  router.use((_req, res) => {
    res.status(200).json({ ok: true });
  });
  const app = express();
  app.use(router);
  app.use(
    (
      err: { name?: string; message?: string; status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      let status = 500;
      if (err instanceof InputError || err.name === 'InputError') {
        status = 400;
      } else if (err.status && err.status >= 400) {
        status = err.status;
      }
      res
        .status(status)
        .json({ error: { name: err.name, message: err.message } });
    },
  );
  return app;
}

async function startPlugin(): Promise<{ backend: Server }> {
  const workflowService = createWorkflowService();
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ) as any,
  });
  const service: TemporalService = {
    getClient: async () => ({ workflow: { getHandle: jest.fn() } } as any),
    getConnection: async () => createFakeConnection(workflowService) as any,
    getDefaultNamespace: () => 'default',
    getAllowedNamespaces: () => ['default'],
    isNamespaceAllowed: ns => ns === 'default' || ns === 'other',
    getSearchAttributeNames: () => ({
      entityRef: 'BackstageEntityRef',
      initiator: 'BackstageInitiator',
    }),
    getWebUiUrl: () => undefined,
  };
  const { server } = await startTestBackend({
    features: [
      temporalAccessServiceFactory,
      temporalPlugin,
      catalogServiceMock.factory({
        entities: [ordersEntity, orderWorkflowEntity],
      }),
      createServiceFactory({
        service: temporalServiceRef,
        deps: {},
        factory: () => service,
      }),
      permissions.factory,
      mockServices.auditor.mock().factory,
    ],
  });
  return { backend: server };
}

type Probe = {
  name: string;
  method: 'get' | 'post';
  path: string;
  body?: unknown;
};

const invalid: Probe[] = [
  {
    name: 'history pageSize above the limit',
    method: 'get',
    path: `${wf}/history${withEntity}&pageSize=501`,
  },
  {
    name: 'history pageToken with illegal characters',
    method: 'get',
    path: `${wf}/history${withEntity}&pageToken=not-a-token!`,
  },
  {
    name: 'list pageToken with illegal characters',
    method: 'get',
    path: '/api/temporal/workflows?pageToken=not-a-token!',
  },
  {
    name: 'list pageSize above the limit',
    method: 'get',
    path: '/api/temporal/workflows?pageSize=100000',
  },
  {
    name: 'query body without a name',
    method: 'post',
    path: `${wf}/query${withEntity}`,
    body: {},
  },
  {
    name: 'update body with a blank name',
    method: 'post',
    path: `${wf}/update${withEntity}`,
    body: { name: '   ' },
  },
  {
    name: 'query name longer than 200 characters',
    method: 'post',
    path: `${wf}/query${withEntity}`,
    body: { name: 'n'.repeat(201) },
  },
  {
    name: 'start body with an invalid workflowType',
    method: 'post',
    path: '/api/temporal/workflows',
    body: { workflowType: 'bad type', taskQueue: 'orders' },
  },
  {
    name: 'start body with a workflowType longer than 255',
    method: 'post',
    path: '/api/temporal/workflows',
    body: { workflowType: `W${'x'.repeat(255)}`, taskQueue: 'orders' },
  },
  {
    name: 'scheduleId longer than 1000',
    method: 'post',
    path: `/api/temporal/namespaces/default/schedules/${'s'.repeat(
      1001,
    )}/pause`,
    body: {},
  },
  {
    name: 'invalid namespace',
    method: 'get',
    path: '/api/temporal/workflows?namespace=bad/namespace',
  },
  {
    name: 'invalid searchAttribute',
    method: 'get',
    path: '/api/temporal/entities/component/default/orders/workflows?searchAttribute=has-dash',
  },
  {
    name: 'workflowId longer than 1000',
    method: 'get',
    path: `/api/temporal/namespaces/default/workflows/${'w'.repeat(1001)}`,
  },
];

const valid: Probe[] = [
  { name: 'list workflows', method: 'get', path: '/api/temporal/workflows' },
  {
    name: 'list with a page token',
    method: 'get',
    path: '/api/temporal/workflows?pageToken=Bwc%3D',
  },
  {
    name: 'history page',
    method: 'get',
    path: `${wf}/history${withEntity}&pageSize=10`,
  },
  {
    name: 'entity list with a search attribute',
    method: 'get',
    path: '/api/temporal/entities/component/default/orders/workflows?searchAttribute=ApprovalPending',
  },
  {
    name: 'query body',
    method: 'post',
    path: `${wf}/query${withEntity}`,
    body: { name: 'state' },
  },
  {
    name: 'update body',
    method: 'post',
    path: `${wf}/update${withEntity}`,
    body: { name: 'setPriority', args: ['high'] },
  },
  {
    name: 'start body',
    method: 'post',
    path: '/api/temporal/workflows',
    body: { workflowType: 'orderWorkflow', taskQueue: 'orders' },
  },
  {
    name: 'null args on a query',
    method: 'post',
    path: `${wf}/query${withEntity}`,
    body: { name: 'state', args: null },
  },
];

function call(app: express.Express | Server, probe: Probe) {
  const req = request(app)[probe.method](probe.path);
  if (probe.body !== undefined) {
    return req.send(probe.body as object);
  }
  return req;
}

describe('OpenAPI spec and program reconciliation', () => {
  let backend: Server;
  let spec: express.Express;

  beforeAll(async () => {
    ({ backend } = await startPlugin());
    spec = createSpecApp();
  });

  it.each(invalid)('rejects $name on both sides', async probe => {
    const specRes = await call(spec, probe);
    const backendRes = await call(backend, probe);
    expect({
      name: probe.name,
      spec: specRes.status,
      backend: backendRes.status,
    }).toEqual({
      name: probe.name,
      spec: expect.any(Number),
      backend: expect.any(Number),
    });
    expect(specRes.status).toBeGreaterThanOrEqual(400);
    expect(specRes.status).toBeLessThan(500);
    expect(backendRes.status).toBeGreaterThanOrEqual(400);
    expect(backendRes.status).toBeLessThan(500);
  });

  it.each(valid)('accepts $name on both sides', async probe => {
    const specRes = await call(spec, probe);
    const backendRes = await call(backend, probe);
    expect({
      name: probe.name,
      spec: specRes.status,
      backend: backendRes.status,
    }).toEqual({
      name: probe.name,
      spec: expect.any(Number),
      backend: expect.any(Number),
    });
    expect(specRes.status).toBeLessThan(400);
    expect(backendRes.status).toBeLessThan(400);
  });

  it('rejects a bad entityRef in the plugin; the spec cannot express the canonical form', async () => {
    const probe: Probe = {
      name: 'invalid entityRef',
      method: 'get',
      path: `${wf}/history?entityRef=not-a-ref`,
    };
    const specRes = await call(spec, probe);
    const backendRes = await call(backend, probe);
    expect(specRes.status).toBeLessThan(400);
    expect(backendRes.status).toBeGreaterThanOrEqual(400);
    expect(backendRes.status).toBeLessThan(500);
  });
});
