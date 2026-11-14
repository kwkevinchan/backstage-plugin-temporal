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
import { Entity } from '@backstage/catalog-model';
import { msToTs } from '@temporalio/common/lib/time';
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
  type?: string;
  taskQueue?: string;
  status?: string;
}) {
  return {
    execution: {
      workflowId: overrides.workflowId,
      runId: `${overrides.workflowId}-run`,
    },
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

/** Service factory replacing the Temporal connection with a fake. */
export function fakeTemporalServiceFactory(
  workflowService: FakeWorkflowService,
  options?: {
    entityRefAttribute?: string;
    initiatorAttribute?: string;
  },
) {
  const service: TemporalService = {
    getClient: async () => {
      throw new Error('not used');
    },
    getConnection: async () =>
      ({
        workflowService,
        withDeadline: (_deadline: number, fn: () => unknown) => fn(),
      } as any),
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

/** A schedule of {@link fakeScheduleService}. */
export interface FakeSchedule {
  scheduleId: string;
  workflowType: string;
  taskQueue?: string;
  paused?: boolean;
  /**
   * Its memo and action arguments are encoded by a payload codec that the
   * plugin does not know (`binary/encrypted`).
   */
  undecodable?: boolean;
}

/** A gRPC error, as the client's connection throws it. */
export function grpcError(code: number, details = `code ${code}`) {
  return Object.assign(new Error(`${code} ${details}`), {
    code,
    details,
    metadata: { get: () => [] },
  });
}

const timestamp = (iso: string) => msToTs(Date.parse(iso));

const encryptedPayload = {
  metadata: { encoding: Buffer.from('binary/encrypted') },
  data: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
};

const rawSpec = {
  interval: [{ interval: msToTs(3600_000), phase: msToTs(0) }],
  structuredCalendar: [
    {
      second: [{ start: 0, end: 0, step: 1 }],
      minute: [{ start: 0, end: 0, step: 1 }],
      hour: [{ start: 2, end: 2, step: 1 }],
      dayOfMonth: [{ start: 1, end: 31, step: 1 }],
      month: [{ start: 1, end: 12, step: 1 }],
      year: [],
      dayOfWeek: [{ start: 1, end: 5, step: 1 }],
    },
  ],
  timezoneName: 'Asia/Taipei',
};

const rawRecentActions = (scheduleId: string) =>
  [1, 2].map(n => ({
    scheduleTime: timestamp(`2026-01-0${n}T02:00:00Z`),
    actualTime: timestamp(`2026-01-0${n}T02:00:01Z`),
    startWorkflowResult: {
      workflowId: `${scheduleId}-${n}`,
      runId: `run-${n}`,
    },
  }));

/**
 * The schedule calls of Temporal's workflow service (`listSchedules`,
 * `describeSchedule`, `patchSchedule`) over some schedules, as the gRPC
 * client answers them. Spread into the fake workflow service. A schedule
 * that is not there is a NOT_FOUND error.
 */
export function fakeScheduleService(schedules: FakeSchedule[]) {
  return {
    listSchedules: jest.fn(async (_req: any) => ({
      schedules: schedules.map(s => ({
        scheduleId: s.scheduleId,
        memo: s.undecodable ? { fields: { owner: encryptedPayload } } : {},
        info: {
          spec: rawSpec,
          workflowType: { name: s.workflowType },
          paused: s.paused ?? false,
          notes: s.paused ? 'maintenance' : '',
          recentActions: rawRecentActions(s.scheduleId),
          futureActionTimes: [timestamp('2026-01-03T02:00:00Z')],
        },
      })),
      nextPageToken: new Uint8Array(),
    })),
    describeSchedule: jest.fn(async (req: any) => {
      const s = schedules.find(f => f.scheduleId === req.scheduleId);
      if (!s) throw grpcError(5, 'schedule not found');
      return {
        memo: s.undecodable ? { fields: { owner: encryptedPayload } } : {},
        schedule: {
          spec: rawSpec,
          action: {
            startWorkflow: {
              workflowId: `${s.scheduleId}-workflow`,
              workflowType: { name: s.workflowType },
              taskQueue: { name: s.taskQueue ?? 'orders' },
              input: s.undecodable ? { payloads: [encryptedPayload] } : {},
              memo: s.undecodable
                ? { fields: { owner: encryptedPayload } }
                : {},
            },
          },
          policies: { overlapPolicy: 1 },
          state: { paused: s.paused ?? false },
        },
        info: {
          createTime: timestamp('2026-01-01T00:00:00Z'),
          recentActions: rawRecentActions(s.scheduleId),
          futureActionTimes: [timestamp('2026-01-03T02:00:00Z')],
        },
      };
    }),
    patchSchedule: jest.fn(async (req: any) => {
      if (!schedules.some(f => f.scheduleId === req.scheduleId)) {
        throw grpcError(5, 'schedule not found');
      }
      return {};
    }),
  };
}
