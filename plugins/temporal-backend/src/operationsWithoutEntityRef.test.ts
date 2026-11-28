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
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import request from 'supertest';
import { temporalWorkflowUpdatePermission } from './common';
import { TemporalService, temporalServiceRef } from './node';
import { temporalControlExtensionPoint } from './node/alpha';
import { temporalAccessServiceFactory } from './alpha';
import { temporalPlugin } from './plugin';
import {
  checkoutEntity,
  createFakeConnection,
  createFakeWorkflowService,
  executionInfo,
  orderWorkflowEntity,
  ordersEntity,
  otherEntity,
} from './testUtils';
import { withOpenApiValidation } from './__testUtils__/openapi';

// Operations on a workflow opened without `?entityRef=`. The entity
// reference search attribute is written by whoever starts the workflow, so
// it decides which entity the operation is checked on only when the
// workflow opens with that entity as `?entityRef=` would.

const json = (value: unknown) => ({
  metadata: { encoding: Buffer.from('json/plain') },
  data: Buffer.from(JSON.stringify(value)),
});

const b64 = (s: string) => Buffer.from(s).toString('base64');

const ALLOW: PolicyDecision = { result: AuthorizeResult.ALLOW };
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
const ownerConditional: PolicyDecision = {
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'catalog',
  resourceType: 'catalog-entity',
  conditions: {
    rule: 'IS_ENTITY_OWNER',
    resourceType: 'catalog-entity',
    params: { claims: [] },
  },
};

const ordersRef = 'component:default/orders';
const checkoutRef = 'component:default/checkout';
const orderWfRef = 'temporalworkflow:default/order-workflow';

interface Setup {
  /** Decision of `temporal.workflow.list`. */
  list: PolicyDecision;
  /**
   * True: every entity permission is allowed without conditions. False: they
   * are conditional, and allowed on each entity unless `deny` names it.
   */
  unconditional: boolean;
  /** Permissions denied on an entity. */
  deny?: { permission: string; resourceRef: string }[];
  /** The namespace of the workflow. */
  namespace?: string;
  /** The entity reference search attribute of the workflow; none if unset. */
  linked?: string;
}

const escalate = jest.fn(
  async (_ref: unknown, _body: unknown, context: any) => ({
    entity: context.entity?.metadata.name ?? null,
  }),
);

async function start(setup: Setup) {
  const base = createFakeWorkflowService();
  const workflowService = {
    ...base,
    describeWorkflowExecution: jest.fn(async (req: any) => ({
      workflowExecutionInfo: {
        ...executionInfo({
          workflowId: req.execution.workflowId,
          status: `WORKFLOW_EXECUTION_STATUS_${
            req.execution.workflowId === 'closed' ? 'COMPLETED' : 'RUNNING'
          }`,
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
            },
          },
        ],
      },
      nextPageToken: new Uint8Array(),
    })),
    signalWorkflowExecution: jest.fn(async (_req: any) => ({})),
    updateWorkflowExecution: jest.fn(async (_req: any) => ({
      outcome: { success: { payloads: [json('done')] } },
    })),
    pollWorkflowExecutionUpdate: jest.fn(async (_req: any) => ({})),
    queryWorkflow: jest.fn(async (_req: any) => ({
      queryResult: { payloads: [json('state')] },
    })),
    requestCancelWorkflowExecution: jest.fn(async (_req: any) => ({})),
    terminateWorkflowExecution: jest.fn(async (_req: any) => ({})),
    startWorkflowExecution: jest.fn(async (_req: any) => ({
      runId: 'new-run',
    })),
  };
  const isDenied = (r: any) =>
    setup.deny?.some(
      d =>
        d.permission === r.permission.name && d.resourceRef === r.resourceRef,
    );
  const permissions = mockServices.permissions.mock({
    authorize: jest.fn(async (requests: any[]) =>
      requests.map(r => ({
        result: isDenied(r) ? AuthorizeResult.DENY : AuthorizeResult.ALLOW,
      })),
    ) as any,
    authorizeConditional: jest.fn(async (requests: any[]) =>
      requests.map(r => {
        if (r.permission.name === 'temporal.workflow.list') return setup.list;
        return setup.unconditional ? ALLOW : ownerConditional;
      }),
    ) as any,
  });
  const auditor = mockServices.auditor.mock();
  const auditEvent = { success: jest.fn(), fail: jest.fn() };
  auditor.createEvent.mockResolvedValue(auditEvent);
  const connection = createFakeConnection(workflowService);
  const service: TemporalService = {
    getClient: async () => ({} as any),
    getConnection: async () => connection as any,
    getDefaultNamespace: () => 'default',
    getAllowedNamespaces: () => ['default', 'other'],
    isNamespaceAllowed: ns => ns === 'default' || ns === 'other',
    getSearchAttributeNames: () => ({ entityRef: 'BackstageEntityRef' }),
    getWebUiUrl: () => undefined,
  };
  const { server } = await startTestBackend({
    features: [
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
      createBackendModule({
        pluginId: 'temporal',
        moduleId: 'test-action',
        register(reg) {
          reg.registerInit({
            deps: { temporal: temporalControlExtensionPoint },
            async init({ temporal }) {
              temporal.addControlAction({
                id: 'escalate',
                permission: temporalWorkflowUpdatePermission,
                handle: escalate,
              });
            },
          });
        },
      }),
    ],
  });
  return {
    server: await withOpenApiValidation(server),
    workflowService,
    permissions,
    auditEvent,
  };
}

