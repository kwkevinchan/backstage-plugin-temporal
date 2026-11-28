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
  coreServices,
  createBackendModule,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { temporalWorkflowUpdatePermission } from './common';
import {
  TemporalControlAction,
  temporalControlExtensionPoint,
} from './node/alpha';
import { TemporalService, temporalServiceRef } from './node';
import request from 'supertest';
import Router from 'express-promise-router';
import { temporalAccessServiceFactory } from './alpha';
import {
  checkoutEntity,
  createFakeConnection,
  createFakeWorkflowService,
  deadlineExceeded,
  executionInfo,
  orderWorkflowEntity,
  ordersEntity,
  otherEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';
import {
  recordingLogger,
  recordingLoggerFactory,
  type RecordingLogger,
} from './__testUtils__/recordingLogger';
import {
  fakeScheduleService,
  FakeSchedule,
  grpcError,
} from './__testUtils__/schedules';
import { temporalPlugin } from './plugin';
import { ConflictError as BackstageConflictError } from '@backstage/errors';
import {
  ServiceError,
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
  WorkflowUpdateRPCTimeoutOrCancelledError,
} from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});
const b64 = (s: string) => Buffer.from(s).toString('base64');
const decode = (payload: any) =>
  JSON.parse(Buffer.from(payload.data).toString('utf8'));

