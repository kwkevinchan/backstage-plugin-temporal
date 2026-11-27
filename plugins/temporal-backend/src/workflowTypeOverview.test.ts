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
import type { Entity } from '@backstage/catalog-model';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  OVERVIEW_CACHE_TTL_MS,
  OVERVIEW_CONCURRENCY,
} from './services/WorkflowListQueries';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  FakeWorkflowService,
  orderWorkflowEntity,
  ordersEntity,
  paymentWorkflowEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';
import {
  recordingLogger,
  recordingLoggerFactory,
  type RecordingLogger,
} from './__testUtils__/recordingLogger';

// POST /workflow-types/overview: the numbers of the Workflows tab of the
// Temporal page.

const PATH = '/api/temporal/workflow-types/overview';
const ORDER = 'temporalworkflow:default/order-workflow';
const PAYMENT = 'temporalworkflow:default/payment-workflow';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const SINCE = '2026-11-13T12:00:00.000Z';

const seconds = (iso: string) => ({
  seconds: String(Date.parse(iso) / 1000),
  nanos: 0,
});

/** A run of the fake visibility store, with its start and close times. */
function run(
  workflowId: string,
  status: string,
  times: { start: string; close?: string },
) {
  return {
    ...executionInfo({ workflowId, status }),
    startTime: seconds(times.start),
    ...(times.close ? { closeTime: seconds(times.close) } : {}),
  };
}

/** A group of a grouped count: the status as a JSON payload. */
function group(status: string, count: number) {
  return {
    groupValues: [
      {
        metadata: { encoding: Buffer.from('json/plain') },
        data: Buffer.from(JSON.stringify(status)),
      },
    ],
    count,
  };
}

function workflowEntities(count: number): Entity[] {
  return Array.from({ length: count }, (_, i) => ({
    apiVersion: 'temporal.io/v1alpha1',
    kind: 'TemporalWorkflow',
    metadata: { name: `type-${i}`, namespace: 'default' },
    spec: { owner: 'group:default/team-a', workflowType: `type${i}` },
  }));
}

async function start(options?: {
  workflowService?: FakeWorkflowService;
  deny?: string[];
  entities?: Entity[];
  recorder?: RecordingLogger;
}) {
  const workflowService =
    options?.workflowService ?? createFakeWorkflowService();
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map((r: any) => ({
        result: options?.deny?.includes(r.resourceRef)
          ? AuthorizeResult.DENY
          : AuthorizeResult.ALLOW,
      })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.ALLOW })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({
        entities: options?.entities ?? [
          ordersEntity,
          orderWorkflowEntity,
          paymentWorkflowEntity,
        ],
      }),
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
      ...(options?.recorder ? [recordingLoggerFactory(options.recorder)] : []),
    ],
  });
  return {
    server: await withOpenApiValidation(server),
    workflowService,
    permissions,
  };
}

const queriesOf = (mock: jest.Mock) =>
  mock.mock.calls.map(([req]: any[]) => req.query);

