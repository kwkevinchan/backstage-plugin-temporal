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
import type { Entity } from '@backstage/catalog-model';
import {
  temporalWorkflowEnricherExtensionPoint,
  TemporalWorkflowEnricher,
} from './node/alpha';
import request from 'supertest';
import { stringifyTemporalWorkflowResourceRef } from './common';
import { MAX_RELATED_WORKFLOW_ENTITIES } from './access/DefaultTemporalAccessService';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  badEntity,
  createFakeConnection,
  createFakeWorkflowService,
  deadlineExceeded,
  executionInfo,
  fakeTemporalServiceFactory,
  FakeWorkflowService,
  checkoutEntity,
  customKindEntity,
  entityWithRelatedWorkflows,
  orderWorkflowEntity,
  ordersEntity,
  otherEntity,
  otherNamespaceWorkflowEntity,
  paymentWorkflowEntity,
} from './testUtils';
import { HISTORY_EVENT_FILTER_CLOSE } from './repositories/TemporalReadRepository';
import { withOpenApiValidation } from './__testUtils__/openapi';
import {
  recordingLogger,
  recordingLoggerFactory,
  type RecordingLogger,
} from './__testUtils__/recordingLogger';

const entities = [
  ordersEntity,
  otherEntity,
  badEntity,
  customKindEntity,
  checkoutEntity,
  orderWorkflowEntity,
  paymentWorkflowEntity,
  otherNamespaceWorkflowEntity,
];
const ref = 'component:default/orders';

async function start(options?: {
  permission?: AuthorizeResult.ALLOW | AuthorizeResult.DENY;
  /** Entity references or permission names denied regardless of `permission`. */
  deny?: string[];
  enricher?: TemporalWorkflowEnricher;
  workflowService?: FakeWorkflowService;
  entityRefAttribute?: string;
  entities?: Entity[];
  logger?: ReturnType<typeof mockServices.logger.mock>;
  /** Records what the plugin logs, with the fields of its child loggers. */
  recorder?: RecordingLogger;
  /** An error of opening the connection to Temporal. */
  connectionError?: unknown;
}) {
  const workflowService =
    options?.workflowService ?? createFakeWorkflowService();
  const connection = createFakeConnection(workflowService);
  const decide = (r: any) => ({
    result:
      options?.deny?.includes(r.resourceRef) ||
      options?.deny?.includes(r.permission.name)
        ? AuthorizeResult.DENY
        : options?.permission ?? AuthorizeResult.ALLOW,
  });
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests => requests.map(decide)) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(decide),
    ) as any,
  });
  const features: any[] = [
    temporalPlugin,
    temporalAccessServiceFactory,
    catalogServiceMock.factory({ entities: options?.entities ?? entities }),
    fakeTemporalServiceFactory(workflowService, {
      entityRefAttribute: options?.entityRefAttribute,
      connection,
      connectionError: options?.connectionError,
    }),
    permissions.factory,
  ];
  if (options?.logger) features.push(options.logger.factory);
  if (options?.recorder) {
    features.push(recordingLoggerFactory(options.recorder));
  }
  if (options?.enricher) {
    const enricher = options.enricher;
    features.push(
      createBackendModule({
        pluginId: 'temporal',
        moduleId: 'test-enricher',
        register(reg) {
          reg.registerInit({
            deps: { temporal: temporalWorkflowEnricherExtensionPoint },
            async init({ temporal }) {
              temporal.addWorkflowEnricher(enricher);
            },
          });
        },
      }),
    );
  }
  const { server } = await startTestBackend({ features });
  return {
    backend: server,
    server: await withOpenApiValidation(server),
    workflowService,
    permissions,
    connection,
  };
}

