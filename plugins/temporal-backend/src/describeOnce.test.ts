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
import { createBackendModule } from '@backstage/backend-plugin-api';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import {
  temporalAccessServiceRef,
  TemporalAccessService,
  temporalWorkflowEnricherExtensionPoint,
} from './node/alpha';
import request from 'supertest';
import { memoryS3, storeExternally } from './__testUtils__/externalStorage';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
  otherEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

const ref = 'component:default/orders';
let memoField: unknown;

let stored: Awaited<ReturnType<typeof storeExternally>>;

beforeAll(async () => {
  stored = await storeExternally(memoryS3(), { plan: 'gold' });
  memoField = stored.payload;
});

async function start(
  options: {
    permission?: AuthorizeResult;
    access?: Partial<TemporalAccessService>;
  } = {},
) {
  const workflowService = createFakeWorkflowService();
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) =>
      ({
        workflowExecutionInfo: {
          ...executionInfo({
            workflowId: req.execution.workflowId,
            status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
          }),
          execution: {
            workflowId: req.execution.workflowId,
            runId: req.execution.runId ?? `${req.execution.workflowId}-run`,
          },
          memo: { fields: { customer: structuredClone(memoField) } },
        },
        pendingActivities: [],
      } as any),
  );
  const decision = { result: options.permission ?? AuthorizeResult.ALLOW };
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests => requests.map(() => decision)) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(() => decision),
    ) as any,
  });
  const enricher = createBackendModule({
    pluginId: 'temporal',
    moduleId: 'test-enricher',
    register(reg) {
      reg.registerInit({
        deps: { temporal: temporalWorkflowEnricherExtensionPoint },
        async init({ temporal }) {
          temporal.addWorkflowEnricher({
            id: 'test',
            enrich: async items =>
              items.map(item => ({ ...item, extensions: { test: true } })),
          });
        },
      });
    },
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      ...(options.access ? [] : [temporalAccessServiceFactory]),
      catalogServiceMock.factory({ entities: [ordersEntity, otherEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      enricher,
      ...(options.access
        ? [
            createServiceFactory({
              service: temporalAccessServiceRef,
              deps: {},
              factory: () => options.access as TemporalAccessService,
            }),
          ]
        : []),
    ],
  });
  return { server: await withOpenApiValidation(server), workflowService };
}

/** The memo field as the route shows it: where the payload is stored. */
function externalMemo() {
  return {
    encoding: 'json/protobuf',
    external: {
      store: 's3',
      bucket: 'payloads',
      key: stored.key,
      size: stored.size,
      sha256: stored.sha256,
    },
  };
}

describe('opening one workflow', () => {
  const path = '/api/temporal/namespaces/default/workflows/wf-1';

  it('describes it once for an entity, with the memo and the enrichers', async () => {
    const { server, workflowService } = await start();
    const res = await request(server).get(`${path}?entityRef=${ref}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workflowId: 'wf-1',
      runId: 'wf-1-run',
      memo: { customer: externalMemo() },
      extensions: { test: true },
    });
    expect(workflowService.describeWorkflowExecution).toHaveBeenCalledTimes(1);
  });

  it('describes it once from its search attribute, without entityRef', async () => {
    const { server, workflowService } = await start();
    const res = await request(server).get(`${path}/runs/wf-1-run`);
    // The fake workflow has no entity reference attribute: the Workflows
    // page permissions decide, and the enrichers need an entity.
    expect(res.status).toBe(200);
    expect(res.body.memo).toEqual({ customer: externalMemo() });
    expect(workflowService.describeWorkflowExecution).toHaveBeenCalledTimes(1);
  });

  it('does not describe when the permission on the entity is denied', async () => {
    const { server, workflowService } = await start({
      permission: AuthorizeResult.DENY,
    });
    await request(server).get(`${path}?entityRef=${ref}`).expect(403);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });

  it("answers 404 when the workflow is not the entity's", async () => {
    const { server, workflowService } = await start();
    await request(server)
      .get(`${path}?entityRef=component:default/billing`)
      .expect(404);
    expect(workflowService.describeWorkflowExecution).toHaveBeenCalledTimes(1);
  });

  it('answers 403 without describing when every permission that could allow it is denied', async () => {
    const { server, workflowService } = await start({
      permission: AuthorizeResult.DENY,
    });
    await request(server).get(path).expect(403);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });

  it('answers with the workflow of another access service as it is', async () => {
    const { server, workflowService } = await start({
      access: {
        loadWorkflow: async () => ({
          workflow: {
            workflowId: 'wf-1',
            runId: 'run-authorized',
            namespace: 'default',
            workflowType: 'orderWorkflow',
            taskQueue: 'orders',
            status: 'Running',
            pendingActivities: [],
          } as any,
        }),
      },
    });
    const res = await request(server).get(path);
    expect(res.status).toBe(200);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
    expect(res.body.runId).toBe('run-authorized');
  });
});
