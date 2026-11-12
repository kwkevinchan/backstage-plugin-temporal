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

import { ScheduleNotFoundError, ServiceError } from '@temporalio/client';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { Entity } from '@backstage/catalog-model';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  fakeScheduleClient,
  ordersEntity,
  scheduleSummary,
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

const ticketWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'ticket-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
    messages: {
      signals: [
        {
          name: 'addNote',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
        },
      ],
      updates: [
        { name: 'approve', example: { approved: true }, userField: 'by' },
      ],
    },
  },
};

async function start(options?: {
  deny?: string[];
  entities?: Entity[];
  client?: unknown;
  /** The `temporal.control` config. */
  control?: object;
}) {
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
      catalogServiceMock.factory({
        entities: [ordersEntity, ...(options?.entities ?? [])],
      }),
      fakeTemporalServiceFactory(workflowService, { client: options?.client }),
      permissions.factory,
      auditor.factory,
      mockServices.rootConfig.factory({
        data: { temporal: { control: options?.control ?? {} } },
      }),
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

  it('adds what the TemporalWorkflow entity describes', async () => {
    const { server } = await start({ entities: [ticketWorkflowEntity] });
    const expected = {
      signals: [
        {
          name: 'addNote',
          description: 'Add a note',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
        },
      ],
      updates: [
        { name: 'setPriority' },
        { name: 'approve', example: { approved: true }, userField: 'by' },
      ],
      queries: [{ name: 'state' }],
    };
    // Opened with the TemporalWorkflow entity itself.
    const own = await request(server).get(
      `${wf}/handlers?entityRef=temporalworkflow:default/ticket-workflow`,
    );
    expect(own.status).toBe(200);
    expect(own.body).toEqual(expected);
    // Opened with another entity, or from the Workflows page: the entity
    // that matches the workflow type and task queue.
    const other = await request(server).get(`${wf}/handlers${withEntity}`);
    expect(other.body).toEqual(expected);
    const page = await request(server).get(`${wf}/handlers`);
    expect(page.body).toEqual(expected);
  });

  it('leaves out what an entity the caller cannot read describes', async () => {
    // From the Workflows page (the list permission), without the read
    // permission on the entity.
    const { server } = await start({
      entities: [ticketWorkflowEntity],
      deny: ['temporal.workflow.read'],
    });
    const res = await request(server).get(`${wf}/handlers`);
    expect(res.status).toBe(200);
    expect(res.body.updates).toEqual([{ name: 'setPriority' }]);
  });

  it('lists the schedules of the namespace with the list permission', async () => {
    const client = fakeScheduleClient([
      scheduleSummary('weekly', 'reportWorkflow', true),
      scheduleSummary('nightly', 'orderWorkflow'),
    ]);
    const { server } = await start({ client });
    const res = await request(server).get('/api/temporal/schedules');
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items.map((s: any) => [s.scheduleId, s.paused])).toEqual([
      ['nightly', false],
      ['weekly', true],
    ]);
    const denied = await start({ client, deny: ['temporal.workflow.list'] });
    expect(
      (await request(denied.server).get('/api/temporal/schedules')).status,
    ).toBe(403);
  });

  it('lists the schedules that start the workflow types of an entity', async () => {
    const client = fakeScheduleClient([
      scheduleSummary('weekly', 'reportWorkflow'),
      scheduleSummary('nightly', 'orderWorkflow'),
    ]);
    const { server } = await start({ client });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => s.scheduleId)).toEqual(['nightly']);
    // The same workflow type on another task queue is another team's.
    const elsewhere = await start({
      client: fakeScheduleClient(
        [scheduleSummary('nightly', 'orderWorkflow')],
        'billing',
      ),
    });
    const other = await request(elsewhere.server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(other.body.items).toEqual([]);
    const denied = await start({ client, deny: ['temporal.workflow.read'] });
    expect(
      (
        await request(denied.server).get(
          '/api/temporal/entities/component/default/orders/schedules',
        )
      ).status,
    ).toBe(403);
  });

  it('maps the Temporal errors of the schedule client', async () => {
    // The schedule client wraps the gRPC error in a ServiceError.
    const unreachable = new ServiceError('Failed to list schedules', {
      cause: Object.assign(new Error('14 UNAVAILABLE'), {
        code: 14,
        details: 'connection refused',
      }),
    });
    const down = fakeScheduleClient([]);
    down.schedule.list = async function* list() {
      yield* [];
      throw unreachable;
    };
    const { server } = await start({ client: down });
    const res = await request(server).get('/api/temporal/schedules');
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('connection refused');

    // A schedule deleted between the list and its describe is left out.
    const client = fakeScheduleClient([
      scheduleSummary('nightly', 'orderWorkflow'),
      scheduleSummary('gone', 'orderWorkflow'),
    ]);
    const getHandle = client.schedule.getHandle;
    client.schedule.getHandle = (id: string) => {
      const handle = getHandle(id);
      if (id === 'gone') {
        handle.describe.mockRejectedValue(
          new ScheduleNotFoundError('not found', id),
        );
      }
      return handle;
    };
    const entity = await start({ client });
    const listed = await request(entity.server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((s: any) => s.scheduleId)).toEqual([
      'nightly',
    ]);
  });

  it('refuses a search attribute filter that is not a name', async () => {
    const { server, workflowService } = await start();
    const res = await request(server).get(
      `/api/temporal/workflows?searchAttribute=${encodeURIComponent(
        'x = true OR y',
      )}`,
    );
    expect(res.status).toBe(400);
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('lists the handlers of a closed run, for the Query dialog', async () => {
    const { server, workflowService } = await start();
    workflowService.describeWorkflowExecution.mockImplementation(
      async (req: any) => ({
        workflowExecutionInfo: executionInfo({
          workflowId: req.execution.workflowId,
          status: 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
        }),
        pendingActivities: [],
      }),
    );
    const res = await request(server).get(`${wf}/handlers${withEntity}`);
    expect(res.status).toBe(200);
    expect(res.body.queries).toEqual([{ name: 'state' }]);
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

  it('serves no routes that change workflows when control is turned off', async () => {
    const { server, workflowService } = await start({
      control: { enabled: false },
    });
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(404);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });
});
