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
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import {
  AuthorizeResult,
  PermissionCriteria,
  PermissionCondition,
} from '@backstage/plugin-permission-common';
import { createPermissionRule } from '@backstage/plugin-permission-node';
import { temporalWorkflowPermissionResourceRef } from '../node/alpha';
import request from 'supertest';
import { temporalPlugin } from '../plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  FakeWorkflowService,
} from '../testUtils';
import { criteriaToVisibilityQuery } from './DefaultTemporalAccessService';
import { temporalAccessServiceFactory } from './temporalAccessServiceFactory';

/** A rule added by a module, as an adopter would write one. */
const isOrderWorkflow = createPermissionRule({
  name: 'IS_ORDER_WORKFLOW',
  description: 'The workflow type is orderWorkflow',
  resourceRef: temporalWorkflowPermissionResourceRef,
  apply: workflow => workflow.workflowType === 'orderWorkflow',
  toQuery: () => "WorkflowType = 'orderWorkflow'",
});

const rulesModule = createBackendModule({
  pluginId: 'temporal',
  moduleId: 'test-rules',
  register(reg) {
    reg.registerInit({
      deps: { registry: coreServices.permissionsRegistry },
      async init({ registry }) {
        registry.addPermissionRules([isOrderWorkflow]);
      },
    });
  },
});

const condition = (
  rule: string,
  params: Record<string, string[]> = {},
): PermissionCondition => ({
  rule,
  resourceType: 'temporal-workflow',
  params,
});

async function start(
  conditions: PermissionCriteria<PermissionCondition>,
  options?: { initiatorAttribute?: string },
) {
  const workflowService = createFakeWorkflowService();
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async requests =>
      requests.map(() => ({ result: AuthorizeResult.DENY })),
    ) as any,
    authorizeConditional: jest.fn(async requests =>
      requests.map(() => ({
        result: AuthorizeResult.CONDITIONAL,
        pluginId: 'temporal',
        resourceType: 'temporal-workflow',
        conditions,
      })),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      rulesModule,
      catalogServiceMock.factory({ entities: [] }),
      fakeTemporalServiceFactory(workflowService, options),
      permissions.factory,
    ],
  });
  return { server, workflowService };
}

/** The visibility query of the last list call. */
function listQuery(workflowService: FakeWorkflowService): string {
  const calls = workflowService.listWorkflowExecutions.mock
    .calls as unknown as Array<[{ query: string }]>;
  return calls[calls.length - 1][0].query;
}

describe('conditional temporal-workflow decisions', () => {
  it('turns the conditions into a visibility query for the list', async () => {
    const { server, workflowService } = await start(
      condition('IS_ORDER_WORKFLOW'),
    );
    const res = await request(server).get(
      '/api/temporal/workflows?status=Running',
    );
    expect(res.status).toBe(200);
    expect(workflowService.listWorkflowExecutions).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "ExecutionStatus = 'Running' AND (WorkflowType = 'orderWorkflow')",
      }),
    );
  });

  it('applies the conditions to a workflow opened without an entity', async () => {
    const { server } = await start(condition('IS_ORDER_WORKFLOW'));
    const res = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-1',
    );
    expect(res.status).toBe(200);
    expect(res.body.workflowType).toBe('orderWorkflow');
  });

  it('allows nothing for a condition with an unknown rule', async () => {
    const { server } = await start(condition('NO_SUCH_RULE'));
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(403);
  });

  it('refuses a not condition for the list', async () => {
    const { server } = await start({ not: condition('IS_ORDER_WORKFLOW') });
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(403);
  });
});

