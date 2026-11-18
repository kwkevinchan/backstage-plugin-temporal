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
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalAccessServiceFactory } from './access/temporalAccessServiceFactory';
import { temporalPlugin } from './plugin';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
  ordersEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

// The run list of one workflow ID (GET /namespaces/:namespace/workflows/
// :workflowId): every run is listed with the permission check of the list
// it comes from, so runs of one workflow ID with another workflow type or
// initiator are left out.

const b64 = (s: string) => Buffer.from(s).toString('base64');

/** A run in the fake visibility store. */
interface Run {
  WorkflowId: string;
  RunId: string;
  WorkflowType: string;
  TaskQueue: string;
  ExecutionStatus: string;
  BackstageInitiator?: string;
  BackstageEntityRef?: string;
}

/**
 * Decides a visibility query of the forms the plugin writes:
 * `Field = 'v'`, `Field != 'v'`, `Field IN ('a', 'b')`, `Field = true`,
 * with AND, OR and brackets.
 */
function matches(query: string, run: Run): boolean {
  const tokens =
    query.match(/'(?:[^']*)'|\(|\)|,|!=|=|[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const value = () => {
    const t = next();
    return t.startsWith("'") ? t.slice(1, -1) : t;
  };
  function factor(): boolean {
    if (peek() === '(') {
      next();
      const result = expr();
      next(); // ')'
      return result;
    }
    const field = next() as keyof Run;
    const op = next();
    const actual = run[field] ?? '';
    if (op === 'IN') {
      next(); // '('
      const values = [value()];
      while (peek() === ',') {
        next();
        values.push(value());
      }
      next(); // ')'
      return values.includes(actual);
    }
    const expected = value();
    return op === '=' ? actual === expected : actual !== expected;
  }
  function term(): boolean {
    let result = factor();
    while (peek() === 'AND') {
      next();
      result = factor() && result;
    }
    return result;
  }
  function expr(): boolean {
    let result = term();
    while (peek() === 'OR') {
      next();
      result = term() || result;
    }
    return result;
  }
  return query.trim() === '' || expr();
}

const runs: Run[] = [
  {
    WorkflowId: 'wf-1',
    RunId: 'r3',
    WorkflowType: 'orderWorkflow',
    TaskQueue: 'orders',
    ExecutionStatus: 'Running',
    BackstageInitiator: 'user:default/alice',
  },
  {
    WorkflowId: 'wf-1',
    RunId: 'r2',
    WorkflowType: 'billingWorkflow',
    TaskQueue: 'billing',
    ExecutionStatus: 'ContinuedAsNew',
    BackstageInitiator: 'user:default/bob',
  },
  {
    WorkflowId: 'wf-1',
    RunId: 'r1',
    WorkflowType: 'orderWorkflow',
    TaskQueue: 'orders',
    ExecutionStatus: 'ContinuedAsNew',
    BackstageInitiator: 'user:default/bob',
  },
  {
    WorkflowId: 'wf-2',
    RunId: 'x1',
    WorkflowType: 'orderWorkflow',
    TaskQueue: 'orders',
    ExecutionStatus: 'Completed',
    BackstageInitiator: 'user:default/alice',
  },
];

const STATUS: Record<string, string> = {
  Running: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
  Completed: 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
  ContinuedAsNew: 'WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW',
};

function attribute(value: string) {
  return {
    metadata: { encoding: b64('json/plain') },
    data: b64(JSON.stringify(value)),
  };
}

function execution(run: Run) {
  const indexedFields: Record<string, unknown> = {};
  if (run.BackstageInitiator) {
    indexedFields.BackstageInitiator = attribute(run.BackstageInitiator);
  }
  if (run.BackstageEntityRef) {
    indexedFields.BackstageEntityRef = attribute(run.BackstageEntityRef);
  }
  return {
    execution: { workflowId: run.WorkflowId, runId: run.RunId },
    type: { name: run.WorkflowType },
    taskQueue: run.TaskQueue,
    status: STATUS[run.ExecutionStatus],
    startTime: { seconds: '1700000000', nanos: 0 },
    searchAttributes: { indexedFields },
  };
}

