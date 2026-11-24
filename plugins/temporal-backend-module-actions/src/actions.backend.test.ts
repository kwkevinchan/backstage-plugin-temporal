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

import { createServiceFactory } from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { temporalPlugin } from '@kwkevinchan/backstage-plugin-temporal-backend';
import { temporalAccessServiceFactory } from '@kwkevinchan/backstage-plugin-temporal-backend/alpha';
import {
  TemporalService,
  temporalServiceRef,
} from '@kwkevinchan/backstage-plugin-temporal-backend/node';
import { temporalActionsModule } from './module';

type DenyRule = string | { permission: string; resourceRef: string };

const user = mockCredentials.user('user:default/alice');

const ordersEntity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'orders',
    namespace: 'default',
    annotations: {
      'temporal.io/task-queue': 'orders',
      'temporal.io/workflow-type': 'orderWorkflow',
    },
  },
  spec: { type: 'service', owner: 'group:default/team-a' },
};

const orderWorkflowEntity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
  },
};

const checkoutEntity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'checkout',
    namespace: 'default',
    annotations: { 'temporal.io/workflow-type': 'deploymentWorkflow' },
  },
  spec: {
    type: 'service',
    owner: 'group:default/team-a',
    dependsOn: ['temporalworkflow:default/order-workflow'],
  },
  relations: [
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/order-workflow' },
  ],
};

const closeEvent = {
  eventId: '2',
  eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED',
  workflowExecutionFailedEventAttributes: {
    failure: {
      message: 'Payment failed',
      source: 'TypeScriptSDK',
      stackTrace: 'Error: Payment failed\n    at charge.ts:42',
      applicationFailureInfo: {
        type: 'PaymentError',
        nonRetryable: true,
      },
      cause: {
        message: 'Card declined: 4111-secret',
        stackTrace: 'Error: cause\n    at charge.ts:10',
        applicationFailureInfo: { type: 'CardError' },
      },
    },
  },
};

const failedHistory = [
  {
    eventId: '1',
    eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
    workflowExecutionStartedEventAttributes: {},
  },
  closeEvent,
];

function isDenied(
  request: { permission: { name: string }; resourceRef?: string },
  deny: DenyRule[],
  includeResourceRef: boolean,
): boolean {
  return deny.some(rule =>
    typeof rule === 'string'
      ? rule === request.permission.name
      : includeResourceRef &&
        rule.permission === request.permission.name &&
        rule.resourceRef === request.resourceRef,
  );
}

