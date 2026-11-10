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
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});

function runningWorkflowService() {
  const base = createFakeWorkflowService();
  return {
    ...base,
    describeWorkflowExecution: jest.fn(async (req: any) => ({
      workflowExecutionInfo: executionInfo({
        workflowId: req.execution.workflowId,
        status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
      }),
      pendingActivities: [],
    })),
    queryWorkflow: jest.fn(async (req: any) =>
      req.query.queryType === '__temporal_workflow_metadata'
        ? {
            queryResult: {
              payloads: [
                json({
                  definition: {
                    signalDefinitions: [
                      { name: 'addNote', description: 'Add a note' },
                      { name: '__stack_trace' },
                    ],
                    updateDefinitions: [{ name: 'setPriority' }],
                    queryDefinitions: [
                      { name: 'state' },
                      { name: '__temporal_workflow_metadata' },
                    ],
                  },
                }),
              ],
            },
          }
        : { queryResult: { payloads: [json({ notes: ['hello'] })] } },
    ),
  };
}

async function start(options?: { deny?: string[] }) {
  const workflowService = runningWorkflowService();
  const decide = (r: any) => ({
    result: options?.deny?.includes(r.permission.name)
      ? AuthorizeResult.DENY
      : AuthorizeResult.ALLOW,
  });
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests => requests.map(decide)) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(decide),
    ) as any,
  });
  const auditor = mockServices.auditor.mock();
  const auditEvent = { success: jest.fn(), fail: jest.fn() };
  auditor.createEvent.mockResolvedValue(auditEvent);
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      auditor.factory,
    ],
  });
  return { server, workflowService, permissions, auditor, auditEvent };
}

const wf = '/api/temporal/namespaces/default/workflows/wf-1';
const withEntity = '?entityRef=component:default/orders';

describe('query routes of the core plugin', () => {
  it('runs a query with the read and query permissions and records it', async () => {
    const { server, workflowService, permissions, auditEvent } = await start();
    const res = await request(server)
      .post(`${wf}/query${withEntity}`)
      .send({ name: 'state' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { notes: ['hello'] } });
    expect(workflowService.queryWorkflow.mock.calls[0][0]).toMatchObject({
      query: { queryType: 'state' },
    });
    const names = permissions.authorize.mock.calls.flatMap(([reqs]) =>
      reqs.map((r: any) => r.permission.name),
    );
    expect(names).toEqual([
      'temporal.workflow.read',
      'temporal.workflow.query',
    ]);
    expect(auditEvent.success).toHaveBeenCalled();
  });

  it('answers 403 for a query without temporal.workflow.query', async () => {
    const { server, workflowService } = await start({
      deny: ['temporal.workflow.query'],
    });
    const res = await request(server)
      .post(`${wf}/query${withEntity}`)
      .send({ name: 'state' });
    expect(res.status).toBe(403);
    expect(workflowService.queryWorkflow).not.toHaveBeenCalled();
  });

  it('lists the handlers with the read permission only', async () => {
    const { server } = await start({ deny: ['temporal.workflow.query'] });
    const res = await request(server).get(`${wf}/handlers${withEntity}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      signals: [{ name: 'addNote', description: 'Add a note' }],
      updates: [{ name: 'setPriority' }],
      queries: [{ name: 'state' }],
    });
  });

  it('lists no handlers when no worker answers', async () => {
    const { server, workflowService } = await start();
    workflowService.queryWorkflow.mockRejectedValue(
      Object.assign(new Error('deadline'), { code: 4 }),
    );
    const res = await request(server).get(`${wf}/handlers${withEntity}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ signals: [], updates: [], queries: [] });
  });

  it('serves no routes that change workflows without the control module', async () => {
    const { server, workflowService } = await start();
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(404);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });
});