async function start(decisions: {
  /** Decision of temporal.workflow.list. */
  list?: PolicyDecision;
  /** Decision of temporal.workflow.read on an entity. */
  read?: AuthorizeResult;
}) {
  const workflowService = createFakeWorkflowService();
  (workflowService.listWorkflowExecutions as jest.Mock).mockImplementation(
    async (req: any) =>
      ({
        executions: runs.filter(r => matches(req.query, r)).map(execution),
        nextPageToken: new Uint8Array(),
      } as any),
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async (requests: any[]) =>
      requests.map(() => ({ result: decisions.read ?? AuthorizeResult.ALLOW })),
    ) as any,
    authorizeConditional: jest.fn(async (requests: any[]) =>
      requests.map(() => decisions.list ?? { result: AuthorizeResult.ALLOW }),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService, {
        entityRefAttribute: 'BackstageEntityRef',
        initiatorAttribute: 'BackstageInitiator',
      }),
      permissions.factory,
    ],
  });
  return {
    server: await withOpenApiValidation(server),
    workflowService,
    permissions,
    /** The visibility queries sent. */
    queries: () =>
      (
        workflowService.listWorkflowExecutions.mock.calls as unknown as [
          { query: string },
        ][]
      ).map(([req]) => req.query),
  };
}

const conditional = (
  rule: string,
  params: Record<string, string[]>,
): PolicyDecision => ({
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'temporal',
  resourceType: 'temporal-workflow',
  conditions: { rule, resourceType: 'temporal-workflow', params },
});

const path = '/api/temporal/namespaces/default/workflows/wf-1';
const runIds = (body: any) => body.items.map((i: any) => i.runId);

describe('the run list of a workflow ID', () => {
  it('lists every run of the ID, runs that continued as new included, in the order of the store', async () => {
    const { server, queries } = await start({});
    const res = await request(server).get(path);
    expect(res.status).toBe(200);
    expect(runIds(res.body)).toEqual(['r3', 'r2', 'r1']);
    expect(res.body.namespace).toBe('default');
    expect(queries()).toEqual(["WorkflowId = 'wf-1'"]);
  });

  it('applies the conditions of the list permission to every run', async () => {
    const { server, queries } = await start({
      list: conditional('IS_INITIATOR', { claims: ['user:default/bob'] }),
    });
    const res = await request(server).get(path);
    expect(res.status).toBe(200);
    expect(runIds(res.body)).toEqual(['r2', 'r1']);
    expect(queries()).toEqual([
      "WorkflowId = 'wf-1' AND (BackstageInitiator = 'user:default/bob')",
    ]);
  });

  it('leaves out the runs of another workflow type under the same ID', async () => {
    const { server } = await start({
      list: conditional('HAS_WORKFLOW_TYPE', {
        workflowTypes: ['orderWorkflow'],
      }),
    });
    const res = await request(server).get(path);
    expect(runIds(res.body)).toEqual(['r3', 'r1']);
  });

  it('answers 403 without listing when the list permission is denied', async () => {
    const { server, workflowService } = await start({
      list: { result: AuthorizeResult.DENY },
    });
    await request(server).get(path).expect(403);
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it("lists only the entity's runs with entityRef", async () => {
    const { server, queries } = await start({});
    const res = await request(server).get(
      `${path}?entityRef=component:default/orders`,
    );
    expect(res.status).toBe(200);
    expect(runIds(res.body)).toEqual(['r3', 'r1']);
    expect(queries()).toEqual([
      "((TaskQueue = 'orders' AND WorkflowType = 'orderWorkflow') OR (BackstageEntityRef = 'component:default/orders')) AND WorkflowId = 'wf-1'",
    ]);
  });

  it('answers 403 with entityRef when the entity may not be read', async () => {
    const { server, workflowService } = await start({
      read: AuthorizeResult.DENY,
    });
    await request(server)
      .get(`${path}?entityRef=component:default/orders`)
      .expect(403);
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('answers 404 when the entity is in another namespace than the path', async () => {
    const { server, workflowService } = await start({});
    const res = await request(server).get(
      '/api/temporal/namespaces/other/workflows/wf-1?entityRef=component:default/orders',
    );
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe('NotFoundError');
    expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('pages with pageSize and pageToken', async () => {
    const { server, workflowService } = await start({});
    await request(server)
      .get(`${path}?pageSize=1&pageToken=Bwc%3D`)
      .expect(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 1,
        nextPageToken: new Uint8Array([7, 7]),
      }),
    );
  });

  it('matches IDs with spaces and brackets', async () => {
    const { server, queries } = await start({});
    await request(server)
      .get(
        `/api/temporal/namespaces/default/workflows/${encodeURIComponent(
          'nightly (eu)',
        )}`,
      )
      .expect(200);
    expect(queries()).toEqual(["WorkflowId = 'nightly (eu)'"]);
  });

  it.each([["it's"], ['a"b'], ['a\\b'], ['a\nb']])(
    'answers 400 for the ID %j, which a visibility query cannot match',
    async id => {
      const { server, workflowService } = await start({});
      const res = await request(server).get(
        `/api/temporal/namespaces/default/workflows/${encodeURIComponent(id)}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('open the run by its run ID');
      expect(workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
    },
  );
});
