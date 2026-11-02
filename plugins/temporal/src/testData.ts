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

import { Entity } from '@backstage/catalog-model';
import type {
  WorkflowDetail,
  WorkflowGraphResponse,
  WorkflowProgressResponse,
  WorkflowStatsResponse,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowStepsResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';
import type { TemporalApi } from '@kwkevinchan/backstage-plugin-temporal-react';

export const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'orders',
    namespace: 'default',
    annotations: { 'temporal.io/task-queue': 'orders' },
  },
  spec: { type: 'service', owner: 'guests' },
};

/** A TemporalWorkflow entity, as the catalog returns it. */
export const workflowEntity: Entity = {
  apiVersion: 'temporal.io/v1alpha1',
  kind: 'TemporalWorkflow',
  metadata: { name: 'order-workflow', namespace: 'default' },
  spec: {
    owner: 'group:default/team-a',
    workflowType: 'orderWorkflow',
    taskQueue: 'orders',
    system: 'shop',
    lifecycle: 'production',
  },
  relations: [
    { type: 'ownedBy', targetRef: 'group:default/team-a' },
    { type: 'partOf', targetRef: 'system:default/shop' },
    { type: 'dependencyOf', targetRef: 'component:default/checkout' },
  ],
};

/** A component with an annotation that depends on a TemporalWorkflow entity. */
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
    dependsOn: ['temporalworkflow:default/order-workflow'],
  },
  relations: [
    { type: 'dependsOn', targetRef: 'temporalworkflow:default/order-workflow' },
  ],
};

export const statsResponse: WorkflowStatsResponse = {
  namespace: 'default',
  sampleSize: 7,
  limit: 50,
  byStatus: { Completed: 4, Failed: 2, Running: 1 },
  succeeded: 4,
  failed: 2,
  running: 1,
  averageDurationMs: 2500,
};

export const listResponse: WorkflowListResponse = {
  namespace: 'default',
  nextPageToken: 'next',
  items: [
    {
      namespace: 'default',
      workflowId: 'order-1',
      runId: 'run-1',
      workflowType: 'orderWorkflow',
      status: 'Completed',
      startTime: '2026-01-01T10:00:00.000Z',
      closeTime: '2026-01-01T10:00:05.000Z',
    },
    {
      namespace: 'default',
      workflowId: 'payment-1',
      runId: 'run-2',
      workflowType: 'paymentWorkflow',
      status: 'Failed',
      startTime: '2026-01-01T11:00:00.000Z',
      closeTime: '2026-01-01T11:00:01.000Z',
    },
  ],
};

export const failedWorkflow: WorkflowDetail = {
  ...listResponse.items[1],
  taskQueue: 'orders',
  webUiUrl:
    'http://temporal-ui/namespaces/default/workflows/payment-1/run-2/history',
  failure: {
    message: 'Payment could not be completed',
    kind: 'ApplicationFailure',
    type: 'PaymentFailed',
    cause: {
      message: 'Activity task failed',
      kind: 'ActivityFailure',
      cause: { message: 'Card declined', kind: 'ApplicationFailure' },
    },
  },
  pendingActivities: [
    {
      activityId: '3',
      activityType: 'waitForUpstream',
      state: 'Scheduled',
      attempt: 4,
      lastFailure: { message: 'Upstream not ready' },
    },
  ],
};

export const historyResponse: WorkflowHistoryResponse = {
  events: [
    {
      eventId: '1',
      eventTime: '2026-01-01T11:00:00.000Z',
      eventType: 'WorkflowExecutionStarted',
      attributes: {
        input: { payloads: [{ encoding: 'json/plain', value: 1 }] },
      },
    },
  ],
};

export const stepsResponse: WorkflowStepsResponse = {
  input: { encoding: 'json/plain', value: { paymentId: 'pay-1', amount: 42 } },
  truncated: false,
  activities: [
    {
      activityId: '1',
      activityType: 'reserveStock',
      scheduledEventId: '5',
      status: 'Completed',
      input: { encoding: 'json/plain', value: { sku: 'BOOK-1' } },
      result: { encoding: 'json/plain', value: { reserved: true } },
    },
    {
      activityId: '2',
      activityType: 'chargeCard',
      scheduledEventId: '11',
      status: 'Failed',
      input: { encoding: 'binary/encrypted', size: 64, undecodable: true },
      failure: { message: 'Card declined', kind: 'ApplicationFailure' },
    },
  ],
};