/** One operation: its permission, path suffix, body and the call it makes. */
interface Operation {
  name: string;
  permission: string;
  suffix: string;
  body: object;
  /** The workflow ID of the run: `closed` for a rerun. */
  workflowId: string;
  /** The Temporal call it makes, or `escalate` for the custom action. */
  call: string;
}

const operations: Operation[] = [
  {
    name: 'signal',
    permission: 'temporal.workflow.signal',
    suffix: 'signal',
    body: { name: 'addNote', args: ['hi'] },
    workflowId: 'wf-1',
    call: 'signalWorkflowExecution',
  },
  {
    name: 'update',
    permission: 'temporal.workflow.update',
    suffix: 'update',
    body: { name: 'setPriority', args: ['high'] },
    workflowId: 'wf-1',
    call: 'updateWorkflowExecution',
  },
  {
    name: 'cancel',
    permission: 'temporal.workflow.cancel',
    suffix: 'cancel',
    body: {},
    workflowId: 'wf-1',
    call: 'requestCancelWorkflowExecution',
  },
  {
    name: 'terminate',
    permission: 'temporal.workflow.terminate',
    suffix: 'terminate',
    body: { reason: 'stuck' },
    workflowId: 'wf-1',
    call: 'terminateWorkflowExecution',
  },
  {
    name: 'rerun',
    permission: 'temporal.workflow.rerun',
    suffix: 'rerun',
    body: {},
    workflowId: 'closed',
    call: 'startWorkflowExecution',
  },
  {
    name: 'query',
    permission: 'temporal.workflow.query',
    suffix: 'query',
    body: { name: 'state' },
    workflowId: 'wf-1',
    call: 'queryWorkflow',
  },
  {
    name: 'custom action',
    permission: temporalWorkflowUpdatePermission.name,
    suffix: 'actions/escalate',
    body: {},
    workflowId: 'wf-1',
    call: 'escalate',
  },
];

/** Sends the operation without `?entityRef=`; returns its status and call. */
async function operate(setup: Setup, op: Operation) {
  escalate.mockClear();
  const backend = await start(setup);
  const namespace = setup.namespace ?? 'default';
  const res = await request(backend.server)
    .post(
      `/api/temporal/namespaces/${namespace}/workflows/${op.workflowId}/runs/${op.workflowId}-run/${op.suffix}`,
    )
    .send(op.body);
  const called =
    op.call === 'escalate'
      ? escalate.mock.calls.length > 0
      : (backend.workflowService as any)[op.call].mock.calls.length > 0;
  /** The entities the operation's permission was checked on. */
  const checkedOn = backend.permissions.authorize.mock.calls
    .flatMap(([requests]) => requests as any[])
    .filter(r => r.permission.name === op.permission)
    .map(r => r.resourceRef);
  return { ...backend, status: res.status, body: res.body, called, checkedOn };
}

