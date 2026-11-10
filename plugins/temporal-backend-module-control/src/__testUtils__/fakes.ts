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

// Test data and a fake Temporal workflow service, copied from the backend
// plugin's tests (they are not published).

import { Entity } from '@backstage/catalog-model';

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
