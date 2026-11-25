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
import { temporalAccessServiceFactory } from './temporalAccessServiceFactory';
import { temporalPlugin } from '../plugin';
import {
  createFakeWorkflowService,
  executionInfo,
  fakeTemporalServiceFactory,
  ordersEntity,
} from '../testUtils';
import { withOpenApiValidation } from '../__testUtils__/openapi';

// Opening a workflow without entityRef: the caller that no permission can
// allow is refused before the workflow is read; for the others, a workflow
// they may not open gets the same answer as one that does not exist.

const b64 = (s: string) => Buffer.from(s).toString('base64');
const ALLOW: PolicyDecision = { result: AuthorizeResult.ALLOW };
const DENY: PolicyDecision = { result: AuthorizeResult.DENY };
const inNamespaces = (namespaces: string[]): PolicyDecision => ({
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'temporal',
  resourceType: 'temporal-workflow',
  conditions: {
    rule: 'IN_NAMESPACE',
    resourceType: 'temporal-workflow',
    params: { namespaces },
  },
});
const entityConditional: PolicyDecision = {
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'catalog',
  resourceType: 'catalog-entity',
  conditions: {
    rule: 'IS_ENTITY_OWNER',
    resourceType: 'catalog-entity',
    params: { claims: [] },
  },
};

interface Setup {
  /** Decision of temporal.workflow.list. */
  list: PolicyDecision;
  /** Decision of the entity permission without a resource. */
  entityAny: PolicyDecision;
  /** Decision of the entity permission on an entity. */
  entity?: AuthorizeResult;
  /** The entity reference search attribute of the workflow. */
  linked?: string;
  /** The task queue of the workflow; the entity's by default. */
  taskQueue?: string;
}

async function start(setup: Setup) {
  const workflowService = createFakeWorkflowService();
  let exists = true;
  workflowService.describeWorkflowExecution.mockImplementation(
    async (req: any) => {
      if (!exists) {
        throw Object.assign(
          new Error(
            `5 NOT_FOUND: workflow not found for ID: ${req.execution.workflowId}`,
          ),
          { code: 5 },
        );
      }
      return {
        workflowExecutionInfo: {
          ...executionInfo({
            workflowId: req.execution.workflowId,
            status: 'WORKFLOW_EXECUTION_STATUS_RUNNING',
            ...(setup.taskQueue ? { taskQueue: setup.taskQueue } : {}),
          }),
          searchAttributes: {
            indexedFields: setup.linked
              ? {
                  BackstageEntityRef: {
                    metadata: { encoding: b64('json/plain') },
                    data: b64(JSON.stringify(setup.linked)),
                  },
                }
              : {},
          },
        },
        pendingActivities: [],
      } as any;
    },
  );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async (requests: any[]) =>
      requests.map(() => ({ result: setup.entity ?? AuthorizeResult.DENY })),
    ) as any,
    authorizeConditional: jest.fn(async (requests: any[]) =>
      requests.map((r: any) => {
        if (r.permission.name === 'temporal.workflow.list') return setup.list;
        return setup.entityAny;
      }),
    ) as any,
  });
  const { server } = await startTestBackend({
    features: [
      temporalPlugin,
      temporalAccessServiceFactory,
      catalogServiceMock.factory({ entities: [ordersEntity] }),
      fakeTemporalServiceFactory(workflowService, {
        entityRefAttribute: 'BackstageEntityRef',
      }),
      permissions.factory,
    ],
  });
  const validated = await withOpenApiValidation(server);
  return {
    workflowService,
    /** The answer for the workflow, existing or not. */
    async get(options: { exists: boolean; path?: string }) {
      exists = options.exists;
      workflowService.describeWorkflowExecution.mockClear();
      const res = await request(validated).get(
        `/api/temporal/namespaces/default/workflows/wf-1/runs/wf-1-run${
          options.path ?? ''
        }`,
      );
      return {
        status: res.status,
        body: res.body,
        describes: workflowService.describeWorkflowExecution.mock.calls.length,
      };
    },
  };
}

