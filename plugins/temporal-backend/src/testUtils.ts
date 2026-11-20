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

import { AsyncLocalStorage } from 'node:async_hooks';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import { Entity } from '@backstage/catalog-model';
import { TemporalService, temporalServiceRef } from './node';

export const ordersEntity: Entity = {
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

export const otherEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'billing',
    namespace: 'default',
    annotations: { 'temporal.io/task-queue': 'billing' },
  },
  spec: { type: 'service', owner: 'group:default/team-b' },
};

/** A custom kind, to check that nothing depends on Component. */
export const customKindEntity: Entity = {
  apiVersion: 'example.com/v1alpha1',
  kind: 'Workflow',
  metadata: {
    name: 'nightly',
    namespace: 'default',
    annotations: { 'temporal.io/workflow-type': 'nightly' },
  },
  spec: {},
};

/** A TemporalWorkflow entity: its runs come from the spec. */
export const orderWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
  },
};

export const paymentWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'payment-workflow', namespace: 'default' },
  spec: { owner: 'group:default/team-a', workflowType: 'paymentWorkflow' },
};

/** A TemporalWorkflow entity in a namespace other than the component's. */
export const otherNamespaceWorkflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'audit-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'auditWorkflow',
    namespace: 'audit',
  },
};

/**
 * A component with its own annotation that also depends on TemporalWorkflow
 * entities (relations as the catalog would add them for spec.dependsOn).
 */
export const checkoutEntity: Entity = {
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
    dependsOn: [
      'temporalworkflow:default/order-workflow',
      'temporalworkflow:default/payment-workflow',
      'temporalworkflow:default/audit-workflow',
      'temporalworkflow:default/missing',
    ],
  },
  relations: [
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/order-workflow' },
    {
      type: 'dependsOn',
      targetRef: 'temporalworkflow:default/payment-workflow',
    },
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/audit-workflow' },
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/missing' },
    { type: 'dependsOn', targetRef: 'resource:default/orders-db' },
  ],
};

/**
 * A component that depends on `count` TemporalWorkflow entities, plus those
 * entities. Used to test the related-workflow cap.
 */
export function entityWithRelatedWorkflows(count: number): {
  entity: Entity;
  workflows: Entity[];
} {
  const workflows = Array.from({ length: count }, (_, i) => {
    const name = `related-workflow-${i}`;
    return {
      apiVersion: 'temporal.io/v1alpha1',
      kind: 'TemporalWorkflow',
      metadata: { name, namespace: 'default' },
      spec: {
        owner: 'group:default/team-a',
        workflowType: `relatedType${i}`,
      },
    } satisfies Entity;
  });
  const refs = workflows.map(
    workflow => `temporalworkflow:default/${workflow.metadata.name}`,
  );
  const entity: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: 'many-workflows',
      namespace: 'default',
      annotations: { 'temporal.io/workflow-type': 'ownWorkflow' },
    },
    spec: {
      type: 'service',
      owner: 'group:default/team-a',
      dependsOn: refs,
    },
    relations: refs.map(targetRef => ({ type: 'dependsOn', targetRef })),
  };
  return { entity, workflows };
}

export const badEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'bad',
    namespace: 'default',
    annotations: { 'temporal.io/task-queue': "orders' OR TaskQueue != '" },
  },
  spec: { type: 'service', owner: 'group:default/team-a' },
};

const b64 = (s: string) => Buffer.from(s).toString('base64');

export function executionInfo(overrides: {
  workflowId: string;
  runId?: string;
  firstRunId?: string;
  type?: string;
  taskQueue?: string;
  status?: string;
}) {
  const runId = overrides.runId ?? `${overrides.workflowId}-run`;
  return {
    execution: {
      workflowId: overrides.workflowId,
      runId,
    },
    firstRunId: overrides.firstRunId ?? runId,
    type: { name: overrides.type ?? 'orderWorkflow' },
    taskQueue: overrides.taskQueue ?? 'orders',
    status: overrides.status ?? 'WORKFLOW_EXECUTION_STATUS_COMPLETED',
    startTime: { seconds: '1700000000', nanos: 0 },
    historyLength: '5',
  };
}

/** A fake Temporal workflow service with jest mocks. */
export function createFakeWorkflowService() {
  return {
    listWorkflowExecutions: jest.fn(async () => ({
      executions: [executionInfo({ workflowId: 'wf-1' })],
      nextPageToken: new Uint8Array([7, 7]),
    })),
    countWorkflowExecutions: jest.fn(async (_req: any) => ({ count: 1 })),
    describeWorkflowExecution: jest.fn(async (req: any) => ({
      workflowExecutionInfo: executionInfo({
        workflowId: req.execution.workflowId,
        status: 'WORKFLOW_EXECUTION_STATUS_FAILED',
      }),
      pendingActivities: [],
    })),
    getWorkflowExecutionHistoryReverse: jest.fn(async () => ({
      history: {
        events: [
          {
            eventId: '5',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED',
            workflowExecutionFailedEventAttributes: {
              failure: {
                message: 'outer',
                applicationFailureInfo: { type: 'Outer' },
                cause: { message: 'inner', applicationFailureInfo: {} },
              },
            },
          },
        ],
      },
    })),
    getWorkflowExecutionHistory: jest.fn(async () => ({
      history: {
        events: [
          {
            eventId: '1',
            eventType: 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED',
            workflowExecutionStartedEventAttributes: {
              input: {
                payloads: [
                  {
                    metadata: { encoding: b64('json/plain') },
                    data: b64('42'),
                  },
                ],
              },
            },
          },
        ],
      },
      nextPageToken: new Uint8Array(),
    })),
  };
}

