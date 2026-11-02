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
  createBackendModule,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { temporalWorkflowUpdatePermission } from './common';
import { TemporalControlAction, temporalExtensionPoint } from './extensions';
import { TemporalService, temporalServiceRef } from './service/TemporalService';
import request from 'supertest';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  orderWorkflowEntity,
  ordersEntity,
  otherEntity,
} from './testUtils';

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});
const b64 = (s: string) => Buffer.from(s).toString('base64');
const decode = (payload: any) =>
  JSON.parse(Buffer.from(payload.data).toString('utf8'));

function createControlWorkflowService(status = 'RUNNING') {
  const base = createFakeWorkflowService();
  return {
    ...base,
    describeWorkflowExecution: jest.fn(async (req: any) => ({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: req.execution.workflowId,
          status: `WORKFLOW_EXECUTION_STATUS_${status}`,
        }),
        searchAttributes: {
          indexedFields: {
            BackstageEntityRef: {
              metadata: { encoding: b64('json/plain') },
              data: b64(JSON.stringify('component:default/orders')),
            },
          },
        },
      },
      pendingActivities: [],
    })),
    getWorkflowExecutionHistory: jest.fn(async () => ({
      history: {
        events: [
          {
            eventId: '1',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
            workflowExecutionStartedEventAttributes: {
              workflowType: { name: 'orderWorkflow' },
              taskQueue: { name: 'orders' },
              input: { payloads: [json({ orderId: 'o-1' })] },
              searchAttributes: {
                indexedFields: {
                  BackstageEntityRef: json('component:default/orders'),
                  BackstageInitiator: json('user:default/someone'),
                },
              },
            },
          },
        ],
      },
      nextPageToken: new Uint8Array(),
    })),
    signalWorkflowExecution: jest.fn(async (_req: any) => ({})),
    updateWorkflowExecution: jest.fn(async (_req: any) => ({
      outcome: { success: { payloads: [json({ priority: 'high' })] } },
    })),
    pollWorkflowExecutionUpdate: jest.fn(async (_req: any) => ({})),
    queryWorkflow: jest.fn(async (_req: any) => ({
      queryResult: { payloads: [json({ notes: ['hello'] })] },
    })),
    requestCancelWorkflowExecution: jest.fn(async (_req: any) => ({})),
    terminateWorkflowExecution: jest.fn(async (_req: any) => ({})),
    startWorkflowExecution: jest.fn(async (_req: any) => ({
      runId: 'new-run',
    })),
  };
}

async function start(options?: {
  /** Permission names denied. */
  deny?: string[];
  /** Permission names that get a conditional decision. */
  conditional?: string[];
  control?: object;
  status?: string;
  action?: TemporalControlAction;
}) {
  const workflowService = createControlWorkflowService(options?.status);
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result: options?.deny?.includes(r.permission.name)
          ? AuthorizeResult.DENY
          : AuthorizeResult.ALLOW,
      })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map((r: any) => {
        if (options?.deny?.includes(r.permission.name)) {
          return { result: AuthorizeResult.DENY };
        }
        if (options?.conditional?.includes(r.permission.name)) {
          return {
            result: AuthorizeResult.CONDITIONAL,
            pluginId: 'catalog',
            resourceType: 'catalog-entity',
            conditions: { rule: 'IS_ENTITY_OWNER', params: { claims: [] } },
          };
        }
        return { result: AuthorizeResult.ALLOW };
      }),
    ) as any,
  });
  const auditor = mockServices.auditor.mock();
  const auditEvent = { success: jest.fn(), fail: jest.fn() };
  auditor.createEvent.mockResolvedValue(auditEvent);
  const client = { workflow: { getHandle: jest.fn() } };
  const service: TemporalService = {
    getClient: async () => client as any,
    getConnection: async () => ({ workflowService } as any),
    getDefaultNamespace: () => 'default',
    getAllowedNamespaces: () => ['default'],
    isNamespaceAllowed: ns => ns === 'default',
    getSearchAttributeNames: () => ({
      entityRef: 'BackstageEntityRef',
      initiator: 'BackstageInitiator',
    }),
    getWebUiUrl: () => undefined,
  };
  const features: any[] = [
    temporalPlugin,
    catalogServiceMock.factory({
      entities: [ordersEntity, otherEntity, orderWorkflowEntity],
    }),
    createServiceFactory({
      service: temporalServiceRef,
      deps: {},
      factory: () => service,
    }),
    permissions.factory,
    auditor.factory,
    mockServices.rootConfig.factory({
      data: { temporal: { control: options?.control ?? {} } },
    }),
  ];
  if (options?.action) {
    const action = options.action;
    features.push(
      createBackendModule({
        pluginId: 'temporal',
        moduleId: 'test-action',
        register(reg) {
          reg.registerInit({
            deps: { temporal: temporalExtensionPoint },
            async init({ temporal }) {
              temporal.addControlAction(action);
            },
          });
        },
      }),
    );
  }
  const { server } = await startTestBackend({ features });
  return { server, workflowService, permissions, auditor, auditEvent, client };
}