describe('temporal backend plugin', () => {
  describe('deadlines of the reads', () => {
    const detail = `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`;
    const list = '/api/temporal/entities/component/default/orders/workflows';

    it('reads under a deadline: 15 seconds for lists, 10 for one read', async () => {
      const { server, connection } = await start();
      expect((await request(server).get(list)).status).toBe(200);
      expect((await request(server).get(detail)).status).toBe(200);
      expect(
        (await request(server).get(`${detail.replace('?', '/history?')}`))
          .status,
      ).toBe(200);
      expect(connection.timeoutsOf('listWorkflowExecutions')).toEqual([15_000]);
      const reads = [
        ...connection.timeoutsOf('describeWorkflowExecution'),
        ...connection.timeoutsOf('getWorkflowExecutionHistory'),
      ];
      expect(reads.length).toBeGreaterThan(1);
      expect(new Set(reads)).toEqual(new Set([10_000]));
      // No call to Temporal without a deadline.
      expect(connection.calls.filter(c => c.timeoutMs === undefined)).toEqual(
        [],
      );
    });

    it.each([
      ['a list', 'listWorkflowExecutions', list],
      ['a describe', 'describeWorkflowExecution', detail],
    ])('answers 503 when %s times out', async (_name, method, path) => {
      const { server, workflowService } = await start();
      (workflowService as any)[method].mockRejectedValue(deadlineExceeded());
      const res = await request(server).get(path);
      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain(
        'Temporal did not answer in time',
      );
    });

    it('answers 503 when Temporal rate limits the backend', async () => {
      const { server, workflowService } = await start();
      workflowService.listWorkflowExecutions.mockRejectedValue(
        Object.assign(new Error('8 RESOURCE_EXHAUSTED: namespace rate limit'), {
          code: 8,
        }),
      );
      const res = await request(server).get(list);
      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain(
        'Temporal is rate limiting the backend',
      );
    });

    it('answers 503 when the connection to Temporal cannot be opened', async () => {
      const { server, workflowService } = await start({
        connectionError: new Error('Failed to connect before the deadline'),
      });
      const res = await request(server).get(detail);
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe(
        'Temporal is not reachable: Failed to connect before the deadline',
      );
      expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
    });
  });

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
      .get(
        `/api/temporal/namespaces/secret/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
      )
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
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
      )
      .expect(403);
    await request(server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history?entityRef=${ref}`,
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

  it('describes a run that continued as new with the run it continued as', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: executionInfo({
        workflowId: 'wf-1',
        status: 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW',
      }),
      pendingActivities: [],
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
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ContinuedAsNew',
      continuedAsNewRunId: 'wf-1-run-2',
    });
    expect(res.body.failure).toBeUndefined();
    expect(
      workflowService.getWorkflowExecutionHistoryReverse,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: { workflowId: 'wf-1', runId: 'wf-1-run' },
        maximumPageSize: 1,
      }),
    );
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
      .get(
        `/api/temporal/namespaces/default/workflows/wf-x/runs/wf-x-run?entityRef=${ref}`,
      )
      .expect(404);
  });

  describe('child workflows', () => {
    /** A chain of workflows: each one the child of the next; the last is the entity's or not. */
    function chain(length: number, lastOfEntity: boolean, cyclic = false) {
      const workflowService = createFakeWorkflowService();
      workflowService.describeWorkflowExecution.mockImplementation(
        async (req: any) => {
          const id: string = req.execution.workflowId;
          const n = Number(id.replace('c', ''));
          if (n < length) {
            const parent = cyclic && n === length - 1 ? 'c0' : `c${n + 1}`;
            return {
              workflowExecutionInfo: {
                ...executionInfo({
                  workflowId: id,
                  taskQueue: 'billing',
                  type: 'x',
                }),
                parentExecution: { workflowId: parent, runId: `${parent}-run` },
              } as any,
              pendingActivities: [],
            };
          }
          return {
            workflowExecutionInfo: executionInfo({
              workflowId: id,
              taskQueue: lastOfEntity ? 'orders' : 'billing',
            }),
            pendingActivities: [],
          };
        },
      );
      return workflowService;
    }
    const open = async (workflowService: any) => {
      const { server } = await start({ workflowService });
      return request(server).get(
        `/api/temporal/namespaces/default/workflows/c0/runs/c0-run?entityRef=${ref}`,
      );
    };

    it('opens a child workflow with the entity of its parent', async () => {
      const res = await open(chain(1, true));
      expect(res.status).toBe(200);
      expect(res.body.workflowType).toBe('x');
    });

    it('looks up to three parents', async () => {
      const service = chain(3, true);
      expect((await open(service)).status).toBe(200);
      expect((await open(chain(4, true))).status).toBe(404);
    });

    it('hides the child of a workflow of another entity', async () => {
      expect((await open(chain(1, false))).status).toBe(404);
    });

    it('stops on a cycle of parents', async () => {
      const service = chain(2, false, true);
      expect((await open(service)).status).toBe(404);
    });

    it('answers 404 when a parent is gone', async () => {
      const workflowService = chain(1, true);
      const describe =
        workflowService.describeWorkflowExecution.getMockImplementation()!;
      workflowService.describeWorkflowExecution.mockImplementation(
        async (req: any) => {
          if (req.execution.workflowId === 'c1') {
            throw Object.assign(new Error('not found'), { code: 5 });
          }
          return describe(req);
        },
      );
      expect((await open(workflowService)).status).toBe(404);
    });
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
    // Without the list permission, the entity from the search attribute
    // decides.
    const { server, permissions } = await start({
      workflowService,
      entityRefAttribute: 'BackstageEntityRef',
      deny: ['temporal.workflow.list'],
    });
    const res = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-sa/runs/wf-sa-run',
    );
    expect(res.status).toBe(200);
    expect(res.body.entityRef).toBe(ref);
    expect(permissions.authorize).toHaveBeenCalledWith(
      [expect.objectContaining({ resourceRef: ref })],
      expect.anything(),
    );

    const { server: server2 } = await start({
      workflowService,
      deny: ['temporal.workflow.list'],
    });
    // As for a workflow that does not exist.
    await request(server2)
      .get('/api/temporal/namespaces/default/workflows/wf-sa/runs/wf-sa-run')
      .expect(404);
  });

  it('answers 404, as for a workflow without the attribute, when the entity reference search attribute is not a reference', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const describeWith = (attribute?: unknown) => {
      const workflowService = createFakeWorkflowService();
      workflowService.describeWorkflowExecution.mockResolvedValue({
        workflowExecutionInfo: {
          ...executionInfo({
            workflowId: 'wf-sa',
            taskQueue: 'other',
            type: 'x',
          }),
          searchAttributes: {
            indexedFields:
              attribute === undefined
                ? {}
                : {
                    BackstageEntityRef: {
                      metadata: { encoding: b64('json/plain') },
                      data: b64(JSON.stringify(attribute)),
                    },
                  },
          },
        } as any,
        pendingActivities: [],
      });
      return workflowService;
    };
    const statusOf = async (attribute?: unknown) => {
      const { server } = await start({
        workflowService: describeWith(attribute),
        entityRefAttribute: 'BackstageEntityRef',
        deny: ['temporal.workflow.list'],
      });
      return (
        await request(server).get(
          '/api/temporal/namespaces/default/workflows/wf-sa/runs/wf-sa-run',
        )
      ).status;
    };
    expect(await statusOf()).toBe(404);
    expect(await statusOf('not a ref')).toBe(404);
  });

  it('pages through history with the history permission', async () => {
    const { server, workflowService, permissions } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history?entityRef=${ref}&pageSize=10`,
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

  it('rejects a bad history pageSize and pageToken before loading the workflow', async () => {
    const { server, workflowService } = await start();
    const pageSize = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history?entityRef=${ref}&pageSize=501`,
    );
    expect(pageSize.status).toBe(400);
    const pageToken = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history?entityRef=${ref}&pageToken=not-a-token!`,
    );
    expect(pageToken.status).toBe(400);
    expect(workflowService.describeWorkflowExecution).not.toHaveBeenCalled();
  });

  it("returns a failed run's failure from the close event", async () => {
    const { server, permissions, workflowService } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'Failed',
      failure: {
        message: 'outer',
        type: 'Outer',
        cause: { message: 'inner' },
      },
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
    expect(workflowService.getWorkflowExecutionHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        execution: { workflowId: 'wf-1', runId: 'wf-1-run' },
        historyEventFilterType: HISTORY_EVENT_FILTER_CLOSE,
        maximumPageSize: 1,
      }),
    );
    const denied = await start({ permission: AuthorizeResult.DENY });
    await request(denied.server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result?entityRef=${ref}`,
      )
      .expect(403);
  });

  it('returns the close-event result in one history call, even when the oldest-first history has no close event', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const workflowService = createFakeWorkflowService();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: executionInfo({
        workflowId: 'wf-1',
        status: 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
      }),
      pendingActivities: [],
    });
    workflowService.getWorkflowExecutionHistory.mockImplementation(
      async (req: any) => {
        const filter = req?.historyEventFilterType;
        const closeEvent =
          filter === HISTORY_EVENT_FILTER_CLOSE ||
          filter === 2 ||
          filter === 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT';
        if (!closeEvent) {
          return {
            history: {
              events: [
                {
                  eventId: '1',
                  workflowExecutionStartedEventAttributes: {},
                },
              ],
            },
            nextPageToken: new Uint8Array([1]),
          };
        }
        return {
          history: {
            events: [
              {
                eventId: '6001',
                workflowExecutionCompletedEventAttributes: {
                  result: {
                    payloads: [
                      {
                        metadata: { encoding: b64('json/plain') },
                        data: b64(JSON.stringify('deployed')),
                      },
                    ],
                  },
                },
              },
            ],
          },
        };
      },
    );
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'Completed',
      result: { encoding: 'json/plain', value: 'deployed' },
    });
    expect(workflowService.getWorkflowExecutionHistory).toHaveBeenCalledTimes(
      1,
    );
    expect(workflowService.getWorkflowExecutionHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        historyEventFilterType: HISTORY_EVENT_FILTER_CLOSE,
        maximumPageSize: 1,
      }),
    );
  });

  it('returns 200 with only status for a running run, not 404', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: executionInfo({
        workflowId: 'wf-1',
        status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
      }),
      pendingActivities: [],
    });
    workflowService.getWorkflowExecutionHistory.mockImplementation(
      async (req: any) => {
        const filter = req?.historyEventFilterType;
        const closeEvent =
          filter === HISTORY_EVENT_FILTER_CLOSE ||
          filter === 2 ||
          filter === 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT';
        if (closeEvent) {
          return { history: { events: [] } };
        }
        return {
          history: {
            events: [
              { eventId: '1', workflowExecutionStartedEventAttributes: {} },
            ],
          },
        };
      },
    );
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'Running' });
    const denied = await start({
      workflowService,
      deny: ['temporal.workflow.history.list'],
    });
    const hidden = await request(denied.server).get(
      '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result',
    );
    expect(hidden.status).toBe(404);
    expect(hidden.body.error).toBeDefined();
  });

  it('returns the step graph, with payloads when the history may be read', async () => {
    const { server, permissions } = await start();
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'Failed',
      payloadsHidden: false,
      truncated: false,
      nodes: [
        {
          id: 'start',
          kind: 'workflowStarted',
          input: { encoding: 'json/plain', value: 42 },
        },
      ],
      edges: [],
    });
    expect(permissions.authorize).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          permission: expect.objectContaining({
            name: 'temporal.workflow.history.read',
          }),
          resourceRef: ref,
        }),
      ],
      expect.anything(),
    );

    const noHistory = await start({ deny: ['temporal.workflow.history.read'] });
    const hidden = await request(noHistory.server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph?entityRef=${ref}`,
    );
    expect(hidden.status).toBe(200);
    expect(hidden.body.payloadsHidden).toBe(true);
    expect(hidden.body.nodes[0].input).toBeUndefined();

    const denied = await start({ deny: ['temporal.workflow.read'] });
    await request(denied.server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph?entityRef=${ref}`,
      )
      .expect(403);
  });

  it('places a continued run among the runs of its workflow ID', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.getWorkflowExecutionHistory.mockResolvedValue({
      history: {
        events: [
          {
            eventId: '1',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
            workflowExecutionStartedEventAttributes: {
              continuedExecutionRunId: 'run-before',
            },
          },
        ],
      },
      nextPageToken: new Uint8Array(),
    } as any);
    workflowService.countWorkflowExecutions.mockImplementation(
      async (req: any) => ({ count: req.query.includes('StartTime') ? 3 : 5 }),
    );
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph?entityRef=${ref}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.runChain).toEqual({
      previousRunId: 'run-before',
      index: 3,
      total: 5,
    });
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledWith({
      namespace: 'default',
      query: expect.stringMatching(/^WorkflowId = 'wf-1' AND StartTime < '/),
    });

    // A failing count leaves only the links.
    workflowService.countWorkflowExecutions.mockRejectedValue(
      new Error('not supported'),
    );
    const failed = await request(server).get(
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph?entityRef=${ref}`,
    );
    expect(failed.body.runChain).toEqual({ previousRunId: 'run-before' });
  });

  it('counts the runs of workflow IDs with spaces, not of IDs with quotes', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.getWorkflowExecutionHistory.mockResolvedValue({
      history: {
        events: [
          {
            eventId: '1',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
            workflowExecutionStartedEventAttributes: {
              continuedExecutionRunId: 'run-before',
            },
          },
        ],
      },
      nextPageToken: new Uint8Array(),
    } as any);
    workflowService.countWorkflowExecutions.mockResolvedValue({ count: 2 });
    const { server } = await start({ workflowService });
    const spaced = await request(server).get(
      `/api/temporal/namespaces/default/workflows/${encodeURIComponent(
        'nightly (eu)',
      )}/runs/r1/graph?entityRef=${ref}`,
    );
    expect(spaced.body.runChain).toEqual({
      previousRunId: 'run-before',
      index: 2,
      total: 2,
    });
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledWith({
      namespace: 'default',
      query: "WorkflowId = 'nightly (eu)'",
    });
    workflowService.countWorkflowExecutions.mockClear();
    const quoted = await request(server).get(
      `/api/temporal/namespaces/default/workflows/${encodeURIComponent(
        "it's",
      )}/runs/r1/graph?entityRef=${ref}`,
    );
    expect(quoted.body.runChain).toEqual({ previousRunId: 'run-before' });
    expect(workflowService.countWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('returns the progress of a run and caches closed runs', async () => {
    const { server, workflowService } = await start();
    const path = `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/progress?entityRef=${ref}`;
    const res = await request(server).get(path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'Failed',
      completedSteps: 0,
      totalSteps: 0,
      current: 'outer',
      truncated: false,
    });
    await request(server).get(path).expect(200);
    expect(workflowService.getWorkflowExecutionHistory).toHaveBeenCalledTimes(
      1,
    );
  });

  it('lists workflows for entities of any kind', async () => {
    const { server, workflowService } = await start();
    await request(server)
      .get('/api/temporal/entities/workflow/default/nightly/workflows')
      .expect(200);
    // Only the latest run of a workflow that continues as new, by default.
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "(WorkflowType = 'nightly') AND ExecutionStatus != 'ContinuedAsNew'",
      }),
    );
    await request(server)
      .get(
        '/api/temporal/entities/workflow/default/nightly/workflows?allRuns=true',
      )
      .expect(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "WorkflowType = 'nightly'" }),
    );
    await request(server)
      .get(
        '/api/temporal/entities/workflow/default/nightly/workflows?allRuns=yes',
      )
      .expect(400);
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
      `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
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

  it('lists the runs of a TemporalWorkflow entity from its spec', async () => {
    const { server, workflowService } = await start();
    await request(server)
      .get(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflows?allRuns=true',
      )
      .expect(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'default',
        query: "TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow'",
      }),
    );
  });

  it('merges the annotations with the TemporalWorkflow entities a component depends on', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.listWorkflowExecutions.mockResolvedValue({
      executions: [
        executionInfo({ workflowId: 'wf-order' }),
        executionInfo({ workflowId: 'wf-pay', type: 'paymentWorkflow' }),
        executionInfo({ workflowId: 'wf-deploy', type: 'deploymentWorkflow' }),
      ],
      nextPageToken: new Uint8Array(),
    });
    const { server } = await start({
      workflowService,
      entityRefAttribute: 'BackstageEntityRef',
    });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/checkout/workflows?allRuns=true',
    );
    expect(res.status).toBe(200);
    // The workflow in another namespace and the missing entity are left out.
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "(WorkflowType = 'deploymentWorkflow') OR " +
          "(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') OR " +
          "(WorkflowType = 'paymentWorkflow') OR " +
          "(BackstageEntityRef IN ('component:default/checkout', " +
          "'temporalworkflow:default/order-workflow', " +
          "'temporalworkflow:default/payment-workflow'))",
      }),
    );
    expect(
      res.body.items.map((i: any) => [i.workflowId, i.workflowEntityRef]),
    ).toEqual([
      ['wf-order', 'temporalworkflow:default/order-workflow'],
      ['wf-pay', 'temporalworkflow:default/payment-workflow'],
      ['wf-deploy', undefined],
    ]);
    expect(res.body.relatedWorkflows).toEqual({ total: 4, queried: 4 });
  });

  it('queries the first 20 related TemporalWorkflow entities and marks the rest', async () => {
    const total = MAX_RELATED_WORKFLOW_ENTITIES + 1;
    const { entity, workflows } = entityWithRelatedWorkflows(total);
    const logger = recordingLogger();
    const { server, workflowService } = await start({
      entities: [entity, ...workflows],
      recorder: logger,
    });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/many-workflows/workflows',
    );
    expect(res.status).toBe(200);
    expect(res.body.relatedWorkflows).toEqual({
      total,
      queried: MAX_RELATED_WORKFLOW_ENTITIES,
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringMatching(
          new RegExp(
            `WorkflowType = 'relatedType0'.*WorkflowType = 'relatedType${
              MAX_RELATED_WORKFLOW_ENTITIES - 1
            }'`,
          ),
        ),
      }),
    );
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.not.stringContaining(
          `WorkflowType = 'relatedType${MAX_RELATED_WORKFLOW_ENTITIES}'`,
        ),
      }),
    );
    expect(logger.records).toContainEqual({
      level: 'debug',
      message:
        'An entity depends on more TemporalWorkflow entities than are queried',
      meta: {
        entityRef: 'component:default/many-workflows',
        total,
        queried: MAX_RELATED_WORKFLOW_ENTITIES,
      },
    });
    const stats = await request(server).get(
      '/api/temporal/entities/component/default/many-workflows/workflow-stats',
    );
    expect(stats.status).toBe(200);
    expect(stats.body.relatedWorkflows).toEqual({
      total,
      queried: MAX_RELATED_WORKFLOW_ENTITIES,
    });
  });

  it('warns about a related TemporalWorkflow entity with an invalid spec, and leaves it out', async () => {
    const { entity, workflows } = entityWithRelatedWorkflows(2);
    workflows[0].spec = { owner: 'group:default/team-a', workflowType: 7 };
    const logger = recordingLogger();
    const { server } = await start({
      entities: [entity, ...workflows],
      recorder: logger,
    });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/many-workflows/workflows',
    );
    expect(res.status).toBe(200);
    expect(logger.records).toContainEqual({
      level: 'warn',
      message: 'Skipping a TemporalWorkflow entity with an invalid spec',
      meta: {
        entityRef: 'temporalworkflow:default/related-workflow-0',
        field: 'workflowType',
      },
    });
  });

  it('does not mark related TemporalWorkflow entities when there are 20 or fewer', async () => {
    const { entity, workflows } = entityWithRelatedWorkflows(
      MAX_RELATED_WORKFLOW_ENTITIES,
    );
    const logger = recordingLogger();
    const { server, workflowService } = await start({
      entities: [entity, ...workflows],
      recorder: logger,
    });
    const res = await request(server).get(
      '/api/temporal/entities/component/default/many-workflows/workflows',
    );
    expect(res.status).toBe(200);
    expect(res.body.relatedWorkflows).toEqual({
      total: MAX_RELATED_WORKFLOW_ENTITIES,
      queried: MAX_RELATED_WORKFLOW_ENTITIES,
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining(
          `WorkflowType = 'relatedType${MAX_RELATED_WORKFLOW_ENTITIES - 1}'`,
        ),
      }),
    );
    expect(logger.records.filter(r => r.meta.queried !== undefined)).toEqual(
      [],
    );
    const stats = await request(server).get(
      '/api/temporal/entities/component/default/many-workflows/workflow-stats',
    );
    expect(stats.body.relatedWorkflows).toEqual({
      total: MAX_RELATED_WORKFLOW_ENTITIES,
      queried: MAX_RELATED_WORKFLOW_ENTITIES,
    });
  });

  it('leaves out TemporalWorkflow entities the user may not read', async () => {
    const { server, workflowService } = await start({
      deny: ['temporalworkflow:default/payment-workflow'],
    });
    await request(server)
      .get(
        '/api/temporal/entities/component/default/checkout/workflows?allRuns=true',
      )
      .expect(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "(WorkflowType = 'deploymentWorkflow') OR " +
          "(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow')",
      }),
    );
  });

  it('shows a run of a related TemporalWorkflow entity on the component', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.describeWorkflowExecution.mockResolvedValue({
      workflowExecutionInfo: executionInfo({
        workflowId: 'wf-pay',
        type: 'paymentWorkflow',
        taskQueue: 'payments',
      }),
      pendingActivities: [],
    });
    const { server } = await start({ workflowService });
    await request(server)
      .get(
        '/api/temporal/namespaces/default/workflows/wf-pay/runs/wf-pay-run?entityRef=component:default/checkout',
      )
      .expect(200);
    await request(server)
      .get(
        `/api/temporal/namespaces/default/workflows/wf-pay/runs/wf-pay-run?entityRef=${ref}`,
      )
      .expect(404);
  });

  it('computes statistics of the most recent runs', async () => {
    const workflowService = createFakeWorkflowService();
    const closed = (id: string, status: string, seconds: number) => ({
      ...executionInfo({ workflowId: id, status }),
      closeTime: { seconds: String(1700000000 + seconds), nanos: 0 },
    });
    workflowService.listWorkflowExecutions.mockResolvedValue({
      executions: [
        closed('a', 'WORKFLOW_EXECUTION_STATUS_COMPLETED', 2),
        closed('b', 'WORKFLOW_EXECUTION_STATUS_COMPLETED', 4),
        closed('c', 'WORKFLOW_EXECUTION_STATUS_FAILED', 6),
        closed('d', 'WORKFLOW_EXECUTION_STATUS_TIMED_OUT', 8),
        executionInfo({
          workflowId: 'e',
          status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
        }),
      ] as any,
      nextPageToken: new Uint8Array(),
    });
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      '/api/temporal/entities/temporalworkflow/default/order-workflow/workflow-stats?limit=10',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      namespace: 'default',
      sampleSize: 5,
      limit: 10,
      byStatus: { Completed: 2, Failed: 1, TimedOut: 1, Running: 1 },
      succeeded: 2,
      failed: 2,
      running: 1,
      averageDurationMs: 5000,
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') AND ExecutionStatus != 'ContinuedAsNew'",
        pageSize: 10,
      }),
    );
    await request(server)
      .get(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflow-stats?limit=1000',
      )
      .expect(400);
    const denied = await start({ permission: AuthorizeResult.DENY });
    await request(denied.server)
      .get(
        '/api/temporal/entities/temporalworkflow/default/order-workflow/workflow-stats',
      )
      .expect(403);
  });

  it('leaves continued-as-new runs out of the statistics sample', async () => {
    const workflowService = createFakeWorkflowService();
    const closed = (id: string, status: string, seconds: number) => ({
      ...executionInfo({ workflowId: id, status }),
      closeTime: { seconds: String(1700000000 + seconds), nanos: 0 },
    });
    const executions = [
      closed('a', 'WORKFLOW_EXECUTION_STATUS_COMPLETED', 2),
      closed('b', 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW', 3),
      closed('c', 'WORKFLOW_EXECUTION_STATUS_FAILED', 6),
      closed('d', 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW', 7),
      executionInfo({
        workflowId: 'e',
        status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
      }),
    ];
    (workflowService.listWorkflowExecutions as jest.Mock).mockImplementation(
      async (req: any) => {
        const latestOnly = (req.query as string).includes(
          "ExecutionStatus != 'ContinuedAsNew'",
        );
        return {
          executions: latestOnly
            ? executions.filter(
                e => e.status !== 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW',
              )
            : executions,
          nextPageToken: new Uint8Array(),
        };
      },
    );
    const { server } = await start({ workflowService });
    const res = await request(server).get(
      '/api/temporal/entities/temporalworkflow/default/order-workflow/workflow-stats?limit=10',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      namespace: 'default',
      sampleSize: 3,
      limit: 10,
      byStatus: { Completed: 1, Failed: 1, Running: 1 },
      succeeded: 1,
      failed: 1,
      running: 1,
      averageDurationMs: 4000,
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("ExecutionStatus != 'ContinuedAsNew'"),
      }),
    );
  });

  describe('Workflows page', () => {
    it('lists every workflow of the namespace with filters', async () => {
      const workflowService = createFakeWorkflowService();
      workflowService.listWorkflowExecutions.mockResolvedValue({
        executions: [
          executionInfo({ workflowId: 'order-1' }),
          executionInfo({ workflowId: 'order-2', taskQueue: 'other' }),
          executionInfo({ workflowId: 'pay-1', type: 'paymentWorkflow' }),
        ],
        nextPageToken: new Uint8Array(),
      });
      const { server, permissions } = await start({ workflowService });
      const res = await request(server).get(
        '/api/temporal/workflows?status=Failed&workflowType=orderWorkflow&workflowId=order-&pageSize=10',
      );
      expect(res.status).toBe(200);
      expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith({
        namespace: 'default',
        query:
          "WorkflowType = 'orderWorkflow' AND WorkflowId STARTS_WITH 'order-' AND ExecutionStatus = 'Failed'",
        pageSize: 10,
        nextPageToken: undefined,
      });
      // Runs that match a TemporalWorkflow entity link to it.
      expect(
        res.body.items.map((i: any) => [i.workflowId, i.workflowEntityRef]),
      ).toEqual([
        ['order-1', 'temporalworkflow:default/order-workflow'],
        ['order-2', undefined],
        ['pay-1', 'temporalworkflow:default/payment-workflow'],
      ]);
      expect(permissions.authorizeConditional).toHaveBeenCalledWith(
        [
          {
            permission: expect.objectContaining({
              name: 'temporal.workflow.list',
            }),
          },
        ],
        expect.anything(),
      );
    });

    it('lists without filters', async () => {
      const { server, workflowService } = await start();
      await request(server).get('/api/temporal/workflows').expect(200);
      expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'default',
          query: "ExecutionStatus != 'ContinuedAsNew'",
        }),
      );
      await request(server)
        .get('/api/temporal/workflows?allRuns=true')
        .expect(200);
      expect(workflowService.listWorkflowExecutions).toHaveBeenLastCalledWith(
        expect.objectContaining({ namespace: 'default', query: '' }),
      );
    });

    it('rejects injection and other namespaces', async () => {
      const { server, workflowService } = await start();
      for (const query of [
        `workflowId=${encodeURIComponent("x' OR WorkflowId != '")}`,
        `workflowType=${encodeURIComponent('a b')}`,
        `status=${encodeURIComponent("Running' OR '1")}`,
      ]) {
        await request(server)
          .get(`/api/temporal/workflows?${query}`)
          .expect(400);
      }
      await request(server)
        .get('/api/temporal/workflows?namespace=secret')
        .expect(400);
      expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
    });

    it('needs the list permission', async () => {
      const { server, workflowService } = await start({
        deny: ['temporal.workflow.list'],
      });
      await request(server).get('/api/temporal/workflows').expect(403);
      // Denied before the namespace is checked: no hint which ones exist.
      await request(server)
        .get('/api/temporal/workflows?namespace=secret')
        .expect(403);
      expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
    });

    it('opens any workflow without an entity with the list permission', async () => {
      const { server, permissions } = await start();
      const detail = await request(server).get(
        '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run',
      );
      expect(detail.status).toBe(200);
      expect(detail.body.workflowId).toBe('wf-1');
      await request(server)
        .get(
          '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/history',
        )
        .expect(200);
      await request(server)
        .get(
          '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/result',
        )
        .expect(200);
      // Only basic permissions were checked, no entity.
      for (const [requests] of permissions.authorize.mock.calls as any[]) {
        expect(requests).toEqual([
          {
            permission: expect.objectContaining({
              name: expect.stringMatching(
                /^temporal\.workflow\.(list|history\.list)$/,
              ),
            }),
          },
        ]);
      }
    });

    it('needs the history list permission for history without an entity', async () => {
      const { server } = await start({
        deny: ['temporal.workflow.history.list'],
      });
      await request(server)
        .get('/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run')
        .expect(200);
      // The workflow has no entity reference attribute to fall back to:
      // the same answer as for a workflow that does not exist.
      for (const path of ['history', 'result']) {
        await request(server)
          .get(
            `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/${path}`,
          )
          .expect(404);
      }
      // The graph is shown without inputs and results.
      const graph = await request(server).get(
        '/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run/graph',
      );
      expect(graph.status).toBe(200);
      expect(graph.body.payloadsHidden).toBe(true);
      expect(graph.body.nodes[0]).not.toHaveProperty('input');
    });

    it('still checks the entity when entityRef is given', async () => {
      const { server } = await start({ deny: [ref] });
      await request(server)
        .get(
          `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run?entityRef=${ref}`,
        )
        .expect(403);
    });
  });

  it('denies apply-conditions when describing the workflow fails', async () => {
    const logger = recordingLogger();
    const workflowService = createFakeWorkflowService();
    const error = new Error('temporal unavailable');
    error.name = 'ServiceUnavailableError';
    workflowService.describeWorkflowExecution.mockRejectedValue(error);
    const { backend } = await start({ workflowService, recorder: logger });
    const resourceRef = stringifyTemporalWorkflowResourceRef({
      namespace: 'default',
      workflowId: 'wf-1',
    });
    const res = await request(backend)
      .post('/api/temporal/.well-known/backstage/permissions/apply-conditions')
      .set('Authorization', mockCredentials.service.header())
      .send({
        items: [
          {
            id: '1',
            resourceRef,
            resourceType: 'temporal-workflow',
            conditions: {
              rule: 'HAS_WORKFLOW_TYPE',
              resourceType: 'temporal-workflow',
              params: { workflowTypes: ['orderWorkflow'] },
            },
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ id: '1', result: AuthorizeResult.DENY }]);
    expect(logger.records).toContainEqual({
      level: 'warn',
      message: 'Failed to describe a permission resource',
      meta: { resourceRef },
      error,
    });
  });
});