describe('opening a workflow without entityRef', () => {
  it('refuses a caller that no permission can allow without reading the workflow', async () => {
    const backend = await start({ list: DENY, entityAny: DENY });
    for (const exists of [true, false]) {
      const res = await backend.get({ exists });
      expect(res).toMatchObject({ status: 403, describes: 0 });
    }
  });

  it('serves the history and the result with the list permission alone', async () => {
    const backend = await start({ list: ALLOW, entityAny: DENY });
    const history = await backend.get({ exists: true, path: '/history' });
    expect(history.status).toBe(200);
    expect(history.body.events[0].attributes.input.payloads[0]).toEqual({
      encoding: 'json/plain',
      value: 42,
    });
    const result = await backend.get({ exists: true, path: '/result' });
    expect(result.status).toBe(200);
    expect(result.body.failure.message).toBe('outer');
  });

  const sameAsMissing: [string, Setup][] = [
    [
      'the list permission is denied and the workflow is linked to an entity the caller may not read',
      {
        list: DENY,
        entityAny: entityConditional,
        linked: 'component:default/orders',
      },
    ],
    [
      'the list permission is denied and the workflow is not linked to an entity',
      { list: DENY, entityAny: ALLOW, entity: AuthorizeResult.ALLOW },
    ],
    [
      'the list permission is denied and the linked entity does not exist',
      {
        list: DENY,
        entityAny: ALLOW,
        entity: AuthorizeResult.ALLOW,
        linked: 'component:default/gone',
      },
    ],
    [
      'the condition of the list permission does not match and the entity permission is denied',
      { list: inNamespaces(['other']), entityAny: DENY },
    ],
    [
      'the condition of the list permission does not match and the linked entity may not be read',
      {
        list: inNamespaces(['other']),
        entityAny: entityConditional,
        linked: 'component:default/orders',
      },
    ],
  ];

  it.each(sameAsMissing)(
    'answers as for a workflow that does not exist when %s',
    async (_name, setup) => {
      const backend = await start(setup);
      const denied = await backend.get({ exists: true });
      const missing = await backend.get({ exists: false });
      expect(missing.status).toBe(404);
      expect(denied.status).toBe(missing.status);
      expect(denied.body).toEqual(missing.body);
      expect(denied.body.error.message).toBe('Workflow wf-1 was not found');
      expect(JSON.stringify(denied.body)).not.toMatch(/entityRef|component:/);
    },
  );

  it('answers with the workflow when the condition of the list permission matches', async () => {
    const backend = await start({
      list: inNamespaces(['default']),
      entityAny: DENY,
    });
    const found = await backend.get({ exists: true });
    expect(found.status).toBe(200);
    expect(found.body.workflowId).toBe('wf-1');
    const missing = await backend.get({ exists: false });
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('Workflow wf-1 was not found');
  });

  it('opens a workflow through its linked entity without the list permission', async () => {
    const backend = await start({
      list: DENY,
      entityAny: entityConditional,
      entity: AuthorizeResult.ALLOW,
      linked: 'component:default/orders',
    });
    const res = await backend.get({ exists: true });
    expect(res.status).toBe(200);
    expect(res.body.entityRef).toBe('component:default/orders');
  });

  it("answers with entityRef as for a workflow that does not exist when the workflow is not the entity's", async () => {
    const backend = await start({
      list: DENY,
      entityAny: entityConditional,
      entity: AuthorizeResult.ALLOW,
      linked: 'component:default/other',
      taskQueue: 'billing',
    });
    const path = '?entityRef=component:default/orders';
    const other = await backend.get({ exists: true, path });
    const missing = await backend.get({ exists: false, path });
    expect(missing.status).toBe(404);
    expect(other.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(other.body.error.message).toBe('Workflow wf-1 was not found');
  });

  it("answers Temporal's 404 when the list permission allows every workflow", async () => {
    const backend = await start({ list: ALLOW, entityAny: DENY });
    expect((await backend.get({ exists: true })).status).toBe(200);
    const missing = await backend.get({ exists: false });
    expect(missing.status).toBe(404);
    expect(missing.describes).toBe(1);
  });
});