const wf = '/api/temporal/namespaces/default/workflows/wf-1';
const withEntity = '?entityRef=component:default/orders';

/** Every control route with a valid body, for the shared checks. */
const controlRoutes: [string, string, object][] = [
  ['signal', `${wf}/signal`, { name: 'addNote', args: ['hi'] }],
  ['update', `${wf}/update`, { name: 'setPriority', args: ['high'] }],
  ['cancel', `${wf}/cancel`, {}],
  ['terminate', `${wf}/terminate`, { reason: 'stuck' }],
  ['rerun', `${wf}/rerun`, {}],
  [
    'start',
    '/api/temporal/entities/component/default/orders/workflows',
    { args: [{ orderId: 'o-2' }] },
  ],
];

describe('workflow controls', () => {
  it('sends a signal with JSON arguments and records it', async () => {
    const { server, workflowService, permissions, auditor, auditEvent } =
      await start();
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote', args: ['hello', { n: 1 }] });
    expect(res.status).toBe(202);
    const call = workflowService.signalWorkflowExecution.mock.calls[0][0];
    expect(call).toMatchObject({
      namespace: 'default',
      workflowExecution: { workflowId: 'wf-1', runId: 'wf-1-run' },
      signalName: 'addNote',
      identity: 'backstage:user:default/mock',
    });
    expect(call.input.payloads.map(decode)).toEqual(['hello', { n: 1 }]);
    expect(permissions.authorize).toHaveBeenCalledWith(
      [
        {
          permission: expect.objectContaining({
            name: 'temporal.workflow.signal',
            resourceType: 'catalog-entity',
          }),
          resourceRef: 'component:default/orders',
        },
      ],
      expect.anything(),
    );
    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'workflow-signal',
        meta: expect.objectContaining({
          workflowId: 'wf-1',
          runId: 'wf-1-run',
          entityRef: 'component:default/orders',
          name: 'addNote',
        }),
      }),
    );
    expect(auditEvent.success).toHaveBeenCalled();
  });

  it('sends an update and returns its result', async () => {
    const { server, workflowService } = await start();
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', args: ['high'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { priority: 'high' } });
    const call = workflowService.updateWorkflowExecution.mock.calls[0][0];
    expect(call.request.input.name).toBe('setPriority');
    expect(call.request.input.args.payloads.map(decode)).toEqual(['high']);
  });

  it('polls an update that is not finished yet', async () => {
    const { server, workflowService } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({} as any);
    workflowService.pollWorkflowExecutionUpdate.mockResolvedValueOnce({
      outcome: { success: { payloads: [json(7)] } },
    } as any);
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority' });
    expect(res.body).toEqual({ result: 7 });
  });

  it('answers 400 with the message of a rejected update', async () => {
    const { server, workflowService, auditEvent } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({
      outcome: { failure: { message: 'priority must be low or high' } },
    } as any);
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', args: ['urgent'] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('priority must be low or high');
    expect(auditEvent.fail).toHaveBeenCalled();
  });

  it('queries with the read permission only', async () => {
    const { server, workflowService, permissions } = await start({
      deny: [
        'temporal.workflow.signal',
        'temporal.workflow.update',
        'temporal.workflow.cancel',
      ],
    });
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
    expect(names).toEqual(['temporal.workflow.read']);
  });

  it('cancels and terminates with a reason', async () => {
    const { server, workflowService } = await start();
    expect(
      (await request(server).post(`${wf}/cancel${withEntity}`)).status,
    ).toBe(202);
    expect(
      workflowService.requestCancelWorkflowExecution.mock.calls[0][0],
    ).toMatchObject({
      workflowExecution: { workflowId: 'wf-1', runId: 'wf-1-run' },
    });
    const res = await request(server)
      .post(`${wf}/terminate${withEntity}`)
      .send({ reason: 'stuck' });
    expect(res.status).toBe(200);
    expect(
      workflowService.terminateWorkflowExecution.mock.calls[0][0],
    ).toMatchObject({ reason: 'stuck' });
  });

  it('answers 409 when a closed workflow is signaled', async () => {
    const { server, workflowService } = await start({ status: 'COMPLETED' });
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(409);
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });

  it('reruns a closed run with its input and search attributes under a new ID', async () => {
    const { server, workflowService } = await start({ status: 'FAILED' });
    const res = await request(server).post(
      '/api/temporal/namespaces/default/workflows/wf-1-rerun-abc/rerun?entityRef=component:default/orders',
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      namespace: 'default',
      workflowId: expect.stringMatching(/^wf-1-rerun-[a-z0-9]+$/),
      runId: 'new-run',
    });
    const call = workflowService.startWorkflowExecution.mock.calls[0][0];
    expect(call.workflowType).toEqual({ name: 'orderWorkflow' });
    expect(call.taskQueue).toEqual({ name: 'orders' });
    expect(call.input.payloads.map(decode)).toEqual([{ orderId: 'o-1' }]);
    expect(decode(call.searchAttributes.indexedFields.BackstageEntityRef)).toBe(
      'component:default/orders',
    );
    expect(decode(call.searchAttributes.indexedFields.BackstageInitiator)).toBe(
      'user:default/mock',
    );
  });

  it('starts a workflow of a TemporalWorkflow entity with its spec', async () => {
    const { server, workflowService } = await start();
    const res = await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({ args: [{ orderId: 'o-9' }], workflowId: 'my-order' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      namespace: 'default',
      workflowId: 'my-order',
      runId: 'new-run',
    });
    const call = workflowService.startWorkflowExecution.mock.calls[0][0];
    expect(call).toMatchObject({
      namespace: 'default',
      workflowId: 'my-order',
      workflowType: { name: 'orderWorkflow' },
      taskQueue: { name: 'orders' },
    });
    expect(call.input.payloads.map(decode)).toEqual([{ orderId: 'o-9' }]);
    expect(decode(call.searchAttributes.indexedFields.BackstageEntityRef)).toBe(
      'temporalworkflow:default/order-workflow',
    );
    expect(decode(call.searchAttributes.indexedFields.BackstageInitiator)).toBe(
      'user:default/mock',
    );
  });

  it('makes a workflow ID when none is given', async () => {
    const { server } = await start();
    const res = await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({});
    expect(res.body.workflowId).toMatch(/^orderWorkflow-[a-z0-9]+$/);
  });

  it('does not start workflow types of other entities', async () => {
    const { server, workflowService } = await start();
    const res = await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({ workflowType: 'paymentWorkflow' });
    expect(res.status).toBe(400);
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
  });

  it('starts a workflow from the Workflows page', async () => {
    const { server, workflowService, permissions } = await start();
    const res = await request(server)
      .post('/api/temporal/workflows')
      .send({ workflowType: 'anyWorkflow', taskQueue: 'jobs', args: [1] });
    expect(res.status).toBe(201);
    expect(workflowService.startWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: { name: 'anyWorkflow' },
        taskQueue: { name: 'jobs' },
      }),
    );
    expect(permissions.authorizeConditional).toHaveBeenCalledWith(
      [
        {
          permission: expect.objectContaining({
            name: 'temporal.workflow.start',
          }),
        },
      ],
      expect.anything(),
    );
  });

  it('does not start from the Workflows page with a conditional decision', async () => {
    const { server, workflowService } = await start({
      conditional: ['temporal.workflow.start'],
    });
    const res = await request(server)
      .post('/api/temporal/workflows')
      .send({ workflowType: 'anyWorkflow', taskQueue: 'jobs' });
    expect(res.status).toBe(403);
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
  });

  it('checks the entity from the search attribute without an entityRef', async () => {
    const { server, permissions } = await start();
    const res = await request(server).post(`${wf}/cancel`).send({});
    expect(res.status).toBe(202);
    expect(permissions.authorize).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          permission: expect.objectContaining({
            name: 'temporal.workflow.cancel',
          }),
          resourceRef: 'component:default/orders',
        }),
      ],
      expect.anything(),
    );
  });

  it.each(controlRoutes)(
    'answers 403 for %s when the permission is denied',
    async (operation, path, payload) => {
      const permission =
        operation === 'start'
          ? 'temporal.workflow.start'
          : `temporal.workflow.${operation}`;
      const { server, workflowService, auditor } = await start({
        deny: [permission],
        status: operation === 'rerun' ? 'COMPLETED' : 'RUNNING',
      });
      const res = await request(server)
        .post(operation === 'start' ? path : `${path}${withEntity}`)
        .send(payload);
      expect(res.status).toBe(403);
      expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
      expect(workflowService.updateWorkflowExecution).not.toHaveBeenCalled();
      expect(
        workflowService.requestCancelWorkflowExecution,
      ).not.toHaveBeenCalled();
      expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
      expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
      expect(auditor.createEvent).not.toHaveBeenCalled();
    },
  );

  it.each(controlRoutes)(
    'answers 404 for %s when the controls are disabled',
    async (_operation, path, payload) => {
      const { server, workflowService } = await start({
        control: { enabled: false },
      });
      const res = await request(server)
        .post(`${path}${withEntity}`)
        .send(payload);
      expect(res.status).toBe(404);
      expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
    },
  );

  it('keeps queries when the controls are disabled', async () => {
    const { server } = await start({ control: { enabled: false } });
    const res = await request(server)
      .post(`${wf}/query${withEntity}`)
      .send({ name: 'state' });
    expect(res.status).toBe(200);
  });

  it('answers 400 for signals and updates that are not allowed', async () => {
    const { server, workflowService } = await start({
      control: { allowedSignals: ['addNote'], allowedUpdates: ['setPriority'] },
    });
    const signal = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'close' });
    expect(signal.status).toBe(400);
    expect(signal.body.error.message).toContain('Signal close is not allowed');
    const update = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'reset' });
    expect(update.status).toBe(400);
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
    expect(workflowService.updateWorkflowExecution).not.toHaveBeenCalled();
    const allowed = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(allowed.status).toBe(202);
  });

  it('rejects bad bodies', async () => {
    const { server } = await start();
    expect(
      (await request(server).post(`${wf}/signal${withEntity}`).send({})).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post(`${wf}/signal${withEntity}`)
          .send({ name: 'x', args: 'not-an-array' })
      ).status,
    ).toBe(400);
  });

  describe('custom actions', () => {
    const handle = jest.fn(async (_ref: any, body: any, context: any) => ({
      echoed: body,
      entity: context.entity?.metadata.name,
    }));
    const action: TemporalControlAction = {
      id: 'escalate',
      permission: temporalWorkflowUpdatePermission,
      filter: w => w.status === 'Running',
      handle,
    };

    beforeEach(() => handle.mockClear());

    it('runs a registered action', async () => {
      const { server, auditor } = await start({ action });
      const res = await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({ level: 2 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        result: { echoed: { level: 2 }, entity: 'orders' },
      });
      expect(handle.mock.calls[0][0]).toEqual({
        namespace: 'default',
        workflowId: 'wf-1',
        runId: 'wf-1-run',
      });
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-action',
          meta: expect.objectContaining({ actionId: 'escalate' }),
        }),
      );
    });

    it('answers 403 when the action permission is denied', async () => {
      const { server } = await start({
        action,
        deny: ['temporal.workflow.update'],
      });
      const res = await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({});
      expect(res.status).toBe(403);
      expect(handle).not.toHaveBeenCalled();
    });

    it('answers 409 when the filter does not match and 404 for unknown actions', async () => {
      const { server } = await start({ action, status: 'COMPLETED' });
      expect(
        (await request(server).post(`${wf}/actions/escalate${withEntity}`))
          .status,
      ).toBe(409);
      expect(
        (await request(server).post(`${wf}/actions/unknown${withEntity}`))
          .status,
      ).toBe(404);
      expect(handle).not.toHaveBeenCalled();
    });
  });
});