describe('POST /workflow-types/overview', () => {
  let now: jest.SpyInstance;
  beforeEach(() => {
    now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => now.mockRestore());

  it('counts by status with one grouped count, and reads the latest runs', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockResolvedValue({
      count: 131,
      groups: [
        group('Running', 3),
        group('Completed', 120),
        group('Failed', 1),
        group('TimedOut', 1),
        group('Canceled', 4),
        group('ContinuedAsNew', 2),
      ],
    } as any);
    workflowService.listWorkflowExecutions.mockResolvedValue({
      executions: [
        run('wf-3', 'WORKFLOW_EXECUTION_STATUS_RUNNING', {
          start: '2026-11-20T11:00:00Z',
        }),
        run('wf-2', 'WORKFLOW_EXECUTION_STATUS_TIMED_OUT', {
          start: '2026-11-19T10:00:00Z',
          close: '2026-11-19T10:00:04Z',
        }),
        run('wf-1', 'WORKFLOW_EXECUTION_STATUS_FAILED', {
          start: '2026-11-18T10:00:00Z',
          close: '2026-11-18T10:00:02Z',
        }),
      ],
      nextPageToken: new Uint8Array(),
    } as any);
    const { server } = await start({ workflowService });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          entityRef: ORDER,
          running: 3,
          completed: 120,
          failed: 2,
          windowDays: 7,
          sampleSize: 3,
          averageDurationMs: 3000,
          latestRun: {
            namespace: 'default',
            workflowId: 'wf-3',
            runId: 'wf-3-run',
            status: 'Running',
            startTime: '2026-11-20T11:00:00.000Z',
          },
          lastFailure: {
            namespace: 'default',
            workflowId: 'wf-2',
            runId: 'wf-2-run',
            status: 'TimedOut',
            startTime: '2026-11-19T10:00:00.000Z',
            closeTime: '2026-11-19T10:00:04.000Z',
          },
          updatedAt: new Date(NOW).toISOString(),
        },
      ],
    });
    const entity = "TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow'";
    expect(queriesOf(workflowService.countWorkflowExecutions)).toEqual([
      `(${entity}) AND (ExecutionStatus = 'Running' OR CloseTime > '${SINCE}') GROUP BY ExecutionStatus`,
    ]);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledTimes(1);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: `(${entity}) AND ExecutionStatus != 'ContinuedAsNew'`,
        pageSize: 50,
      }),
    );
  });

  it('counts three times when the server cannot group', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockImplementation(
      async (req: any) => {
        if (req.query.includes('GROUP BY')) {
          throw Object.assign(new Error('3 INVALID_ARGUMENT: GROUP BY'), {
            code: 3,
          });
        }
        if (req.query.endsWith("ExecutionStatus = 'Running'")) {
          return { count: 2 };
        }
        return { count: req.query.includes("'Completed'") ? 40 : 5 };
      },
    );
    const { server } = await start({ workflowService });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: [PAYMENT] });
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      entityRef: PAYMENT,
      running: 2,
      completed: 40,
      failed: 5,
    });
    const entity = "WorkflowType = 'paymentWorkflow'";
    expect(queriesOf(workflowService.countWorkflowExecutions)).toEqual([
      `(${entity}) AND (ExecutionStatus = 'Running' OR CloseTime > '${SINCE}') GROUP BY ExecutionStatus`,
      `(${entity}) AND ExecutionStatus = 'Running'`,
      `(${entity}) AND ExecutionStatus = 'Completed' AND CloseTime > '${SINCE}'`,
      `(${entity}) AND ExecutionStatus IN ('Failed', 'TimedOut', 'Terminated') AND CloseTime > '${SINCE}'`,
    ]);
  });

  it('looks for the last failure when the failures of the 7 days are not among the latest runs', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockResolvedValue({
      count: 1,
      groups: [group('Terminated', 1)],
    } as any);
    workflowService.listWorkflowExecutions.mockImplementation(((req: any) => ({
      executions:
        req.pageSize === 1
          ? [
              run('old-fail', 'WORKFLOW_EXECUTION_STATUS_TERMINATED', {
                start: '2026-11-14T10:00:00Z',
                close: '2026-11-14T10:01:00Z',
              }),
            ]
          : [
              // Canceled is not a failure; a failure before the 7 days
              // does not count.
              run('canceled', 'WORKFLOW_EXECUTION_STATUS_CANCELED', {
                start: '2026-11-20T10:00:00Z',
                close: '2026-11-20T10:00:01Z',
              }),
              run('older', 'WORKFLOW_EXECUTION_STATUS_FAILED', {
                start: '2026-11-01T10:00:00Z',
                close: '2026-11-01T10:00:01Z',
              }),
            ],
      nextPageToken: new Uint8Array(),
    })) as any);
    const { server } = await start({ workflowService });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(res.status).toBe(200);
    expect(res.body.items[0].failed).toBe(1);
    expect(res.body.items[0].lastFailure).toMatchObject({
      workflowId: 'old-fail',
      status: 'Terminated',
    });
    expect(workflowService.listWorkflowExecutions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: `(TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') AND ExecutionStatus IN ('Failed', 'TimedOut', 'Terminated') AND CloseTime > '${SINCE}'`,
        pageSize: 1,
      }),
    );
  });

  it('makes no failure list without failures in the 7 days', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockResolvedValue({
      count: 1,
      groups: [group('Completed', 1)],
    } as any);
    const { server } = await start({ workflowService });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(res.body.items[0].lastFailure).toBeUndefined();
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledTimes(1);
  });

  it('checks the permission on every entity in one request and leaves out the denied ones', async () => {
    const { server, permissions, workflowService } = await start({
      deny: [PAYMENT],
    });
    const res = await request(server)
      .post(PATH)
      .send({
        entityRefs: [PAYMENT, 'TemporalWorkflow:default/Order-Workflow'],
      });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.entityRef)).toEqual([ORDER]);
    expect(permissions.authorize).toHaveBeenCalledTimes(1);
    expect(
      (permissions.authorize as jest.Mock).mock.calls[0][0].map((r: any) => [
        r.permission.name,
        r.resourceRef,
      ]),
    ).toEqual([
      ['temporal.workflow.read', PAYMENT],
      ['temporal.workflow.read', ORDER],
    ]);
    // Nothing of the denied entity is read.
    for (const query of queriesOf(workflowService.countWorkflowExecutions)) {
      expect(query).not.toContain('paymentWorkflow');
    }
  });

  it('leaves out entities that do not exist', async () => {
    const { server } = await start();
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: ['temporalworkflow:default/missing', ORDER] });
    expect(res.body.items.map((i: any) => i.entityRef)).toEqual([ORDER]);
  });

  it('keeps the numbers for 60 seconds, and checks the permission every time', async () => {
    const { server, workflowService, permissions } = await start();
    const first = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    now.mockReturnValue(NOW + OVERVIEW_CACHE_TTL_MS - 1);
    const second = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(second.body).toEqual(first.body);
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledTimes(1);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledTimes(1);
    expect(permissions.authorize).toHaveBeenCalledTimes(2);

    now.mockReturnValue(NOW + OVERVIEW_CACHE_TTL_MS);
    const third = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledTimes(2);
    expect(third.body.items[0].updatedAt).toBe(
      new Date(NOW + OVERVIEW_CACHE_TTL_MS).toISOString(),
    );
  });

  it('answers no items to a user who may not read an entity whose numbers are kept', async () => {
    const deny: string[] = [];
    const { server, workflowService } = await start({ deny });
    const first = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(first.body.items).toHaveLength(1);
    // Another user, refused while the numbers are still kept.
    deny.push(ORDER);
    const second = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER] });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ items: [] });
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledTimes(1);
  });

  it('answers with the requested entity when two entities share kept numbers', async () => {
    const twin = (name: string): Entity => ({
      apiVersion: 'temporal.io/v1alpha1',
      kind: 'TemporalWorkflow',
      metadata: { name, namespace: 'default' },
      spec: {
        owner: 'group:default/team-a',
        workflowType: 'orderWorkflow',
        taskQueue: 'orders',
      },
    });
    const { server, workflowService } = await start({
      entities: [twin('first'), twin('second')],
    });
    await request(server)
      .post(PATH)
      .send({ entityRefs: ['temporalworkflow:default/first'] });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: ['temporalworkflow:default/second'] });
    expect(res.body.items.map((i: any) => i.entityRef)).toEqual([
      'temporalworkflow:default/second',
    ]);
    // The same visibility query: read once.
    expect(workflowService.countWorkflowExecutions).toHaveBeenCalledTimes(1);
  });

  it('has at most 4 visibility calls in flight in a namespace', async () => {
    const entities = workflowEntities(25);
    let inFlight = 0;
    let most = 0;
    const slow =
      <T>(value: T) =>
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight -= 1;
        return value;
      };
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockImplementation(
      slow({ count: 0, groups: [] }) as any,
    );
    workflowService.listWorkflowExecutions.mockImplementation(
      slow({ executions: [], nextPageToken: new Uint8Array() }) as any,
    );
    const { server } = await start({ workflowService, entities });
    const res = await request(server)
      .post(PATH)
      .send({
        entityRefs: entities.map(
          e => `temporalworkflow:default/${e.metadata.name}`,
        ),
      });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(25);
    expect(
      workflowService.countWorkflowExecutions.mock.calls.length +
        workflowService.listWorkflowExecutions.mock.calls.length,
    ).toBe(50);
    expect(most).toBe(OVERVIEW_CONCURRENCY);
  });

  it('answers an item with an error when Temporal rate limits, without retrying', async () => {
    const workflowService = createFakeWorkflowService();
    workflowService.countWorkflowExecutions.mockImplementation(
      async (req: any) => {
        if (req.query.includes('paymentWorkflow')) {
          throw Object.assign(
            new Error('8 RESOURCE_EXHAUSTED: namespace rate limit exceeded'),
            { code: 8 },
          );
        }
        return { count: 1, groups: [group('Running', 1)] };
      },
    );
    const recorder = recordingLogger();
    const { server } = await start({ workflowService, recorder });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: [ORDER, PAYMENT] });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('namespace rate limit');
    expect(recorder.records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Call to Temporal failed',
        meta: expect.objectContaining({
          errorMessage: '8 RESOURCE_EXHAUSTED: namespace rate limit exceeded',
        }),
      }),
    );
    expect(res.body.items[0]).toMatchObject({ entityRef: ORDER, running: 1 });
    expect(res.body.items[0].error).toBeUndefined();
    expect(res.body.items[1]).toMatchObject({
      entityRef: PAYMENT,
      running: 0,
      error: {
        message: 'Temporal is rate limiting the backend',
        rateLimited: true,
      },
    });
    expect(
      queriesOf(workflowService.countWorkflowExecutions).filter(q =>
        q.includes('paymentWorkflow'),
      ),
    ).toHaveLength(1);
    // A failed item is not kept: the next request reads it again.
    await request(server)
      .post(PATH)
      .send({ entityRefs: [PAYMENT] });
    expect(
      queriesOf(workflowService.countWorkflowExecutions).filter(q =>
        q.includes('paymentWorkflow'),
      ),
    ).toHaveLength(2);
  });

  it.each([
    [
      'times out',
      Object.assign(new Error('4 DEADLINE_EXCEEDED: host-a:7233'), { code: 4 }),
      'Temporal did not answer in time',
    ],
    [
      'is not reachable',
      Object.assign(new Error('14 UNAVAILABLE: host-a:7233 refused'), {
        code: 14,
      }),
      'The numbers could not be read',
    ],
    [
      'fails in another way',
      new Error('query: Owner = "team-x" host-a:7233'),
      'The numbers could not be read',
    ],
  ])(
    'answers an item with a fixed message when Temporal %s',
    async (_n, failure, message) => {
      const workflowService = createFakeWorkflowService();
      workflowService.countWorkflowExecutions.mockRejectedValue(failure);
      const recorder = recordingLogger();
      const { server } = await start({ workflowService, recorder });
      const res = await request(server)
        .post(PATH)
        .send({ entityRefs: [ORDER] });
      expect(res.status).toBe(200);
      expect(res.body.items[0].error).toEqual({ message });
      expect(JSON.stringify(res.body)).not.toContain('host-a');
      expect(JSON.stringify(res.body)).not.toContain('Owner');
      expect(recorder.records).toContainEqual(
        expect.objectContaining({
          meta: expect.objectContaining({
            errorMessage: (failure as Error).message,
          }),
        }),
      );
    },
  );

  it('answers an item with an error for an entity whose workflows cannot be listed', async () => {
    const otherNamespace: Entity = {
      apiVersion: 'temporal.io/v1alpha1',
      kind: 'TemporalWorkflow',
      metadata: { name: 'audit', namespace: 'default' },
      spec: {
        owner: 'group:default/team-a',
        workflowType: 'auditWorkflow',
        namespace: 'audit',
      },
    };
    const recorder = recordingLogger();
    const { server } = await start({
      entities: [orderWorkflowEntity, otherNamespace],
      recorder,
    });
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: ['temporalworkflow:default/audit'] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        entityRef: 'temporalworkflow:default/audit',
        error: { message: 'The numbers could not be read' },
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('not allowed');
    expect(recorder.records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Could not read the workflows of an entity',
        error: expect.objectContaining({
          message: 'Temporal namespace is not allowed: audit',
        }),
      }),
    );
  });

  it.each([
    ['no entityRefs', {}],
    ['an empty list', { entityRefs: [] }],
    [
      'more than 25 references',
      {
        entityRefs: workflowEntities(26).map(
          e => `temporalworkflow:default/${e.metadata.name}`,
        ),
      },
    ],
  ])('refuses %s', async (_name, body) => {
    const { server } = await start();
    const res = await request(server).post(PATH).send(body);
    expect(res.status).toBe(400);
  });

  it('accepts 25 references', async () => {
    const entities = workflowEntities(25);
    const { server } = await start({ entities });
    const res = await request(server)
      .post(PATH)
      .send({
        entityRefs: entities.map(
          e => `temporalworkflow:default/${e.metadata.name}`,
        ),
      });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(25);
  });

  it('refuses a reference that is not of a TemporalWorkflow entity', async () => {
    const { server, permissions } = await start();
    const res = await request(server)
      .post(PATH)
      .send({ entityRefs: ['component:default/orders'] });
    expect(res.status).toBe(400);
    expect(permissions.authorize).not.toHaveBeenCalled();
  });
});