function createControlWorkflowService(
  status = 'RUNNING',
  entityAttribute: string | null = 'component:default/orders',
) {
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
          indexedFields:
            entityAttribute === null
              ? {}
              : {
                  BackstageEntityRef: {
                    metadata: { encoding: b64('json/plain') },
                    data: b64(JSON.stringify(entityAttribute)),
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
                  TemporalScheduledById: json('nightly'),
                  TemporalScheduledStartTime: json('2026-01-01T00:00:00Z'),
                  TemporalChangeVersion: json(['patch-1']),
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
  /** Permission names or `{ permission, resourceRef }` rules denied. */
  deny?: Array<string | { permission: string; resourceRef: string }>;
  /** Permission names that get a conditional decision. */
  conditional?: string[];
  control?: object;
  status?: string;
  /** The entity search attribute of the workflow; null for none. */
  entityAttribute?: string | null;
  action?: TemporalControlAction;
  /** Schedules of the fake client. */
  schedules?: FakeSchedule[];
  /** gRPC errors of the schedule calls, by method name. */
  scheduleErrors?: { describeSchedule?: unknown; patchSchedule?: unknown };
  logger?: ReturnType<typeof mockServices.logger.mock>;
  /** Records what the plugin logs, with the fields of its child loggers. */
  recorder?: RecordingLogger;
  /** An error of opening the connection to Temporal. */
  connectionError?: unknown;
  /** An error of getting the client of a namespace. */
  clientError?: unknown;
  /** More features of the test backend, such as a module with its own route. */
  extraFeatures?: any[];
}) {
  const workflowService = {
    ...createControlWorkflowService(options?.status, options?.entityAttribute),
    ...fakeScheduleService(options?.schedules ?? []),
  };
  for (const [method, error] of Object.entries(options?.scheduleErrors ?? {})) {
    (workflowService as any)[method].mockRejectedValue(error);
  }
  const isDenied = (r: any, includeResourceRef: boolean) =>
    options?.deny?.some(rule =>
      typeof rule === 'string'
        ? rule === r.permission.name
        : includeResourceRef &&
          rule.permission === r.permission.name &&
          rule.resourceRef === r.resourceRef,
    );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result: isDenied(r, true)
          ? AuthorizeResult.DENY
          : AuthorizeResult.ALLOW,
      })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map((r: any) => {
        if (isDenied(r, false)) {
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
  const connection = createFakeConnection(workflowService);
  /** The patches sent to a schedule: `{ pause }`, `{ unpause }`, ... */
  const patchesOf = (scheduleId: string) =>
    workflowService.patchSchedule.mock.calls
      .map(([req]) => req)
      .filter(req => req.scheduleId === scheduleId)
      .map(req => req.patch);
  const service: TemporalService = {
    getClient: async () => {
      if (options?.clientError) throw options.clientError;
      return client as any;
    },
    getConnection: async () => {
      if (options?.connectionError) throw options.connectionError;
      return connection as any;
    },
    getDefaultNamespace: () => 'default',
    isNamespaceAllowed: ns => ns === 'default' || ns === 'other',
    getSearchAttributeNames: () => ({
      entityRef: 'BackstageEntityRef',
      initiator: 'BackstageInitiator',
    }),
    getWebUiUrl: () => undefined,
  };
  const features: any[] = [
    temporalAccessServiceFactory,
    temporalPlugin,
    catalogServiceMock.factory({
      entities: [
        ordersEntity,
        otherEntity,
        orderWorkflowEntity,
        checkoutEntity,
      ],
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
  if (options?.logger) features.push(options.logger.factory);
  if (options?.recorder) {
    features.push(recordingLoggerFactory(options.recorder));
  }
  if (options?.action) {
    const action = options.action;
    features.push(
      createBackendModule({
        pluginId: 'temporal',
        moduleId: 'test-action',
        register(reg) {
          reg.registerInit({
            deps: { temporal: temporalControlExtensionPoint },
            async init({ temporal }) {
              temporal.addControlAction(action);
            },
          });
        },
      }),
    );
  }
  features.push(...(options?.extraFeatures ?? []));
  const { server } = await startTestBackend({ features });
  return {
    server: await withOpenApiValidation(server),
    backend: server,
    workflowService,
    permissions,
    auditor,
    auditEvent,
    client,
    patchesOf,
    connection,
  };
}

const wf = '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run';
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
    expect(call.workflowExecution).toEqual({ workflowId: 'wf-1' });
    expect(call.firstExecutionRunId).toBe('wf-1-run');
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

  it('sends the update ID of the request and polls with it', async () => {
    const { server, workflowService } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({} as any);
    workflowService.pollWorkflowExecutionUpdate.mockResolvedValueOnce({
      outcome: { success: { payloads: [json(1)] } },
    } as any);
    await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', updateId: ' retry-1 ' })
      .expect(200);
    expect(
      workflowService.updateWorkflowExecution.mock.calls[0][0].request.meta
        .updateId,
    ).toBe('retry-1');
    expect(
      workflowService.pollWorkflowExecutionUpdate.mock.calls[0][0].updateRef
        .updateId,
    ).toBe('retry-1');
  });

  it('makes an update ID when the request has none', async () => {
    const { server, workflowService } = await start();
    await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', updateId: null })
      .expect(200);
    expect(
      workflowService.updateWorkflowExecution.mock.calls[0][0].request.meta
        .updateId,
    ).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([[''], ['   '], [7], ['x'.repeat(201)]])(
    'answers 400 for the update ID %p',
    async updateId => {
      const { server, workflowService } = await start();
      const res = await request(server)
        .post(`${wf}/update${withEntity}`)
        .send({ name: 'setPriority', updateId });
      expect(res.status).toBe(400);
      expect(workflowService.updateWorkflowExecution).not.toHaveBeenCalled();
    },
  );

  it('answers 409 when the chain has ended while an update is polled', async () => {
    const { server, workflowService } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({} as any);
    workflowService.pollWorkflowExecutionUpdate.mockRejectedValueOnce(
      Object.assign(new Error('workflow execution already completed'), {
        code: 5,
      }),
    );
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority' });
    expect(res.status).toBe(409);
  });

  it('polls a chain update against the run ID returned by Temporal', async () => {
    const { server, workflowService } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({
      updateRef: {
        workflowExecution: { workflowId: 'wf-1', runId: 'wf-1-run-3' },
        updateId: 'upd-1',
      },
    } as any);
    workflowService.pollWorkflowExecutionUpdate.mockResolvedValueOnce({
      outcome: { success: { payloads: [json({ ok: true })] } },
    } as any);
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { ok: true } });
    expect(
      workflowService.pollWorkflowExecutionUpdate.mock.calls[0][0],
    ).toMatchObject({
      updateRef: {
        workflowExecution: { workflowId: 'wf-1', runId: 'wf-1-run-3' },
      },
    });
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

  it('cancels and terminates the chain with a reason', async () => {
    const { server, workflowService } = await start();
    expect(
      (await request(server).post(`${wf}/cancel${withEntity}`).send({})).status,
    ).toBe(202);
    const cancelCall =
      workflowService.requestCancelWorkflowExecution.mock.calls[0][0];
    expect(cancelCall).toMatchObject({
      workflowExecution: { workflowId: 'wf-1' },
      firstExecutionRunId: 'wf-1-run',
    });
    expect(cancelCall.workflowExecution.runId).toBeUndefined();
    const res = await request(server)
      .post(`${wf}/terminate${withEntity}`)
      .send({ reason: 'stuck' });
    expect(res.status).toBe(200);
    const terminateCall =
      workflowService.terminateWorkflowExecution.mock.calls[0][0];
    expect(terminateCall).toMatchObject({
      workflowExecution: { workflowId: 'wf-1' },
      firstExecutionRunId: 'wf-1-run',
      reason: 'stuck',
    });
    expect(terminateCall.workflowExecution.runId).toBeUndefined();
  });

  it('answers 409 when a closed workflow is signaled', async () => {
    const { server, workflowService } = await start({ status: 'COMPLETED' });
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(409);
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });

  it('answers 409 with the run it continued as when a run that continued as new is signaled', async () => {
    const { server, workflowService } = await start({
      status: 'CONTINUED_AS_NEW',
    });
    workflowService.getWorkflowExecutionHistoryReverse.mockResolvedValue({
      history: {
        events: [
          {
            eventId: '9',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
            workflowExecutionContinuedAsNewEventAttributes: {
              newExecutionRunId: 'wf-1-run-2',
            },
          },
        ],
      },
    } as any);
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      name: 'ConflictError',
      continuedAsNewRunId: 'wf-1-run-2',
    });
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });

  it('answers 409 without a run to follow when a completed run is signaled', async () => {
    const { server } = await start({ status: 'COMPLETED' });
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(409);
    expect(res.body.error.continuedAsNewRunId).toBeUndefined();
  });

  it('operates update, cancel and terminate across the chain from a continued-as-new run using run A permissions only', async () => {
    const { server, workflowService, permissions, auditor, auditEvent } =
      await start({
        status: 'CONTINUED_AS_NEW',
      });
    const runAPath =
      '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run-2';
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: 'wf-1',
          runId: 'wf-1-run-2',
          firstRunId: 'wf-1-run-1',
          status: 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW',
        }),
        searchAttributes: {
          indexedFields: {
            BackstageEntityRef: json('component:default/orders'),
          },
        },
      },
      pendingActivities: [],
    } as any);

    const updateRes = await request(server)
      .post(`${runAPath}/update${withEntity}`)
      .send({ name: 'setPriority', args: ['high'] });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body).toEqual({ result: { priority: 'high' } });

    const cancelRes = await request(server)
      .post(`${runAPath}/cancel${withEntity}`)
      .send({});
    expect(cancelRes.status).toBe(202);

    const terminateRes = await request(server)
      .post(`${runAPath}/terminate${withEntity}`)
      .send({ reason: 'chain stop' });
    expect(terminateRes.status).toBe(200);

    for (const call of [
      workflowService.updateWorkflowExecution.mock.calls[0][0],
      workflowService.requestCancelWorkflowExecution.mock.calls[0][0],
      workflowService.terminateWorkflowExecution.mock.calls[0][0],
    ]) {
      expect(call.workflowExecution).toEqual({ workflowId: 'wf-1' });
      expect((call.workflowExecution as any).runId).toBeUndefined();
      expect(call.firstExecutionRunId).toBe('wf-1-run-1');
    }

    // Option 2: only the opened run A is described and authorized, never Run B.
    expect(workflowService.describeWorkflowExecution).toHaveBeenCalledTimes(3);
    for (const [descReq] of workflowService.describeWorkflowExecution.mock
      .calls) {
      expect(descReq.execution).toEqual({
        workflowId: 'wf-1',
        runId: 'wf-1-run-2',
      });
    }
    const authRequests = permissions.authorize.mock.calls.flatMap(
      ([reqs]) => reqs,
    );
    expect(authRequests.map(r => (r as any).resourceRef)).toEqual(
      Array(authRequests.length).fill('component:default/orders'),
    );
    expect(authRequests.map(r => r.permission.name)).toEqual(
      expect.arrayContaining([
        'temporal.workflow.read',
        'temporal.workflow.update',
        'temporal.workflow.cancel',
        'temporal.workflow.terminate',
      ]),
    );

    for (const eventId of [
      'workflow-update',
      'workflow-cancel',
      'workflow-terminate',
    ]) {
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId,
          meta: expect.objectContaining({
            workflowId: 'wf-1',
            runId: 'wf-1-run-2',
          }),
        }),
      );
      expect(auditEvent.success).toHaveBeenCalledWith({
        meta: expect.objectContaining({
          workflowId: 'wf-1',
          runId: 'wf-1-run-2',
          firstRunId: 'wf-1-run-1',
          scope: 'chain',
        }),
      });
    }
  });

  it('answers 409 without continuedAsNewRunId when Temporal rejects a chain whose workflow ID moved to another chain', async () => {
    const { server, workflowService } = await start();
    const err = grpcError(5, 'workflow execution not found');
    workflowService.updateWorkflowExecution.mockRejectedValueOnce(err);
    workflowService.requestCancelWorkflowExecution.mockRejectedValueOnce(err);
    workflowService.terminateWorkflowExecution.mockRejectedValueOnce(err);

    for (const [route, body] of [
      ['update', { name: 'setPriority' }],
      ['cancel', {}],
      ['terminate', { reason: 'stuck' }],
    ] as const) {
      const res = await request(server)
        .post(`${wf}/${route}${withEntity}`)
        .send(body);
      expect([route, res.status]).toEqual([route, 409]);
      expect(res.body.error).toMatchObject({
        name: 'ConflictError',
        message: expect.stringMatching(/different execution chain/),
      });
      expect(res.body.error.continuedAsNewRunId).toBeUndefined();
    }
  });

  it('answers 409 when Temporal reports the execution chain has already ended', async () => {
    const { server, workflowService } = await start({ status: 'COMPLETED' });
    const err = grpcError(5, 'workflow execution already completed');
    workflowService.updateWorkflowExecution.mockRejectedValueOnce(err);
    workflowService.terminateWorkflowExecution.mockRejectedValueOnce(err);

    for (const [route, body] of [
      ['update', { name: 'setPriority' }],
      ['terminate', { reason: 'stuck' }],
    ] as const) {
      const res = await request(server)
        .post(`${wf}/${route}${withEntity}`)
        .send(body);
      expect([route, res.status]).toEqual([route, 409]);
      expect(res.body.error).toMatchObject({
        name: 'ConflictError',
        message: expect.stringMatching(/already ended/),
      });
      expect(res.body.error.continuedAsNewRunId).toBeUndefined();
    }
  });

  it('answers 202 for a cancel when Temporal does nothing for an ended chain', async () => {
    const { server, workflowService } = await start({ status: 'COMPLETED' });
    workflowService.requestCancelWorkflowExecution.mockResolvedValueOnce({});
    const res = await request(server)
      .post(`${wf}/cancel${withEntity}`)
      .send({});
    expect(res.status).toBe(202);
    expect(
      workflowService.requestCancelWorkflowExecution,
    ).toHaveBeenCalledTimes(1);
  });

  it('locks update, cancel and terminate to the opened run when Temporal reports no first run ID', async () => {
    const { server, workflowService } = await start();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: {
        ...executionInfo({ workflowId: 'wf-1', runId: 'wf-1-run' }),
        firstRunId: '',
        searchAttributes: {
          indexedFields: {
            BackstageEntityRef: json('component:default/orders'),
          },
        },
      },
      pendingActivities: [],
    } as any);
    for (const [route, body] of [
      ['update', { name: 'setPriority', args: ['high'] }],
      ['cancel', {}],
      ['terminate', { reason: 'stuck' }],
    ] as const) {
      const res = await request(server)
        .post(`${wf}/${route}${withEntity}`)
        .send(body);
      expect([route, res.status < 300]).toEqual([route, true]);
    }
    for (const call of [
      workflowService.updateWorkflowExecution.mock.calls[0][0],
      workflowService.requestCancelWorkflowExecution.mock.calls[0][0],
      workflowService.terminateWorkflowExecution.mock.calls[0][0],
    ]) {
      expect(call.workflowExecution).toEqual({
        workflowId: 'wf-1',
        runId: 'wf-1-run',
      });
      expect(call.firstExecutionRunId).toBeUndefined();
    }
  });

  it('answers 409 for a missing update during polling, like the update call', async () => {
    const { server, workflowService } = await start();
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({
      updateRef: {
        workflowExecution: { workflowId: 'wf-1', runId: 'wf-1-run-3' },
        updateId: 'upd-1',
      },
    } as any);
    workflowService.pollWorkflowExecutionUpdate.mockRejectedValueOnce(
      grpcError(5, 'update not found'),
    );
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority' });
    expect(res.status).toBe(409);
  });

  it('answers 409 for a rerun of a run that is still running', async () => {
    const { server, workflowService, auditor, auditEvent } = await start();
    const res = await request(server).post(`${wf}/rerun${withEntity}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('still running');
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'workflow-rerun' }),
    );
    expect(auditEvent.fail).toHaveBeenCalled();
  });

  it('reruns a closed run with its input and search attributes under a new ID', async () => {
    const { server, workflowService } = await start({ status: 'FAILED' });
    const res = await request(server)
      .post(
        '/api/temporal/namespaces/default/workflows/wf-1-rerun-abc/runs/wf-1-rerun-abc-run/rerun?entityRef=component:default/orders',
      )
      .send({});
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

  it('does not copy the search attributes of Temporal to a rerun', async () => {
    const { server, workflowService } = await start({ status: 'FAILED' });
    await request(server).post(`${wf}/rerun${withEntity}`).send({}).expect(201);
    const { indexedFields } =
      workflowService.startWorkflowExecution.mock.calls[0][0].searchAttributes;
    expect(Object.keys(indexedFields).sort()).toEqual([
      'BackstageEntityRef',
      'BackstageInitiator',
    ]);
  });

  it('keeps the ID of a rerun within 1000 characters and its -rerun mark', async () => {
    const { server, workflowService } = await start({ status: 'FAILED' });
    const longId = 'w'.repeat(995);
    const res = await request(server)
      .post(
        `/api/temporal/namespaces/default/workflows/${longId}/runs/run-1/rerun${withEntity}`,
      )
      .send({})
      .expect(201);
    expect(res.body.workflowId).toHaveLength(1000);
    expect(res.body.workflowId).toMatch(/^w+-rerun-[a-z0-9]+$/);
    expect(
      workflowService.startWorkflowExecution.mock.calls[0][0].workflowId,
    ).toBe(res.body.workflowId);
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

  it('refuses namespaces that are not in temporal.connection.namespaces', async () => {
    const { server, workflowService } = await start();
    const other =
      '/api/temporal/namespaces/secret/workflows/wf-1/runs/wf-1-run';
    for (const op of ['signal', 'update', 'cancel', 'terminate', 'rerun']) {
      const res = await request(server)
        .post(`${other}/${op}${withEntity}`)
        .send({ name: 'addNote', reason: 'test' });
      expect([op, res.status]).toEqual([op, 400]);
    }
    const started = await request(server).post('/api/temporal/workflows').send({
      namespace: 'secret',
      workflowType: 'anyWorkflow',
      taskQueue: 'jobs',
    });
    expect(started.status).toBe(400);
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
    expect(workflowService.updateWorkflowExecution).not.toHaveBeenCalled();
    expect(
      workflowService.requestCancelWorkflowExecution,
    ).not.toHaveBeenCalled();
    expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
  });

  it('starts a workflow from the Temporal page', async () => {
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

  it('forwards allowed workflowIdReusePolicy on start and omits it when unset', async () => {
    const { server, workflowService } = await start();

    const entityRes = await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({
        workflowId: 'id-1',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    expect(entityRes.status).toBe(201);
    expect(workflowService.startWorkflowExecution.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        workflowId: 'id-1',
        workflowIdReusePolicy: 3,
      }),
    );

    const directRes = await request(server)
      .post('/api/temporal/workflows')
      .send({
        workflowType: 'anyWorkflow',
        taskQueue: 'jobs',
        workflowId: 'id-2',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
      });
    expect(directRes.status).toBe(201);
    expect(workflowService.startWorkflowExecution.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        workflowId: 'id-2',
        workflowIdReusePolicy: 2,
      }),
    );

    const allowRes = await request(server)
      .post('/api/temporal/workflows')
      .send({
        workflowType: 'anyWorkflow',
        taskQueue: 'jobs',
        workflowId: 'id-3',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    expect(allowRes.status).toBe(201);
    expect(workflowService.startWorkflowExecution.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        workflowId: 'id-3',
        workflowIdReusePolicy: 1,
      }),
    );

    const plainRes = await request(server)
      .post('/api/temporal/workflows')
      .send({
        workflowType: 'anyWorkflow',
        taskQueue: 'jobs',
        workflowId: 'id-4',
      });
    expect(plainRes.status).toBe(201);
    expect(
      workflowService.startWorkflowExecution.mock.calls[3][0],
    ).not.toHaveProperty('workflowIdReusePolicy');
  });

  it('rejects unsupported or invalid workflowIdReusePolicy values with 400', async () => {
    const { backend, workflowService } = await start();
    for (const bad of ['TERMINATE_IF_RUNNING', 'UNKNOWN', null]) {
      const entityRes = await request(backend)
        .post(
          '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
        )
        .send({ workflowId: 'id-bad', workflowIdReusePolicy: bad });
      expect(entityRes.status).toBe(400);

      const directRes = await request(backend)
        .post('/api/temporal/workflows')
        .send({
          workflowType: 'anyWorkflow',
          taskQueue: 'jobs',
          workflowId: 'id-bad',
          workflowIdReusePolicy: bad,
        });
      expect(directRes.status).toBe(400);
    }
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
  });

  it('answers 409 when startWorkflowExecution rejects a duplicate workflow ID', async () => {
    const { server, workflowService } = await start();
    workflowService.startWorkflowExecution.mockRejectedValueOnce(
      grpcError(6, 'Workflow execution already finished'),
    );
    const res = await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({
        workflowId: 'dup-id',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.name).toBe('ConflictError');
  });

  it('does not start from the Temporal page with a conditional decision', async () => {
    const { server, workflowService, auditor, auditEvent } = await start({
      conditional: ['temporal.workflow.start'],
    });
    const res = await request(server)
      .post('/api/temporal/workflows')
      .send({ workflowType: 'anyWorkflow', taskQueue: 'jobs' });
    expect(res.status).toBe(403);
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'workflow-start',
        meta: expect.objectContaining({
          workflowType: 'anyWorkflow',
          taskQueue: 'jobs',
        }),
      }),
    );
    expect(auditEvent.fail).toHaveBeenCalledWith({
      error: expect.objectContaining({ name: 'NotAllowedError' }),
    });
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

  it('signals a workflow without an entity only on an unconditional ALLOW', async () => {
    const allowed = await start({ entityAttribute: null });
    const res = await request(allowed.server)
      .post(`${wf}/signal`)
      .send({ name: 'addNote', args: ['hi'] });
    expect(res.status).toBe(202);
    expect(allowed.workflowService.signalWorkflowExecution).toHaveBeenCalled();
    const conditional = await start({
      entityAttribute: null,
      conditional: ['temporal.workflow.signal'],
    });
    const refused = await request(conditional.server)
      .post(`${wf}/signal`)
      .send({ name: 'addNote', args: ['hi'] });
    expect(refused.status).toBe(403);
    expect(
      conditional.workflowService.signalWorkflowExecution,
    ).not.toHaveBeenCalled();
  });

  it('treats a malformed entity search attribute as no entity when signaling', async () => {
    const allowed = await start({ entityAttribute: 'not a ref' });
    const res = await request(allowed.server)
      .post(`${wf}/signal`)
      .send({ name: 'addNote', args: ['hi'] });
    expect(res.status).toBe(202);
    expect(allowed.workflowService.signalWorkflowExecution).toHaveBeenCalled();
    const conditional = await start({
      entityAttribute: 'not a ref',
      conditional: ['temporal.workflow.signal'],
    });
    const refused = await request(conditional.server)
      .post(`${wf}/signal`)
      .send({ name: 'addNote', args: ['hi'] });
    expect(refused.status).toBe(403);
    expect(
      conditional.workflowService.signalWorkflowExecution,
    ).not.toHaveBeenCalled();
  });

  it.each(controlRoutes)(
    'answers 403 for %s when the permission is denied, and records an audit failure',
    async (operation, path, payload) => {
      const permission =
        operation === 'start'
          ? 'temporal.workflow.start'
          : `temporal.workflow.${operation}`;
      const { server, workflowService, auditor, auditEvent } = await start({
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
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: `workflow-${operation}`,
          severityLevel: operation === 'terminate' ? 'high' : 'medium',
        }),
      );
      expect(auditEvent.fail).toHaveBeenCalledWith({
        error: expect.objectContaining({ name: 'NotAllowedError' }),
      });
      expect(auditEvent.success).not.toHaveBeenCalled();
    },
  );

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

    it('runs a registered action with opened run ref and chain firstRunId', async () => {
      const { server, workflowService, auditor } = await start({ action });
      workflowService.describeWorkflowExecution.mockResolvedValueOnce({
        workflowExecutionInfo: {
          ...executionInfo({
            workflowId: 'wf-1',
            runId: 'wf-1-run',
            firstRunId: 'wf-1-run-0',
            status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
          }),
          searchAttributes: {
            indexedFields: {
              BackstageEntityRef: json('component:default/orders'),
            },
          },
        },
        pendingActivities: [],
      } as any);
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
      expect(handle.mock.calls[0][2]).toMatchObject({
        firstRunId: 'wf-1-run-0',
      });
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-action',
          meta: expect.objectContaining({ actionId: 'escalate' }),
        }),
      );
    });

    it('answers 403 when the action permission is denied', async () => {
      const { server, auditor, auditEvent } = await start({
        action,
        deny: ['temporal.workflow.update'],
      });
      const res = await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({});
      expect(res.status).toBe(403);
      expect(handle).not.toHaveBeenCalled();
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-action',
          meta: expect.objectContaining({ actionId: 'escalate' }),
        }),
      );
      expect(auditEvent.fail).toHaveBeenCalledWith({
        error: expect.objectContaining({ name: 'NotAllowedError' }),
      });
    });

    it.each([
      ['a Backstage error', () => new BackstageConflictError('busy'), 409],
      [
        'WorkflowNotFoundError',
        () => new WorkflowNotFoundError('workflow not found', 'wf-1', 'r'),
        404,
      ],
      [
        'WorkflowUpdateFailedError',
        () =>
          new WorkflowUpdateFailedError(
            'Workflow Update failed',
            ApplicationFailure.create({ message: 'rejected by validator' }),
          ),
        400,
      ],
      [
        'WorkflowUpdateRPCTimeoutOrCancelledError',
        () =>
          new WorkflowUpdateRPCTimeoutOrCancelledError('timed out', {
            cause: deadlineExceeded(),
          }),
        503,
      ],
      ['a gRPC NOT_FOUND', () => grpcError(5, 'not found'), 404],
      [
        'a gRPC FAILED_PRECONDITION in a ServiceError',
        () =>
          new ServiceError('Workflow Update failed', {
            cause: grpcError(9, 'workflow execution already completed'),
          }),
        409,
      ],
      ['a gRPC UNAVAILABLE', () => grpcError(14, 'unavailable'), 503],
      ['any other error', () => new Error('boom'), 500],
    ])('maps %s of the action', async (_name, make, status) => {
      const { server, auditEvent } = await start({
        action: {
          ...action,
          handle: async () => {
            throw make();
          },
        },
      });
      const res = await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({});
      expect(res.status).toBe(status);
      expect(auditEvent.fail).toHaveBeenCalled();
    });

    it('runs the action under one deadline of 60 seconds', async () => {
      const { server, connection } = await start({ action });
      await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({})
        .expect(200);
      expect(connection.deadlines).toContain(60_000);
    });

    it('answers 503 when the client of the action cannot connect', async () => {
      const { server } = await start({
        action,
        clientError: new Error('Failed to connect before the deadline'),
      });
      const res = await request(server)
        .post(`${wf}/actions/escalate${withEntity}`)
        .send({});
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe('Temporal is not reachable');
      expect(JSON.stringify(res.body)).not.toContain('before the deadline');
      expect(handle).not.toHaveBeenCalled();
    });

    it('answers 409 when the filter does not match and 404 for unknown actions', async () => {
      const { server } = await start({ action, status: 'COMPLETED' });
      expect(
        (
          await request(server)
            .post(`${wf}/actions/escalate${withEntity}`)
            .send({})
        ).status,
      ).toBe(409);
      expect(
        (
          await request(server)
            .post(`${wf}/actions/unknown${withEntity}`)
            .send({})
        ).status,
      ).toBe(404);
      expect(handle).not.toHaveBeenCalled();
    });

    it('records an unknown action as a failed audit event', async () => {
      const { server, backend, auditor, auditEvent, workflowService } =
        await start({ action });
      const res = await request(server)
        .post(`${wf}/actions/unknown${withEntity}`)
        .send({});
      expect(res.status).toBe(404);
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-action',
          meta: expect.objectContaining({
            namespace: 'default',
            workflowId: 'wf-1',
            runId: 'wf-1-run',
            actionId: 'unknown',
            entityRef: 'component:default/orders',
          }),
        }),
      );
      expect(auditEvent.fail).toHaveBeenCalledWith({
        error: expect.objectContaining({ name: 'NotFoundError' }),
      });
      expect(auditEvent.success).not.toHaveBeenCalled();
      // Refused before the workflow is read.
      expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();

      // An ID that does not match the pattern is not recorded as sent.
      auditor.createEvent.mockClear();
      auditEvent.fail.mockClear();
      await request(backend)
        .post(`${wf}/actions/1-not-an-id${withEntity}`)
        .send({})
        .expect(404);
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-action',
          meta: expect.objectContaining({ actionId: '<invalid>' }),
        }),
      );
      expect(auditEvent.fail).toHaveBeenCalledWith({
        error: expect.objectContaining({ name: 'NotFoundError' }),
      });
      expect(handle).not.toHaveBeenCalled();
    });
  });
});

describe('schedule controls', () => {
  const schedules = [
    {
      scheduleId: 'nightly',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    },
    {
      scheduleId: 'weekly',
      workflowType: 'reportWorkflow',
      taskQueue: 'reports',
    },
  ];
  const path = (id: string, op: string, entity = true) =>
    `/api/temporal/namespaces/default/schedules/${id}/${op}${
      entity ? '?entityRef=component:default/orders' : ''
    }`;

  it('pauses, unpauses and triggers a schedule of the entity, with an audit record', async () => {
    const { server, patchesOf, auditor, auditEvent } = await start({
      schedules,
    });
    const paused = await request(server)
      .post(path('nightly', 'pause'))
      .send({ note: 'maintenance' });
    expect(paused.status).toBe(202);
    expect(patchesOf('nightly')).toEqual([{ pause: 'maintenance' }]);
    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'schedule-pause',
        meta: expect.objectContaining({
          scheduleId: 'nightly',
          entityRef: 'component:default/orders',
        }),
      }),
    );
    expect(auditEvent.success).toHaveBeenCalled();
    await request(server).post(path('nightly', 'unpause')).send({}).expect(202);
    expect(patchesOf('nightly')[1].unpause).toMatch(
      /^Resumed from Backstage by user:default\/mock/,
    );
    await request(server).post(path('nightly', 'trigger')).send({}).expect(202);
    // With the schedule's overlap policy.
    expect(patchesOf('nightly')[2]).toEqual({
      triggerImmediately: { overlapPolicy: 2 }, // BUFFER_ONE, the schedule's own
    });
  });

  it("refuses a schedule that starts another entity's workflows", async () => {
    const { server, patchesOf } = await start({ schedules });
    await request(server).post(path('weekly', 'pause')).send({}).expect(404);
    expect(patchesOf('weekly')).toEqual([]);
  });

  it('refuses the schedules on the task queue of an entity that names no workflow type', async () => {
    // The billing entity only has a task queue: its schedule list is empty,
    // so it owns no schedule, even one on its queue.
    const { server, patchesOf } = await start({
      schedules: [
        {
          scheduleId: 'billing-run',
          workflowType: 'billingWorkflow',
          taskQueue: 'billing',
        },
      ],
    });
    const res = await request(server)
      .post(
        '/api/temporal/namespaces/default/schedules/billing-run/pause?entityRef=component:default/billing',
      )
      .send({});
    expect(res.status).toBe(404);
    expect(patchesOf('billing-run')).toEqual([]);
  });

  it("refuses a schedule of the entity's workflow type on another task queue", async () => {
    const { server, patchesOf } = await start({
      schedules: [
        {
          scheduleId: 'elsewhere',
          workflowType: 'orderWorkflow',
          taskQueue: 'billing',
        },
      ],
    });
    await request(server).post(path('elsewhere', 'pause')).send({}).expect(404);
    expect(patchesOf('elsewhere')).toEqual([]);
  });

  it('needs temporal.workflow.start', async () => {
    const { server, workflowService, auditor, auditEvent } = await start({
      schedules,
      deny: ['temporal.workflow.start'],
    });
    await request(server).post(path('nightly', 'trigger')).send({}).expect(403);
    // Refused before the schedule is read.
    expect(workflowService.describeSchedule).not.toHaveBeenCalled();
    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'schedule-trigger',
        meta: expect.objectContaining({
          scheduleId: 'nightly',
          operation: 'trigger',
          entityRef: 'component:default/orders',
        }),
      }),
    );
    expect(auditEvent.fail).toHaveBeenCalledWith({
      error: expect.objectContaining({ name: 'NotAllowedError' }),
    });
    // Without an entity, the permission must be allowed without conditions.
    const conditional = await start({
      schedules,
      conditional: ['temporal.workflow.start'],
    });
    await request(conditional.server)
      .post(path('nightly', 'trigger', false))
      .send({})
      .expect(403);
    expect(conditional.auditEvent.fail).toHaveBeenCalledWith({
      error: expect.objectContaining({ name: 'NotAllowedError' }),
    });
  });

  it('needs temporal.workflow.list without conditions when there is no entity', async () => {
    const { server, workflowService, patchesOf, auditEvent } = await start({
      schedules,
      conditional: ['temporal.workflow.list'],
    });
    for (const op of ['pause', 'unpause', 'trigger']) {
      await request(server)
        .post(path('nightly', op, false))
        .send({})
        .expect(403);
    }
    // An unknown schedule is refused the same way, so IDs cannot be probed.
    await request(server)
      .post(path('missing', 'pause', false))
      .send({})
      .expect(403);
    expect(workflowService.describeSchedule).not.toHaveBeenCalled();
    expect(patchesOf('nightly')).toEqual([]);
    expect(auditEvent.fail).toHaveBeenCalledTimes(4);
    expect(auditEvent.fail).toHaveBeenCalledWith({
      error: expect.objectContaining({ name: 'NotAllowedError' }),
    });
    // With the entity, the list decision is not used.
    await request(server).post(path('nightly', 'pause')).send({}).expect(202);
    expect(patchesOf('nightly').map(p => Object.keys(p)[0])).toEqual(['pause']);
  });

  it('answers 404 for an unknown schedule or operation, 400 for a bad note', async () => {
    const { server, backend } = await start({ schedules });
    await request(server).post(path('missing', 'pause')).send({}).expect(404);
    // Not an operation of the spec.
    await request(backend)
      .post('/api/temporal/namespaces/default/schedules/nightly/delete')
      .expect(404);
    await request(server)
      .post(path('nightly', 'pause'))
      .send({ note: 42 })
      .expect(400);
    await request(server)
      .post(path('nightly', 'trigger'))
      .send({ note: 'kept nowhere' })
      .expect(400);
  });

  it('maps the Temporal errors of the schedule client', async () => {
    const unavailable = await start({
      schedules,
      scheduleErrors: { patchSchedule: grpcError(14) },
    });
    const res = await request(unavailable.server)
      .post(path('nightly', 'pause'))
      .send({});
    expect(res.status).toBe(503);
    expect(unavailable.auditEvent.fail).toHaveBeenCalled();
    const refused = await start({
      schedules,
      scheduleErrors: { describeSchedule: grpcError(7) },
    });
    await request(refused.server)
      .post(path('nightly', 'trigger'))
      .send({})
      .expect(503);
    expect(refused.patchesOf('nightly')).toEqual([]);
    const conflict = await start({
      schedules,
      scheduleErrors: { patchSchedule: grpcError(9) },
    });
    await request(conflict.server)
      .post(path('nightly', 'pause'))
      .send({})
      .expect(409);
  });

  it('operates a schedule whose payloads cannot be decoded', async () => {
    // Its memo and arguments are encoded by a payload codec; the operation
    // needs only its workflow type and task queue.
    const { server, patchesOf } = await start({
      schedules: [
        {
          scheduleId: 'secret',
          workflowType: 'orderWorkflow',
          taskQueue: 'orders',
          undecodable: true,
        },
      ],
    });
    for (const op of ['pause', 'unpause', 'trigger']) {
      await request(server).post(path('secret', op)).send({}).expect(202);
    }
    expect(patchesOf('secret').map(p => Object.keys(p)[0])).toEqual([
      'pause',
      'unpause',
      'triggerImmediately',
    ]);
  });

  it('refuses a schedule of another namespace than the entity', async () => {
    const { server, workflowService } = await start({ schedules });
    await request(server)
      .post(
        '/api/temporal/namespaces/other/schedules/nightly/pause?entityRef=component:default/orders',
      )
      .send({})
      .expect(404);
    expect(workflowService.describeSchedule).not.toHaveBeenCalled();
    await request(server)
      .post('/api/temporal/namespaces/secret/schedules/nightly/pause')
      .expect(400);
  });

  it('checks permissions before rejecting an unconfigured namespace on schedule operations', async () => {
    const forbiddenPath =
      '/api/temporal/namespaces/forbidden-ns/schedules/nightly/pause';
    const denied = await start({
      schedules,
      deny: ['temporal.workflow.start'],
    });
    await request(denied.server)
      .post(`${forbiddenPath}?entityRef=component:default/orders`)
      .send({})
      .expect(403);
    await request(denied.server).post(forbiddenPath).send({}).expect(403);

    const allowed = await start({ schedules });
    const withEntityRes = await request(allowed.server)
      .post(`${forbiddenPath}?entityRef=component:default/orders`)
      .send({});
    expect(withEntityRes.status).toBe(400);
    expect(withEntityRes.body.error.message).toContain(
      'Temporal namespace is not allowed',
    );
    const noEntityRes = await request(allowed.server)
      .post(forbiddenPath)
      .send({});
    expect(noEntityRes.status).toBe(400);
    expect(noEntityRes.body.error.message).toContain(
      'Temporal namespace is not allowed',
    );
  });
});

// The request body of these routes is optional. Sent without one (no body,
// no content type), as the Scaffolder client does, they use the defaults.
// The OpenAPI validator of the other tests reads a missing optional body as
// invalid, so these go to the test backend directly.
describe('operations without a request body', () => {
  const schedules = [
    {
      scheduleId: 'nightly',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    },
  ];
  it.each([
    {
      route: 'cancel',
      path: `${wf}/cancel${withEntity}`,
      status: 202,
      check: ({ workflowService }: Awaited<ReturnType<typeof start>>) =>
        expect(
          workflowService.requestCancelWorkflowExecution.mock.calls[0][0],
        ).toMatchObject({
          workflowExecution: { workflowId: 'wf-1' },
          firstExecutionRunId: 'wf-1-run',
          identity: 'backstage:user:default/mock',
        }),
    },
    {
      route: 'terminate',
      path: `${wf}/terminate${withEntity}`,
      status: 200,
      check: ({ workflowService }: Awaited<ReturnType<typeof start>>) =>
        expect(
          workflowService.terminateWorkflowExecution.mock.calls[0][0],
        ).toMatchObject({ reason: 'Terminated from Backstage' }),
    },
    {
      route: 'rerun',
      path: `${wf}/rerun${withEntity}`,
      workflowStatus: 'COMPLETED',
      status: 201,
      check: ({ workflowService }: Awaited<ReturnType<typeof start>>) =>
        expect(
          workflowService.startWorkflowExecution.mock.calls[0][0].workflowId,
        ).toMatch(/^wf-1-rerun-[a-z0-9]+$/),
    },
    {
      route: 'schedule pause',
      path: '/api/temporal/namespaces/default/schedules/nightly/pause?entityRef=component:default/orders',
      status: 202,
      check: ({ patchesOf }: Awaited<ReturnType<typeof start>>) =>
        expect(patchesOf('nightly')).toEqual([
          { pause: 'Paused from Backstage by user:default/mock' },
        ]),
    },
  ])('$route uses its defaults', async ({ path, status, check, ...rest }) => {
    const started = await start({
      schedules,
      status: 'workflowStatus' in rest ? rest.workflowStatus : undefined,
    });
    const res = await request(started.backend).post(path);
    expect(res.status).toBe(status);
    check(started);
  });
});

describe('with temporal.control.enabled: false', () => {
  const disabled = { enabled: false };
  const schedules = [
    { scheduleId: 'nightly', workflowType: 'orderWorkflow', taskQueue: 'o' },
  ];
  const routesThatChange: [string, string, object][] = [
    ...controlRoutes.map(([name, path, body]): [string, string, object] => [
      name,
      path.startsWith(wf) ? `${path}${withEntity}` : path,
      body,
    ]),
    [
      'start from the Temporal page',
      '/api/temporal/workflows',
      { workflowType: 'orderWorkflow', taskQueue: 'orders' },
    ],
    ['custom action', `${wf}/actions/escalate${withEntity}`, {}],
    ...['pause', 'unpause', 'trigger'].map((op): [string, string, object] => [
      `schedule ${op}`,
      `/api/temporal/namespaces/default/schedules/nightly/${op}?entityRef=component:default/orders`,
      {},
    ]),
  ];

  it.each(routesThatChange)(
    'serves no %s route (404)',
    async (_name, path, body) => {
      const { backend, workflowService, permissions } = await start({
        control: disabled,
        schedules,
      });
      // Not served: answered without a body, outside the spec.
      const res = await request(backend).post(path).send(body);
      expect(res.status).toBe(404);
      expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
      expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
      expect(permissions.authorize).not.toHaveBeenCalled();
      expect(workflowService.describeSchedule).not.toHaveBeenCalled();
      expect(workflowService.patchSchedule).not.toHaveBeenCalled();
    },
  );

  it('still serves the read routes and queries', async () => {
    const { server, workflowService } = await start({ control: disabled });
    await request(server).get(`${wf}${withEntity}`).expect(200);
    const res = await request(server)
      .post(`${wf}/query${withEntity}`)
      .send({ name: 'state' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { notes: ['hello'] } });
    expect(workflowService.queryWorkflow).toHaveBeenCalled();
  });

  it('starts with modules that add actions, and ignores them with a warning', async () => {
    const handle = jest.fn(async () => ({}));
    const logger = mockServices.logger.mock();
    logger.child.mockReturnValue(logger);
    const { backend } = await start({
      control: disabled,
      logger,
      action: {
        id: 'escalate',
        permission: temporalWorkflowUpdatePermission,
        handle,
      },
    });
    expect(logger.child).toHaveBeenCalledWith({ actionId: 'escalate' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Ignoring a control action: temporal\.control\.enabled is false/,
      ),
    );
    await request(backend)
      .post(`${wf}/actions/escalate${withEntity}`)
      .send({})
      .expect(404);
    expect(handle).not.toHaveBeenCalled();
  });

  it('serves the routes when enabled is true or not set', async () => {
    for (const control of [{ enabled: true }, {}]) {
      const { server, workflowService } = await start({ control });
      await request(server)
        .post(`${wf}/signal${withEntity}`)
        .send({ name: 'addNote' })
        .expect(202);
      expect(workflowService.signalWorkflowExecution).toHaveBeenCalled();
    }
  });
});

describe('control action ids', () => {
  const invalid = {
    id: '1bad',
    permission: temporalWorkflowUpdatePermission,
    handle: jest.fn(async () => ({})),
  };

  it('rejects an invalid id when control is enabled', async () => {
    await expect(
      start({ action: invalid, control: { enabled: true } }),
    ).rejects.toThrow(/Invalid control action id: 1bad/);
  });

  it('rejects an invalid id when control is disabled', async () => {
    await expect(
      start({ action: invalid, control: { enabled: false } }),
    ).rejects.toThrow(/Invalid control action id: 1bad/);
  });
});

describe('input length limits', () => {
  const schedules = [
    {
      scheduleId: 'nightly',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    },
  ];

  it('rejects terminate reason, workflowId, and schedule note longer than 1000 chars', async () => {
    const { backend, workflowService, patchesOf } = await start({ schedules });
    const tooLong = 'x'.repeat(1001);

    await request(backend)
      .post(`${wf}/terminate${withEntity}`)
      .send({ reason: tooLong })
      .expect(400);
    await request(backend)
      .post(`${wf}/rerun${withEntity}`)
      .send({ workflowId: tooLong })
      .expect(400);
    await request(backend)
      .post('/api/temporal/workflows')
      .send({
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
        workflowId: tooLong,
      })
      .expect(400);
    await request(backend)
      .post(
        `/api/temporal/namespaces/default/workflows/${tooLong}/runs/r1/cancel`,
      )
      .send({})
      .expect(400);
    await request(backend)
      .post(
        '/api/temporal/namespaces/default/schedules/nightly/pause?entityRef=component:default/orders',
      )
      .send({ note: tooLong })
      .expect(400);

    expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
    expect(workflowService.startWorkflowExecution).not.toHaveBeenCalled();
    expect(
      workflowService.requestCancelWorkflowExecution,
    ).not.toHaveBeenCalled();
    expect(patchesOf('nightly')).toEqual([]);
  });
});

describe('deadlines of the operations', () => {
  const schedules = [
    {
      scheduleId: 'nightly',
      workflowType: 'orderWorkflow',
      taskQueue: 'orders',
    },
  ];
  const schedulePath = (op: string) =>
    `/api/temporal/namespaces/default/schedules/nightly/${op}${withEntity}`;

  it('operates under a deadline of 10 seconds', async () => {
    const { server, connection } = await start({ schedules });
    await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' })
      .expect(202);
    await request(server)
      .post(`${wf}/cancel${withEntity}`)
      .send({})
      .expect(202);
    await request(server)
      .post(`${wf}/terminate${withEntity}`)
      .send({ reason: 'stuck' })
      .expect(200);
    await request(server)
      .post(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows',
      )
      .send({ workflowId: 'my-order' })
      .expect(201);
    await request(server).post(schedulePath('pause')).send({}).expect(202);
    for (const method of [
      'signalWorkflowExecution',
      'requestCancelWorkflowExecution',
      'terminateWorkflowExecution',
      'startWorkflowExecution',
      'patchSchedule',
    ]) {
      expect([method, connection.timeoutsOf(method)]).toEqual([
        method,
        [10_000],
      ]);
    }
    // The schedule's describe before the pause is a read.
    expect(connection.timeoutsOf('describeSchedule')).toEqual([10_000]);
    expect(connection.calls.filter(c => c.timeoutMs === undefined)).toEqual([]);
  });

  it('reruns with a read of the history and a start, each under 10 seconds', async () => {
    const { server, connection } = await start({ status: 'FAILED' });
    await request(server).post(`${wf}/rerun${withEntity}`).send({}).expect(201);
    expect(connection.timeoutsOf('startWorkflowExecution')).toEqual([10_000]);
    expect(
      new Set(connection.timeoutsOf('getWorkflowExecutionHistory')),
    ).toEqual(new Set([10_000]));
  });

  it.each([
    ['a signal', 'signal', 'signalWorkflowExecution', { name: 'addNote' }],
    ['a cancel', 'cancel', 'requestCancelWorkflowExecution', {}],
    ['an update', 'update', 'updateWorkflowExecution', { name: 'setPriority' }],
  ])('answers 503 when %s times out', async (_name, route, method, body) => {
    const { server, workflowService, auditEvent } = await start();
    (workflowService as any)[method].mockRejectedValue(deadlineExceeded());
    const res = await request(server)
      .post(`${wf}/${route}${withEntity}`)
      .send(body);
    expect(res.status).toBe(503);
    expect(auditEvent.fail).toHaveBeenCalled();
  });

  it('answers 503 when a schedule operation times out', async () => {
    const { server } = await start({
      schedules,
      scheduleErrors: { patchSchedule: deadlineExceeded() },
    });
    const res = await request(server).post(schedulePath('trigger')).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('Temporal did not answer in time');
  });

  it('gives the update and each poll its own deadline, so a slow update finishes', async () => {
    const { server, workflowService, connection } = await start();
    // The server answers each call after its wait, before the update is done.
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({} as any);
    workflowService.pollWorkflowExecutionUpdate
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({
        outcome: { success: { payloads: [json('done')] } },
      } as any);
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'done' });
    expect(connection.timeoutsOf('updateWorkflowExecution')).toEqual([30_000]);
    expect(connection.timeoutsOf('pollWorkflowExecutionUpdate')).toEqual([
      30_000, 30_000, 30_000,
    ]);
    // Each call has a deadline of its own, not one for all of them.
    expect(connection.deadlines.filter(ms => ms === 30_000)).toHaveLength(4);
  });

  it('answers 503 when the connection to Temporal cannot be opened', async () => {
    const { server, workflowService } = await start({
      connectionError: new Error('Failed to connect before the deadline'),
    });
    const res = await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe('Temporal is not reachable');
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });
});

describe('logs', () => {
  it('warns when a permission condition cannot be applied, and answers as it did', async () => {
    const recorder = recordingLogger();
    const { server } = await start({
      entityAttribute: null,
      conditional: ['temporal.workflow.list'],
      recorder,
    });
    const missing = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('Workflow wf-1 was not found');
    expect(recorder.records).toContainEqual({
      level: 'warn',
      message: 'A permission condition cannot be applied, so it allows nothing',
      meta: { permission: 'temporal.workflow.list', errorName: 'Error' },
    });
    // The workflow is not named in a log that tells a caller's 404 apart.
    expect(
      recorder.records.filter(r => r.level === 'warn' || r.level === 'info'),
    ).toHaveLength(1);

    const list = await request(server).get(
      '/api/temporal/workflows?namespace=default',
    );
    expect(list.status).toBe(403);
    expect(list.body.error.message).toBe(
      'The workflow list conditions cannot be applied',
    );
    expect(list.body.error.message).not.toContain('IS_ENTITY_OWNER');
    expect(list.body.error.message).not.toContain('Error');
    expect(recorder.records).toContainEqual({
      level: 'warn',
      message:
        'A permission condition cannot be applied, so the list shows nothing',
      meta: { permission: 'temporal.workflow.list', errorName: 'Error' },
      error: expect.any(Error),
    });
  });

  it('logs the gRPC status when Temporal refuses the credentials of the backend, and keeps it out of the response', async () => {
    const recorder = recordingLogger();
    const { server, workflowService } = await start({ recorder });
    workflowService.describeWorkflowExecution.mockRejectedValue(
      Object.assign(new Error('7 PERMISSION_DENIED: bearer rejected'), {
        code: 7,
        metadata: { authorization: 'SECRET-TOKEN' },
      }),
    );
    const res = await request(server).get(`${wf}${withEntity}`);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(
      'Temporal refused the credentials of the backend',
    );
    expect(JSON.stringify(res.body)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(res.body)).not.toContain('bearer rejected');
    expect(recorder.records).toContainEqual({
      level: 'warn',
      message: 'Call to Temporal failed',
      meta: {
        temporalCall: 'describeWorkflowExecution',
        namespace: 'default',
        durationMs: expect.any(Number),
        timeoutMs: 10_000,
        errorName: 'Error',
        grpcCode: 7,
        grpcStatus: 'PERMISSION_DENIED',
        errorMessage: '7 PERMISSION_DENIED: bearer rejected',
      },
    });
    expect(JSON.stringify(recorder.records)).not.toContain('SECRET-TOKEN');
  });

  it.each([
    [3, 400, 'Temporal rejected the request as invalid'],
    [14, 503, 'Temporal is not reachable'],
    [4, 503, 'Temporal did not answer in time'],
    [8, 503, 'Temporal is rate limiting the backend'],
    [13, 500, 'Internal server error'],
  ])(
    'answers a failed read with a fixed message and logs what Temporal said (gRPC %i)',
    async (code, status, message) => {
      const raw = `${code} STATUS: invalid query (Owner = "team-x") at temporal.internal:7233`;
      const recorder = recordingLogger();
      const { server, workflowService } = await start({ recorder });
      workflowService.describeWorkflowExecution.mockRejectedValue(
        Object.assign(new Error(raw), { code }),
      );
      const res = await request(server).get(`${wf}${withEntity}`);
      expect(res.status).toBe(status);
      expect(res.body.error.message).toBe(message);
      expect(JSON.stringify(res.body)).not.toContain('temporal.internal');
      expect(JSON.stringify(res.body)).not.toContain('Owner');
      expect(recorder.records).toContainEqual(
        expect.objectContaining({
          message: 'Call to Temporal failed',
          meta: expect.objectContaining({
            temporalCall: 'describeWorkflowExecution',
            namespace: 'default',
            errorMessage: raw,
          }),
        }),
      );
    },
  );

  it('answers an error that no route expected with a fixed message and logs it', async () => {
    const recorder = recordingLogger();
    const { server, workflowService } = await start({ recorder });
    workflowService.describeWorkflowExecution.mockRejectedValue(
      new Error('cannot read property of temporal.internal:7233'),
    );
    const res = await request(server).get(`${wf}${withEntity}`);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('temporal.internal');
    expect(recorder.records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'Unexpected error in a route',
        meta: expect.objectContaining({ method: 'GET' }),
        error: expect.objectContaining({
          message: 'cannot read property of temporal.internal:7233',
        }),
      }),
    );
  });

  it('keeps the status of an error that carries one, with a fixed message for a server error', async () => {
    const recorder = recordingLogger();
    const { backend, workflowService } = await start({ recorder });
    // `ResponseError` of the catalog and permission clients sets only
    // `statusCode`.
    workflowService.describeWorkflowExecution.mockRejectedValue(
      Object.assign(new Error('catalog at internal-host:7007 is down'), {
        statusCode: 503,
      }),
    );
    const res = await request(backend).get(`${wf}${withEntity}`);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('internal-host');
    expect(recorder.records).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'Unexpected error in a route',
      }),
    );

    workflowService.describeWorkflowExecution.mockRejectedValue(
      Object.assign(new Error('refused by the permission service'), {
        statusCode: 403,
      }),
    );
    const refused = await request(backend).get(`${wf}${withEntity}`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe(
      'refused by the permission service',
    );
  });

  it('answers a body that is not JSON with 400', async () => {
    const { backend } = await start();
    const res = await request(backend)
      .post(`${wf}/signal${withEntity}`)
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
  });

  it('leaves the errors of the other routes of the plugin as they are', async () => {
    const { backend } = await start({
      extraFeatures: [
        createBackendModule({
          pluginId: 'temporal',
          moduleId: 'test-other-route',
          register(reg) {
            reg.registerInit({
              deps: { httpRouter: coreServices.httpRouter },
              async init({ httpRouter }) {
                httpRouter.addAuthPolicy({
                  path: '/other',
                  allow: 'unauthenticated',
                });
                httpRouter.use(
                  Router().get('/other', () => {
                    throw new Error('The Temporal plugin answered 503');
                  }),
                );
              },
            });
          },
        }),
      ],
    });
    const res = await request(backend).get('/api/temporal/other');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('The Temporal plugin answered 503');
  });

  it('warns with the update ID when an update does not finish within the polls', async () => {
    const recorder = recordingLogger();
    const { server, workflowService } = await start({ recorder });
    workflowService.updateWorkflowExecution.mockResolvedValue({} as any);
    workflowService.pollWorkflowExecutionUpdate.mockResolvedValue({} as any);
    const res = await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', args: ['high'] });
    expect(res.status).toBe(503);
    const { updateId } =
      workflowService.updateWorkflowExecution.mock.calls[0][0].request.meta;
    expect(recorder.records).toContainEqual({
      level: 'warn',
      message: 'The update did not finish within the polls',
      meta: {
        namespace: 'default',
        workflowId: 'wf-1',
        firstRunId: 'wf-1-run',
        messageName: 'setPriority',
        updateId,
      },
    });
  });

  it('never logs the arguments or the result of a signal, update or query', async () => {
    const recorder = recordingLogger();
    const { server, workflowService } = await start({ recorder });
    const marker = 'MARKER-5f3a9c';
    workflowService.updateWorkflowExecution.mockResolvedValueOnce({
      outcome: { success: { payloads: [json({ echoed: marker })] } },
    } as any);
    workflowService.queryWorkflow.mockResolvedValueOnce({
      queryResult: { payloads: [json({ echoed: marker })] },
    } as any);
    await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote', args: [marker] })
      .expect(202);
    await request(server)
      .post(`${wf}/update${withEntity}`)
      .send({ name: 'setPriority', args: [marker] })
      .expect(200);
    await request(server)
      .post(`${wf}/query${withEntity}`)
      .send({ name: 'state', args: [marker] })
      .expect(200);
    // A failing call is logged too.
    workflowService.signalWorkflowExecution.mockRejectedValueOnce(
      Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
    );
    await request(server)
      .post(`${wf}/signal${withEntity}`)
      .send({ name: 'addNote', args: [marker] })
      .expect(503);
    const calls = recorder.records.map(r => r.meta.temporalCall);
    expect(calls).toEqual(
      expect.arrayContaining([
        'signalWorkflowExecution',
        'updateWorkflowExecution',
        'queryWorkflow',
      ]),
    );
    expect(recorder.records.some(r => r.level === 'warn')).toBe(true);
    expect(JSON.stringify(recorder.records)).not.toContain(marker);
  });

  describe('permissions on dependsOn TemporalWorkflow entities', () => {
    const checkoutRef = 'component:default/checkout';
    const orderWfRef = 'temporalworkflow:default/order-workflow';

    it.each([
      [
        'terminate',
        'temporal.workflow.terminate',
        `${wf}/terminate?entityRef=${checkoutRef}`,
        { reason: 'stop' },
        'RUNNING',
        'terminateWorkflowExecution',
      ],
      [
        'query',
        'temporal.workflow.query',
        `${wf}/query?entityRef=${checkoutRef}`,
        { name: 'state' },
        'RUNNING',
        'queryWorkflow',
      ],
      [
        'signal',
        'temporal.workflow.signal',
        `${wf}/signal?entityRef=${checkoutRef}`,
        { name: 'addNote', args: ['hi'] },
        'RUNNING',
        'signalWorkflowExecution',
      ],
      [
        'update',
        'temporal.workflow.update',
        `${wf}/update?entityRef=${checkoutRef}`,
        { name: 'setPriority', args: ['high'] },
        'RUNNING',
        'updateWorkflowExecution',
      ],
      [
        'cancel',
        'temporal.workflow.cancel',
        `${wf}/cancel?entityRef=${checkoutRef}`,
        {},
        'RUNNING',
        'requestCancelWorkflowExecution',
      ],
      [
        'rerun',
        'temporal.workflow.rerun',
        `${wf}/rerun?entityRef=${checkoutRef}`,
        {},
        'COMPLETED',
        'startWorkflowExecution',
      ],
    ] as const)(
      'answers 403 for %s without %s on the matched TemporalWorkflow entity',
      async (_name, permission, path, body, status, rpc) => {
        const { server, workflowService } = await start({
          status,
          entityAttribute: null,
          deny: [{ permission, resourceRef: orderWfRef }],
        });
        const res = await request(server).post(path).send(body);
        expect(res.status).toBe(403);
        expect((workflowService as any)[rpc]).not.toHaveBeenCalled();
      },
    );

    it('answers 403 for a custom action without its permission on the matched TemporalWorkflow entity', async () => {
      const handle = jest.fn(async () => ({ ok: true }));
      const { server } = await start({
        entityAttribute: null,
        deny: [
          {
            permission: temporalWorkflowUpdatePermission.name,
            resourceRef: orderWfRef,
          },
        ],
        action: {
          id: 'escalate',
          permission: temporalWorkflowUpdatePermission,
          handle,
        },
      });
      const res = await request(server)
        .post(`${wf}/actions/escalate?entityRef=${checkoutRef}`)
        .send({});
      expect(res.status).toBe(403);
      expect(handle).not.toHaveBeenCalled();
    });

    it('answers 403 when terminate is denied on the opened entity and allows when permitted on both', async () => {
      const deniedOpened = await start({
        entityAttribute: null,
        deny: [
          {
            permission: 'temporal.workflow.terminate',
            resourceRef: checkoutRef,
          },
        ],
      });
      const deniedRes = await request(deniedOpened.server)
        .post(`${wf}/terminate?entityRef=${checkoutRef}`)
        .send({ reason: 'stop' });
      expect(deniedRes.status).toBe(403);
      expect(
        deniedOpened.workflowService.terminateWorkflowExecution,
      ).not.toHaveBeenCalled();

      const allowedBoth = await start({ entityAttribute: null });
      const allowedRes = await request(allowedBoth.server)
        .post(`${wf}/terminate?entityRef=${checkoutRef}`)
        .send({ reason: 'stop' });
      expect(allowedRes.status).toBe(200);
      expect(
        allowedBoth.workflowService.terminateWorkflowExecution,
      ).toHaveBeenCalledTimes(1);
    });

    it('checks terminate on the ancestor matched TemporalWorkflow entity for child workflows', async () => {
      const { server, workflowService } = await start({
        entityAttribute: null,
        deny: [
          {
            permission: 'temporal.workflow.terminate',
            resourceRef: orderWfRef,
          },
        ],
      });
      workflowService.describeWorkflowExecution.mockImplementation(
        async (req: any) => {
          if (req.execution.workflowId === 'child-0') {
            return {
              workflowExecutionInfo: {
                ...executionInfo({
                  workflowId: 'child-0',
                  type: 'childWorkflow',
                  taskQueue: 'child-queue',
                  status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
                }),
                searchAttributes: { indexedFields: {} },
                parentExecution: {
                  workflowId: 'parent-1',
                  runId: 'parent-1-run',
                },
              } as any,
              pendingActivities: [],
            };
          }
          return {
            workflowExecutionInfo: {
              ...executionInfo({
                workflowId: 'parent-1',
                type: 'orderWorkflow',
                taskQueue: 'orders',
                status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
              }),
              searchAttributes: { indexedFields: {} },
            } as any,
            pendingActivities: [],
          };
        },
      );
      const res = await request(server)
        .post(
          `/api/temporal/namespaces/default/workflows/child-0/runs/child-0-run/terminate?entityRef=${checkoutRef}`,
        )
        .send({ reason: 'stop' });
      expect(res.status).toBe(403);
      expect(workflowService.terminateWorkflowExecution).not.toHaveBeenCalled();
    });
  });

  describe('initial audit metadata sanitization', () => {
    it('records a placeholder for overlong path IDs, invalid namespaces, and invalid entityRefs', async () => {
      const { backend, workflowService, auditor, auditEvent } = await start();
      const longWorkflowId = 'w'.repeat(1001);
      const longRunId = 'r'.repeat(1001);

      const badWorkflowRes = await request(backend)
        .post(
          `/api/temporal/namespaces/default/workflows/${longWorkflowId}/runs/${longRunId}/signal${withEntity}`,
        )
        .send({ name: 'addNote' });
      expect(badWorkflowRes.status).toBe(400);
      expect(auditor.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: 'workflow-signal',
          meta: expect.objectContaining({
            namespace: 'default',
            workflowId: '<invalid>',
            runId: '<invalid>',
            entityRef: 'component:default/orders',
            name: 'addNote',
          }),
        }),
      );
      const badWorkflowMeta = JSON.stringify(
        auditor.createEvent.mock.calls.at(-1)?.[0]?.meta,
      );
      expect(badWorkflowMeta).not.toContain(longWorkflowId);
      expect(badWorkflowMeta).not.toContain(longRunId);

      const badNsRes = await request(backend)
        .post(
          '/api/temporal/namespaces/bad%20ns!/workflows/wf-1/runs/wf-1-run/signal',
        )
        .send({ name: 'addNote' });
      expect(badNsRes.status).toBe(400);
      expect(auditor.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: 'workflow-signal',
          meta: expect.objectContaining({
            namespace: '<invalid>',
            workflowId: 'wf-1',
            runId: 'wf-1-run',
            name: 'addNote',
          }),
        }),
      );

      const badEntityRes = await request(backend)
        .post(`${wf}/signal?entityRef=not%20a%20valid%20ref`)
        .send({ name: 'addNote' });
      expect(badEntityRes.status).toBe(400);
      expect(auditor.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: 'workflow-signal',
          meta: expect.objectContaining({
            namespace: 'default',
            workflowId: 'wf-1',
            runId: 'wf-1-run',
            entityRef: '<invalid>',
            name: 'addNote',
          }),
        }),
      );

      const longEntityRef = `component:default/${'e'.repeat(1001)}`;
      await request(backend)
        .post(`${wf}/signal?entityRef=${encodeURIComponent(longEntityRef)}`)
        .send({ name: 'addNote' });
      expect(auditor.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: 'workflow-signal',
          meta: expect.objectContaining({ entityRef: '<invalid>' }),
        }),
      );

      const badScheduleRes = await request(backend)
        .post(
          `/api/temporal/namespaces/bad%20ns!/schedules/${'s'.repeat(
            1001,
          )}/pause?entityRef=bad%20ref`,
        )
        .send({});
      expect(badScheduleRes.status).toBe(400);
      expect(auditor.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          eventId: 'schedule-pause',
          meta: expect.objectContaining({
            namespace: '<invalid>',
            scheduleId: '<invalid>',
            entityRef: '<invalid>',
          }),
        }),
      );

      expect(auditEvent.fail).toHaveBeenCalledTimes(5);
      expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
    });

    it('keeps valid and canonical URL values in initial audit metadata', async () => {
      const { backend, auditor, auditEvent } = await start({
        deny: ['temporal.workflow.signal'],
      });

      const res = await request(backend)
        .post(`${wf}/signal?entityRef=Component:default/orders`)
        .send({ name: 'addNote' });
      expect(res.status).toBe(403);
      expect(auditor.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'workflow-signal',
          meta: expect.objectContaining({
            namespace: 'default',
            workflowId: 'wf-1',
            runId: 'wf-1-run',
            entityRef: 'component:default/orders',
            name: 'addNote',
          }),
        }),
      );
      expect(auditEvent.fail).toHaveBeenCalled();
    });
  });
});