describe('temporalActionsModule against the Temporal backend', () => {
  const backends: Array<{ stop(): Promise<void> }> = [];
  afterAll(async () => {
    await Promise.all(backends.map(b => b.stop()));
  });

  async function setup(options: { deny?: DenyRule[] } = {}) {
    const deny = options.deny ?? [];
    const workflowService = {
      describeWorkflowExecution: jest.fn(async (req: any) => ({
        workflowExecutionInfo: {
          execution: {
            workflowId: req.execution.workflowId,
            runId: req.execution.runId ?? 'run-1',
          },
          type: { name: 'orderWorkflow' },
          taskQueue: 'orders',
          status: 'WORKFLOW_EXECUTION_STATUS_FAILED',
          startTime: { seconds: '1700000000', nanos: 0 },
          historyLength: '2',
        },
        pendingActivities: [],
      })),
      getWorkflowExecutionHistoryReverse: jest.fn(async () => ({
        history: { events: [structuredClone(closeEvent)] },
      })),
      getWorkflowExecutionHistory: jest.fn(async (req: any) => {
        const filter = req?.historyEventFilterType;
        const onlyClose =
          filter === 2 ||
          filter === 'HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT' ||
          filter === 'CLOSE_EVENT';
        return {
          history: {
            events: structuredClone(onlyClose ? [closeEvent] : failedHistory),
          },
          nextPageToken: new Uint8Array(),
        };
      }),
      signalWorkflowExecution: jest.fn(async () => ({})),
      listWorkflowExecutions: jest.fn(async () => ({
        executions: [],
        nextPageToken: new Uint8Array(),
      })),
      countWorkflowExecutions: jest.fn(async () => ({ count: '0' })),
    };

    const temporal: TemporalService = {
      getClient: async () => {
        throw new Error('not used');
      },
      getConnection: async () =>
        ({
          workflowService,
          withDeadline: async (
            _at: number | Date,
            fn: () => Promise<unknown>,
          ) => fn(),
        } as any),
      getDefaultNamespace: () => 'default',
      getAllowedNamespaces: () => ['default'],
      isNamespaceAllowed: ns => ns === 'default',
      getSearchAttributeNames: () => ({}),
      getWebUiUrl: () => undefined,
    };

    const registry = actionsRegistryServiceMock();
    const permissions = mockServices.permissions.mock({
      authorize: jest.fn(async requests =>
        requests.map((r: any) => ({
          result: isDenied(r, deny, true) ? ('DENY' as any) : ('ALLOW' as any),
        })),
      ) as any,
      authorizeConditional: jest.fn(async requests =>
        requests.map((r: any) => ({
          result: isDenied(r, deny, false) ? ('DENY' as any) : ('ALLOW' as any),
        })),
      ) as any,
    });
    const auditor = mockServices.auditor.mock();
    const auditEvent = { success: jest.fn(), fail: jest.fn() };
    auditor.createEvent.mockResolvedValue(auditEvent);

    const backend = await startTestBackend({
      features: [
        temporalPlugin,
        temporalAccessServiceFactory,
        temporalActionsModule,
        createServiceFactory({
          service: actionsRegistryServiceRef,
          deps: {},
          factory: () => registry,
        }),
        catalogServiceMock.factory({
          entities: [ordersEntity, orderWorkflowEntity, checkoutEntity],
        }),
        createServiceFactory({
          service: temporalServiceRef,
          deps: {},
          factory: () => temporal,
        }),
        permissions.factory,
        auditor.factory,
        mockServices.rootConfig.factory({
          data: {
            app: { baseUrl: 'http://backstage' },
            temporal: {},
          },
        }),
      ],
    });
    backends.push(backend);

    const invoke = (name: string, input: object) =>
      registry.invoke({ id: `test:${name}`, input, credentials: user });

    return { invoke, workflowService, auditor, auditEvent };
  }

  it('omits failure causes and stack trace from get-workflow when the user only has read permission', async () => {
    const readOnly = await setup({
      deny: [
        'temporal.workflow.history.read',
        'temporal.workflow.history.list',
      ],
    });
    const { output } = await readOnly.invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
      namespace: 'default',
      entityRef: 'component:default/orders',
    });

    expect(
      readOnly.workflowService.describeWorkflowExecution,
    ).toHaveBeenCalled();
    expect((output as any).failure).toEqual({
      message: 'Payment failed',
      kind: 'ApplicationFailure',
      type: 'PaymentError',
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('Card declined');
    expect(serialized).not.toContain('4111-secret');
    expect(serialized).not.toContain('CardError');
    expect(serialized).not.toContain('charge.ts:42');
    expect(serialized).not.toContain('charge.ts:10');

    const withHistory = await setup();
    const { output: fullOutput } = await withHistory.invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
      namespace: 'default',
      entityRef: 'component:default/orders',
    });
    expect((fullOutput as any).failure).toEqual({
      message: 'Payment failed',
      kind: 'ApplicationFailure',
      type: 'PaymentError',
      causes: ['Card declined: 4111-secret'],
    });
    expect(JSON.stringify(fullOutput)).not.toContain('charge.ts:42');
    expect(JSON.stringify(fullOutput)).not.toContain('charge.ts:10');
  });

  it('enforces permissions on the matched dependsOn TemporalWorkflow entity for get-workflow and signal-workflow', async () => {
    const { invoke, workflowService } = await setup({
      deny: [
        {
          permission: 'temporal.workflow.history.read',
          resourceRef: 'temporalworkflow:default/order-workflow',
        },
        {
          permission: 'temporal.workflow.signal',
          resourceRef: 'temporalworkflow:default/order-workflow',
        },
      ],
    });

    const { output } = await invoke('get-workflow', {
      workflowId: 'order-1',
      runId: 'run-1',
      namespace: 'default',
      entityRef: 'component:default/checkout',
    });
    expect((output as any).failure).toEqual({
      message: 'Payment failed',
      kind: 'ApplicationFailure',
      type: 'PaymentError',
    });
    expect(JSON.stringify(output)).not.toContain('Card declined');

    await expect(
      invoke('signal-workflow', {
        workflowId: 'order-1',
        runId: 'run-1',
        namespace: 'default',
        entityRef: 'component:default/checkout',
        name: 'approve',
      }),
    ).rejects.toThrow(/Do not retry/);
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });

  it('records an audit failure with target metadata when a write action is refused', async () => {
    const { invoke, workflowService, auditor, auditEvent } = await setup({
      deny: ['temporal.workflow.signal'],
    });

    await expect(
      invoke('signal-workflow', {
        workflowId: 'order-1',
        runId: 'run-1',
        namespace: 'default',
        entityRef: 'component:default/orders',
        name: 'approve',
      }),
    ).rejects.toMatchObject({ name: 'NotAllowedError' });

    expect(auditor.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'workflow-signal',
        meta: expect.objectContaining({
          namespace: 'default',
          workflowId: 'order-1',
          runId: 'run-1',
          entityRef: 'component:default/orders',
          name: 'approve',
        }),
      }),
    );
    expect(auditEvent.fail).toHaveBeenCalled();
    expect(workflowService.signalWorkflowExecution).not.toHaveBeenCalled();
  });
});
