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
import { temporalWorkflowPermissionResourceRef } from '@kwkevinchan/backstage-plugin-temporal-node/alpha';
import request from 'supertest';
import { temporalPlugin } from '../plugin';
import {
  createFakeWorkflowService,
  fakeTemporalServiceFactory,
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

const condition = (rule: string): PermissionCondition => ({
  rule,
  resourceType: 'temporal-workflow',
  params: {},
});

async function start(conditions: PermissionCriteria<PermissionCondition>) {
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
      fakeTemporalServiceFactory(workflowService),
      permissions.factory,
    ],
  });
  return { server, workflowService };
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

describe('criteriaToVisibilityQuery', () => {
  it('joins allOf with AND and anyOf with OR', () => {
    expect(
      criteriaToVisibilityQuery({
        allOf: ["A = 'a'", { anyOf: ["B = 'b'", "C = 'c'"] }],
      }),
    ).toBe("(A = 'a') AND ((B = 'b') OR (C = 'c'))");
  });
});