export type FakeWorkflowService = ReturnType<typeof createFakeWorkflowService>;

/**
 * A fake connection to Temporal over `workflowService`. Like the client's,
 * `withDeadline` sets the deadline of the calls made inside it (in an async
 * context, so that it reaches the pages a list reads later); `calls` keeps
 * each call to the service with its timeout, in milliseconds rounded to the
 * second (`undefined` for a call without a deadline), and `deadlines` the
 * timeout of each `withDeadline`. A call that times out is a service method
 * that rejects with {@link deadlineExceeded}.
 */
export function createFakeConnection(workflowService: object) {
  const deadline = new AsyncLocalStorage<number>();
  const calls: { method: string; timeoutMs?: number }[] = [];
  /** The timeout of each `withDeadline`. */
  const deadlines: number[] = [];
  const service = new Proxy(workflowService, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value;
      }
      return (...args: unknown[]) => {
        calls.push({ method: property, timeoutMs: deadline.getStore() });
        return value.apply(target, args);
      };
    },
  });
  return {
    workflowService: service,
    withDeadline: async <T>(at: number | Date, fn: () => Promise<T>) => {
      const timeoutMs = Math.round((Number(at) - Date.now()) / 1000) * 1000;
      deadlines.push(timeoutMs);
      return await deadline.run(timeoutMs, fn);
    },
    calls,
    deadlines,
    /** The timeouts of the calls to `method`. */
    timeoutsOf: (method: string) =>
      calls.filter(c => c.method === method).map(c => c.timeoutMs),
  };
}

export type FakeConnection = ReturnType<typeof createFakeConnection>;

/** The gRPC error of a call whose deadline passed. */
export function deadlineExceeded() {
  return Object.assign(new Error('4 DEADLINE_EXCEEDED: Deadline exceeded'), {
    code: 4,
  });
}

/** Service factory replacing the Temporal connection with a fake. */
export function fakeTemporalServiceFactory(
  workflowService: FakeWorkflowService,
  options?: {
    entityRefAttribute?: string;
    initiatorAttribute?: string;
    /** The connection; by default, a fake one over `workflowService`. */
    connection?: FakeConnection;
    /** An error of opening the connection. */
    connectionError?: unknown;
  },
) {
  const connection =
    options?.connection ?? createFakeConnection(workflowService);
  const service: TemporalService = {
    getClient: async () => {
      throw new Error('not used');
    },
    getConnection: async () => {
      if (options?.connectionError) throw options.connectionError;
      return connection as any;
    },
    getDefaultNamespace: () => 'default',
    getAllowedNamespaces: () => ['default'],
    isNamespaceAllowed: ns => ns === 'default',
    getSearchAttributeNames: () => ({
      entityRef: options?.entityRefAttribute,
      initiator: options?.initiatorAttribute,
    }),
    getWebUiUrl: ref =>
      `http://temporal-ui/namespaces/${ref.namespace}/workflows/${ref.workflowId}/${ref.runId}/history`,
  };
  return createServiceFactory({
    service: temporalServiceRef,
    deps: {},
    factory: () => service,
  });
}

/** A schedule as the SDK lists it. */
export function scheduleSummary(
  scheduleId: string,
  workflowType: string,
  paused = false,
) {
  return {
    scheduleId,
    action: { type: 'startWorkflow', workflowType },
    spec: {
      intervals: [{ every: 3600_000, offset: 0 }],
      calendars: [
        {
          second: [{ start: 0, end: 0, step: 1 }],
          minute: [{ start: 0, end: 0, step: 1 }],
          hour: [{ start: 2, end: 2, step: 1 }],
          dayOfMonth: [{ start: 1, end: 31, step: 1 }],
          month: [{ start: 'JANUARY', end: 'DECEMBER', step: 1 }],
          year: [],
          dayOfWeek: [{ start: 'MONDAY', end: 'FRIDAY', step: 1 }],
        },
      ],
      timezone: 'Asia/Taipei',
    },
    state: { paused, note: paused ? 'maintenance' : undefined },
    info: {
      recentActions: [1, 2].map(n => ({
        scheduledAt: new Date(`2026-01-0${n}T02:00:00Z`),
        takenAt: new Date(`2026-01-0${n}T02:00:01Z`),
        action: {
          type: 'startWorkflow',
          workflow: {
            workflowId: `${scheduleId}-${n}`,
            firstExecutionRunId: `run-${n}`,
          },
        },
      })),
      nextActionTimes: [new Date('2026-01-03T02:00:00Z')],
    },
  };
}