describe('the rules of the plugin', () => {
  it('HAS_WORKFLOW_TYPE and HAS_TASK_QUEUE become a visibility query', async () => {
    const { server, workflowService } = await start({
      anyOf: [
        condition('HAS_WORKFLOW_TYPE', { workflowTypes: ['a', 'b'] }),
        condition('HAS_TASK_QUEUE', { taskQueues: ['orders'] }),
      ],
    });
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(200);
    expect(listQuery(workflowService)).toContain(
      "((WorkflowType IN ('a', 'b')) OR (TaskQueue = 'orders'))",
    );
  });

  it('IN_NAMESPACE is decided for the namespace being listed', async () => {
    const allowed = await start({
      allOf: [
        condition('IN_NAMESPACE', { namespaces: ['default'] }),
        condition('HAS_WORKFLOW_TYPE', { workflowTypes: ['orderWorkflow'] }),
      ],
    });
    const res = await request(allowed.server).get('/api/temporal/workflows');
    expect(res.status).toBe(200);
    expect(listQuery(allowed.workflowService)).toContain(
      "(WorkflowType = 'orderWorkflow')",
    );
    expect(listQuery(allowed.workflowService)).not.toContain('default');

    const other = await start(
      condition('IN_NAMESPACE', { namespaces: ['other'] }),
    );
    const denied = await request(other.server).get('/api/temporal/workflows');
    expect(denied.status).toBe(403);
    expect(other.workflowService.listWorkflowExecutions).not.toHaveBeenCalled();
  });

  it('allows a not condition on the namespace', async () => {
    const { server } = await start({
      not: condition('IN_NAMESPACE', { namespaces: ['other'] }),
    });
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(200);
  });

  it('IN_NAMESPACE applies to a workflow opened without an entity', async () => {
    const { server } = await start(
      condition('IN_NAMESPACE', { namespaces: ['other'] }),
    );
    const res = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-1',
    );
    expect(res.status).toBe(403);
  });

  it('IS_INITIATOR uses the initiator search attribute', async () => {
    const claims = ['user:default/alice', 'group:default/team-a'];
    const { server, workflowService } = await start(
      condition('IS_INITIATOR', { claims }),
      { initiatorAttribute: 'BackstageInitiator' },
    );
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(200);
    expect(listQuery(workflowService)).toContain(
      "(BackstageInitiator IN ('user:default/alice', 'group:default/team-a'))",
    );

    const b64 = (v: string) => Buffer.from(v).toString('base64');
    const started = (by: string) => ({
      workflowExecutionInfo: {
        ...executionInfo({ workflowId: 'wf-1' }),
        searchAttributes: {
          indexedFields: {
            BackstageInitiator: {
              metadata: { encoding: b64('json/plain') },
              data: b64(JSON.stringify(by)),
            },
          },
        },
      } as any,
      pendingActivities: [],
    });
    workflowService.describeWorkflowExecution.mockResolvedValue(
      started('user:default/alice'),
    );
    const mine = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-1',
    );
    expect(mine.status).toBe(200);
    expect(mine.body.initiator).toBe('user:default/alice');
    workflowService.describeWorkflowExecution.mockResolvedValue(
      started('user:default/bob'),
    );
    const theirs = await request(server).get(
      '/api/temporal/namespaces/default/workflows/wf-1',
    );
    expect(theirs.status).toBe(403);
  });

  it('IS_INITIATOR allows nothing without the search attribute', async () => {
    const { server } = await start(
      condition('IS_INITIATOR', { claims: ['user:default/alice'] }),
    );
    const res = await request(server).get('/api/temporal/workflows');
    expect(res.status).toBe(403);
  });

  it('refuses invalid params', async () => {
    for (const conditions of [
      condition('HAS_WORKFLOW_TYPE', { workflowTypes: [] }),
      condition('HAS_TASK_QUEUE', { taskQueues: ["x' OR TaskQueue != '"] }),
      condition('IS_INITIATOR', { claims: ["user:default/a' OR 1=1"] }),
    ]) {
      const { server } = await start(conditions, {
        initiatorAttribute: 'BackstageInitiator',
      });
      const res = await request(server).get('/api/temporal/workflows');
      expect(res.status).toBe(403);
    }
  });
});

describe('criteriaToVisibilityQuery', () => {
  const scope = { namespace: 'default' };

  it('joins allOf with AND and anyOf with OR', () => {
    expect(
      criteriaToVisibilityQuery(
        { allOf: ["A = 'a'", { anyOf: ["B = 'b'", "C = 'c'"] }] },
        scope,
      ),
    ).toBe("(A = 'a') AND ((B = 'b') OR (C = 'c'))");
  });

  it('folds the namespace conditions', () => {
    const here = { namespaces: ['default'] };
    const elsewhere = { namespaces: ['other'] };
    expect(criteriaToVisibilityQuery(here, scope)).toBe(true);
    expect(criteriaToVisibilityQuery({ allOf: ["A = 'a'", here] }, scope)).toBe(
      "(A = 'a')",
    );
    expect(
      criteriaToVisibilityQuery({ allOf: ["A = 'a'", elsewhere] }, scope),
    ).toBe(false);
    expect(criteriaToVisibilityQuery({ anyOf: ["A = 'a'", here] }, scope)).toBe(
      true,
    );
    expect(
      criteriaToVisibilityQuery({ anyOf: ["A = 'a'", elsewhere] }, scope),
    ).toBe("(A = 'a')");
    expect(criteriaToVisibilityQuery({ not: elsewhere }, scope)).toBe(true);
  });

  it('refuses a not condition on a query', () => {
    expect(() => criteriaToVisibilityQuery({ not: "A = 'a'" }, scope)).toThrow(
      'cannot be applied',
    );
  });
});