describe('operations without entityRef', () => {
  describe.each([
    ['allows every workflow', ALLOW],
    ['allows the workflows of the namespace', inNamespaces(['other'])],
  ])('when the list permission %s', (_name, list) => {
    it.each(operations.map(op => [op.name, op] as const))(
      'refuses %s on an entity of another namespace in the search attribute',
      async (_op, op) => {
        const res = await operate(
          { list, unconditional: false, namespace: 'other', linked: ordersRef },
          op,
        );
        expect(res.status).toBe(403);
        expect(res.called).toBe(false);
        expect(res.checkedOn).not.toContain(ordersRef);
      },
    );
  });

  it.each(operations.map(op => [op.name, op] as const))(
    'allows %s by the permission on the entity of the search attribute when the workflow is one of its workflows',
    async (_op, op) => {
      const res = await operate(
        { list: ALLOW, unconditional: false, linked: ordersRef },
        op,
      );
      expect(res.status).toBeLessThan(300);
      expect(res.called).toBe(true);
      expect(new Set(res.checkedOn)).toEqual(new Set([ordersRef]));
    },
  );

  it.each(operations.map(op => [op.name, op] as const))(
    'refuses %s when it is denied on the TemporalWorkflow entity that the entity of the search attribute matches through',
    async (_op, op) => {
      // Not in canonical form, so the workflow matches the component through
      // the TemporalWorkflow entity it depends on, not through the attribute.
      const linked = 'component:checkout';
      const denied = await operate(
        {
          list: ALLOW,
          unconditional: false,
          linked,
          deny: [{ permission: op.permission, resourceRef: orderWfRef }],
        },
        op,
      );
      expect(denied.status).toBe(403);
      expect(denied.called).toBe(false);
      const allowed = await operate(
        { list: ALLOW, unconditional: false, linked },
        op,
      );
      expect(allowed.status).toBeLessThan(300);
      expect(allowed.called).toBe(true);
      expect(allowed.checkedOn).toEqual(
        expect.arrayContaining([checkoutRef, orderWfRef]),
      );
    },
  );

  it.each(operations.map(op => [op.name, op] as const))(
    'allows %s on a workflow without an entity only on an unconditional ALLOW',
    async (_op, op) => {
      const allowed = await operate({ list: ALLOW, unconditional: true }, op);
      expect(allowed.status).toBeLessThan(300);
      expect(allowed.called).toBe(true);
      const refused = await operate({ list: ALLOW, unconditional: false }, op);
      expect(refused.status).toBe(403);
      expect(refused.called).toBe(false);
    },
  );

  const unverified: [string, Partial<Setup>][] = [
    ['does not exist', { linked: 'component:default/gone' }],
    [
      'is not matched by the workflow',
      // The billing component's task queue is not the workflow's.
      { linked: 'component:billing' },
    ],
    [
      'may not be read by the caller',
      {
        linked: ordersRef,
        deny: [
          { permission: 'temporal.workflow.read', resourceRef: ordersRef },
        ],
      },
    ],
  ];

  it.each(unverified)(
    'counts an entity of the search attribute that %s as no entity',
    async (_name, extra) => {
      const signal = operations[0];
      const refused = await operate(
        { list: ALLOW, unconditional: false, ...extra },
        signal,
      );
      expect(refused.status).toBe(403);
      expect(refused.called).toBe(false);
      const allowed = await operate(
        { list: ALLOW, unconditional: true, ...extra },
        signal,
      );
      expect(allowed.status).toBe(202);
      expect(allowed.called).toBe(true);
    },
  );

  it('neither records nor hands an action an entity of another namespace from the search attribute', async () => {
    const action = operations.find(op => op.name === 'custom action')!;
    const res = await operate(
      {
        list: ALLOW,
        unconditional: true,
        namespace: 'other',
        linked: ordersRef,
      },
      action,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { entity: null } });
    const [{ meta }] = res.auditEvent.success.mock.calls[0];
    expect(meta).toMatchObject({ namespace: 'other', actionId: 'escalate' });
    expect(meta).not.toHaveProperty('entityRef');
  });

  it('hands an action the entity of the search attribute when the workflow is one of its workflows', async () => {
    const action = operations.find(op => op.name === 'custom action')!;
    const res = await operate(
      { list: ALLOW, unconditional: false, linked: ordersRef },
      action,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: { entity: 'orders' } });
    const [{ meta }] = res.auditEvent.success.mock.calls[0];
    expect(meta).toMatchObject({ entityRef: ordersRef });
  });
});
