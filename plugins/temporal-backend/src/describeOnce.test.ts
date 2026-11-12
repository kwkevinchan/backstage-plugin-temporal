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
import { temporalExtensionPoint } from '@kwkevinchan/backstage-plugin-temporal-node';
import { Readable } from 'node:stream';
import request from 'supertest';
import { memoryS3, storeExternally } from './__testUtils__/externalStorage';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';

/** Objects of the mocked S3 service, by key. */
const mockObjects = new Map<string, Buffer>();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: async (command: any) => {
        const data = mockObjects.get(command.input.Key);
        if (!data) throw new Error('NoSuchKey');
        const stream = Readable.from([data]) as any;
        stream.transformToByteArray = async () => new Uint8Array(data);
        return { Body: stream, ContentLength: data.length };
      },
    })),
  };
});

const ref = 'component:default/orders';
let memoField: unknown;

beforeAll(async () => {
  const s3 = memoryS3();
  const stored = await storeExternally(s3, { plan: 'gold' });
  mockObjects.set(
    stored.key,
    Buffer.from(s3.objects.get(`payloads/${stored.key}`)!),
  );
  memoField = stored.payload;
});

async function start(options: { permission?: AuthorizeResult } = {}) {
  const workflowService = createFakeWorkflowService();
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) =>
      ({
        workflowExecutionInfo: {
          ...executionInfo({
            workflowId: req.execution.workflowId,
            status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
          }),
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
        deps: { temporal: temporalExtensionPoint },
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
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      enricher,
      mockServices.rootConfig.factory({
        data: {
          temporal: {
            externalStorage: {
              s3: {
                bucket: 'payloads',
                endpoint: 'http://localhost:9100',
                forcePathStyle: true,
                credentials: { accessKeyId: 'a', secretAccessKey: 's' },
              },
            },
          },
        },
      }),
    ],
  });
  return { server, workflowService };
}

describe('opening one workflow', () => {
  const path = '/api/temporal/namespaces/default/workflows/wf-1';

  it('describes it once for an entity, with the memo from S3 and the enrichers', async () => {
    const { server, workflowService } = await start();
    const res = await request(server).get(`${path}?entityRef=${ref}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workflowId: 'wf-1',
      runId: 'wf-1-run',
      memo: { customer: { plan: 'gold' } },
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
    expect(res.body.memo).toEqual({ customer: { plan: 'gold' } });
    expect(workflowService.describeWorkflowExecution).toHaveBeenCalledTimes(1);
  });

  it('does not read S3 or describe again when the access is denied', async () => {
    const { server, workflowService } = await start({
      permission: AuthorizeResult.DENY,
    });
    await request(server).get(`${path}?entityRef=${ref}`).expect(403);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });
});