export const graphResponse: WorkflowGraphResponse = {
  status: 'Failed',
  current: 'Failed at chargeCard',
  completedSteps: 1,
  totalSteps: 2,
  truncated: false,
  payloadsHidden: false,
  nodes: [
    {
      id: 'start',
      kind: 'workflowStarted',
      name: 'Start',
      status: 'Completed',
      startTime: '2026-01-01T11:00:00.000Z',
      endTime: '2026-01-01T11:00:00.000Z',
      input: {
        encoding: 'json/plain',
        value: { paymentId: 'pay-1', amount: 42 },
      },
      events: [{ eventId: '1', eventType: 'WorkflowExecutionStarted' }],
    },
    {
      id: 'workflowTask-2',
      kind: 'workflowTask',
      name: 'Workflow task',
      status: 'Completed',
      internal: true,
      events: [
        { eventId: '2', eventType: 'WorkflowTaskScheduled' },
        { eventId: '3', eventType: 'WorkflowTaskStarted' },
        { eventId: '4', eventType: 'WorkflowTaskCompleted' },
      ],
    },
    {
      id: 'activity-5',
      kind: 'activity',
      name: 'reserveStock',
      stepId: '1',
      status: 'Completed',
      attempt: 1,
      startTime: '2026-01-01T11:00:00.100Z',
      endTime: '2026-01-01T11:00:00.300Z',
      input: { encoding: 'json/plain', value: { sku: 'BOOK-1' } },
      result: { encoding: 'json/plain', value: { reserved: true } },
      events: [
        { eventId: '5', eventType: 'ActivityTaskScheduled' },
        { eventId: '6', eventType: 'ActivityTaskStarted' },
        { eventId: '7', eventType: 'ActivityTaskCompleted' },
      ],
    },
    {
      id: 'activity-11',
      kind: 'activity',
      name: 'chargeCard',
      stepId: '2',
      status: 'Failed',
      attempt: 2,
      maximumAttempts: 2,
      startTime: '2026-01-01T11:00:00.400Z',
      endTime: '2026-01-01T11:00:00.900Z',
      input: { encoding: 'binary/encrypted', size: 64, undecodable: true },
      failure: { message: 'Card declined', kind: 'ApplicationFailure' },
      attempts: [
        { attempt: 1, status: 'Failed', failure: { message: 'Bank timeout' } },
        {
          attempt: 2,
          status: 'Failed',
          failure: { message: 'Card declined', kind: 'ApplicationFailure' },
        },
      ],
      events: [
        { eventId: '11', eventType: 'ActivityTaskScheduled' },
        { eventId: '12', eventType: 'ActivityTaskStarted' },
        { eventId: '13', eventType: 'ActivityTaskFailed' },
      ],
    },
    {
      id: 'end',
      kind: 'workflowClosed',
      name: 'End',
      status: 'Failed',
      failure: { message: 'Payment could not be completed' },
      events: [{ eventId: '17', eventType: 'WorkflowExecutionFailed' }],
    },
  ],
  edges: [
    { id: 'start->activity-5', source: 'start', target: 'activity-5' },
    {
      id: 'activity-5->activity-11',
      source: 'activity-5',
      target: 'activity-11',
    },
    { id: 'activity-11->end', source: 'activity-11', target: 'end' },
  ],
};

export const progressResponse: WorkflowProgressResponse = {
  status: 'Failed',
  completedSteps: 1,
  totalSteps: 2,
  current: 'Failed at chargeCard',
  truncated: false,
};

export function mockTemporalApi(): jest.Mocked<TemporalApi> {
  return {
    listEntityWorkflows: jest.fn().mockResolvedValue(listResponse),
    listWorkflows: jest.fn().mockResolvedValue(listResponse),
    getEntityWorkflowStats: jest.fn().mockResolvedValue(statsResponse),
    getWorkflow: jest.fn().mockResolvedValue(failedWorkflow),
    getWorkflowHistory: jest.fn().mockResolvedValue(historyResponse),
    getWorkflowSteps: jest.fn().mockResolvedValue(stepsResponse),
    getWorkflowGraph: jest.fn().mockResolvedValue(graphResponse),
    getWorkflowProgress: jest.fn().mockResolvedValue(progressResponse),
    signalWorkflow: jest.fn().mockResolvedValue(undefined),
    updateWorkflow: jest.fn().mockResolvedValue({ result: 'ok' }),
    queryWorkflow: jest.fn().mockResolvedValue({ result: { notes: [] } }),
    cancelWorkflow: jest.fn().mockResolvedValue(undefined),
    terminateWorkflow: jest.fn().mockResolvedValue(undefined),
    rerunWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'order-1-rerun-abc',
      runId: 'run-new',
    }),
    startWorkflow: jest.fn().mockResolvedValue({
      namespace: 'default',
      workflowId: 'started-1',
      runId: 'run-started',
    }),
    runWorkflowAction: jest.fn().mockResolvedValue({ result: { ok: true } }),
  };
}
