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
import type { Entity } from '@backstage/catalog-model';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  checkoutEntity,
  orderWorkflowEntity,
  ordersEntity,
  otherEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';
import {
  fakeScheduleService,
  FakeSchedule,
  grpcError,
} from './__testUtils__/schedules';

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

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
  /** Permission names that get a conditional decision. */
  conditional?: string[];
  entities?: Entity[];
  /** The schedules of the namespace. */
  schedules?: FakeSchedule[];
  /** The name of the entity reference search attribute. */
  entityRefAttribute?: string;
  /** The `temporal.control` config. */
  control?: object;
}) {
  const workflowService = {
    ...runningWorkflowService(),
    ...fakeScheduleService(options?.schedules ?? []),
  };
  const decide = (r: any) => ({
    result: options?.deny?.includes(r.permission.name)
      ? AuthorizeResult.DENY
      : AuthorizeResult.ALLOW,
  });
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests => requests.map(decide)) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map((r: any) =>
        options?.conditional?.includes(r.permission.name)
          ? {
              result: AuthorizeResult.CONDITIONAL,
              pluginId: 'catalog',
              resourceType: 'catalog-entity',
              conditions: { rule: 'IS_ENTITY_OWNER', params: { claims: [] } },
            }
          : decide(r),
      ),
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
      fakeTemporalServiceFactory(workflowService, {
        entityRefAttribute: options?.entityRefAttribute,
      }),
      permissions.factory,
      auditor.factory,
      mockServices.rootConfig.factory({
        data: { temporal: { control: options?.control ?? {} } },
      }),
    ],
  });
  return {
    server: await withOpenApiValidation(server),
    backend: server,
    workflowService,
    permissions,
    auditor,
    auditEvent,
  };
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

  it('treats an entity search attribute that is not a reference as no entity for a query', async () => {
    const withBadAttribute = async (
      options: { deny?: string[]; conditional?: string[] } = {},
    ) => {
      const started = await start({
        entityRefAttribute: 'BackstageEntityRef',
        ...options,
      });
      started.workflowService.describeWorkflowExecution.mockImplementation(
        async (req: any) => ({
          workflowExecutionInfo: {
            ...executionInfo({
              workflowId: req.execution.workflowId,
              status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
            }),
            searchAttributes: {
              indexedFields: {
                // The JSON form of a payload, as the client library decodes it.
                BackstageEntityRef: {
                  metadata: { encoding: b64('json/plain') },
                  data: b64(JSON.stringify('not a ref')),
                },
              },
            },
          },
          pendingActivities: [],
        }),
      );
      return started;
    };
    // From the Workflows page: the list permission, no entityRef. With no
    // entity, temporal.workflow.query must be allowed for every entity.
    const allowed = await withBadAttribute();
    const res = await request(allowed.server)
      .post(`${wf}/query`)
      .send({ name: 'state' });
    expect(res.status).toBe(200);
    expect(allowed.workflowService.queryWorkflow).toHaveBeenCalled();
    const names = allowed.permissions.authorizeConditional.mock.calls.flatMap(
      ([reqs]) => reqs.map((r: any) => r.permission.name),
    );
    expect(names).toContain('temporal.workflow.query');
    const denied = await withBadAttribute({
      deny: ['temporal.workflow.query'],
    });
    const refused = await request(denied.server)
      .post(`${wf}/query`)
      .send({ name: 'state' });
    expect(refused.status).toBe(403);
    expect(denied.workflowService.queryWorkflow).not.toHaveBeenCalled();
    // A conditional decision does not allow it for every entity either.
    const conditional = await withBadAttribute({
      conditional: ['temporal.workflow.query'],
    });
    const conditionalRes = await request(conditional.server)
      .post(`${wf}/query`)
      .send({ name: 'state' });
    expect(conditionalRes.status).toBe(403);
    expect(conditional.workflowService.queryWorkflow).not.toHaveBeenCalled();
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
    const schedules = [
      { scheduleId: 'weekly', workflowType: 'reportWorkflow', paused: true },
      { scheduleId: 'nightly', workflowType: 'orderWorkflow' },
    ];
    const { server } = await start({ schedules });
    const res = await request(server).get('/api/temporal/schedules');
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.items.map((s: any) => [s.scheduleId, s.paused])).toEqual([
      ['nightly', false],
      ['weekly', true],
    ]);
    expect(res.body.items[0]).toMatchObject({
      workflowType: 'orderWorkflow',
      spec: ['every 1h', '02:00 on MONDAY-FRIDAY'],
      nextActionTimes: ['2026-01-03T02:00:00.000Z'],
    });
    const denied = await start({
      schedules,
      deny: ['temporal.workflow.list'],
    });
    expect(
      (await request(denied.server).get('/api/temporal/schedules')).status,
    ).toBe(403);
  });

  it('lists the schedules that start the workflow types of an entity', async () => {
    const schedules = [
      { scheduleId: 'weekly', workflowType: 'reportWorkflow' },
      { scheduleId: 'nightly', workflowType: 'orderWorkflow' },
    ];
    const { server } = await start({ schedules });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => s.scheduleId)).toEqual(['nightly']);
    // The same workflow type on another task queue is another team's.
    const elsewhere = await start({
      schedules: [
        {
          scheduleId: 'nightly',
          workflowType: 'orderWorkflow',
          taskQueue: 'billing',
        },
      ],
    });
    const other = await request(elsewhere.server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(other.body.items).toEqual([]);
    const denied = await start({ schedules, deny: ['temporal.workflow.read'] });
    expect(
      (
        await request(denied.server).get(
          '/api/temporal/entities/component/default/orders/schedules',
        )
      ).status,
    ).toBe(403);
  });

  it('operates the schedules its list shows, including those of a related workflow entity with a task queue', async () => {
    const { server, workflowService } = await start({
      schedules: [
        { scheduleId: 'nightly', workflowType: 'orderWorkflow' },
        { scheduleId: 'weekly', workflowType: 'reportWorkflow' },
      ],
      entities: [checkoutEntity, orderWorkflowEntity],
    });
    const listed = await request(server).get(
      '/api/temporal/entities/component/default/checkout/schedules',
    );
    expect(listed.body.items.map((s: any) => s.scheduleId)).toEqual([
      'nightly',
    ]);
    const operate = (id: string) =>
      request(server)
        .post(
          `/api/temporal/namespaces/default/schedules/${id}/pause?entityRef=component:default/checkout`,
        )
        .send({});
    expect((await operate('nightly')).status).toBe(202);
    expect(workflowService.patchSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: 'nightly' }),
    );
    expect((await operate('weekly')).status).toBe(404);
    expect(workflowService.patchSchedule).toHaveBeenCalledTimes(1);
  });

  it('lists no schedules for an entity that has only a task queue', async () => {
    const { server } = await start({
      schedules: [
        {
          scheduleId: 'billing-run',
          workflowType: 'billingWorkflow',
          taskQueue: 'billing',
        },
      ],
      entities: [otherEntity],
    });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/billing/schedules',
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('lists the other schedules and this one when a schedule has payloads that cannot be decoded', async () => {
    // A worker with a payload codec (encryption) encodes the memo and the
    // arguments of its schedules; the plugin cannot read them.
    const { server } = await start({
      schedules: [
        { scheduleId: 'plain', workflowType: 'orderWorkflow' },
        {
          scheduleId: 'secret',
          workflowType: 'orderWorkflow',
          undecodable: true,
        },
      ],
    });
    const all = await request(server).get('/api/temporal/schedules');
    expect(all.status).toBe(200);
    expect(all.body.items.map((s: any) => s.scheduleId)).toEqual([
      'plain',
      'secret',
    ]);
    expect(all.body.items[1]).toMatchObject({
      workflowType: 'orderWorkflow',
      paused: false,
      nextActionTimes: ['2026-01-03T02:00:00.000Z'],
    });
    // The entity's list describes the schedules for their task queue.
    const entity = await request(server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(entity.status).toBe(200);
    expect(entity.body.items.map((s: any) => s.scheduleId)).toEqual([
      'plain',
      'secret',
    ]);
  });

  it('operates a schedule with payloads that cannot be decoded', async () => {
    const { server, workflowService } = await start({
      schedules: [
        {
          scheduleId: 'secret',
          workflowType: 'orderWorkflow',
          undecodable: true,
        },
      ],
    });
    for (const operation of ['pause', 'unpause', 'trigger']) {
      const res = await request(server)
        .post(
          `/api/temporal/namespaces/default/schedules/secret/${operation}?entityRef=component:default/orders`,
        )
        .send({});
      expect(res.status).toBe(202);
    }
    expect(workflowService.patchSchedule).toHaveBeenCalledTimes(3);
  });

  it('maps the Temporal errors of the schedule client', async () => {
    const down = await start();
    down.workflowService.listSchedules.mockRejectedValue(
      grpcError(14, 'connection refused'),
    );
    const res = await request(down.server).get('/api/temporal/schedules');
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('connection refused');

    // An error that is not about a payload is not hidden by the lenient
    // decoding.
    const refused = await start({
      schedules: [{ scheduleId: 'nightly', workflowType: 'orderWorkflow' }],
    });
    refused.workflowService.describeSchedule.mockRejectedValue(grpcError(7));
    const forbidden = await request(refused.server).get(
      '/api/temporal/entities/component/default/orders/schedules',
    );
    expect(forbidden.status).toBe(503);

    // A schedule deleted between the list and its describe is left out.
    const entity = await start({
      schedules: [
        { scheduleId: 'nightly', workflowType: 'orderWorkflow' },
        { scheduleId: 'gone', workflowType: 'orderWorkflow' },
      ],
    });
    const describe =
      entity.workflowService.describeSchedule.getMockImplementation()!;
    entity.workflowService.describeSchedule.mockImplementation(async req => {
      if (req.scheduleId === 'gone') throw grpcError(5, 'not found');
      return describe(req);
    });
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
    const { backend, workflowService } = await start({
      control: { enabled: false },
    });
    // Not served: answered without a body, outside the spec.
    const res = await request(backend)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(404);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });
});
