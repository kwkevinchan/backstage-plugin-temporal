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

export function mockTemporalApi(): jest.Mocked<TemporalApi> {
  return {
    listEntityWorkflows: jest.fn().mockResolvedValue(listResponse),
    getWorkflow: jest.fn().mockResolvedValue(failedWorkflow),
    getWorkflowHistory: jest.fn().mockResolvedValue(historyResponse),
    getWorkflowSteps: jest.fn().mockResolvedValue(stepsResponse),
  };
}
