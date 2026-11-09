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

import type { WorkflowListResponse } from '@kwkevinchan/backstage-plugin-temporal';

/** Runs of the entity, for the run picker of the Definition tab. */
export const listResponse: WorkflowListResponse = {
  namespace: 'default',
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

/**
 * Mock of what the Definition tab reads: the runs and graphs of the Temporal
 * plugin and the definition file.
 */
export const mockGetEntityDefinition = jest.fn();

export function mockTemporalApi() {
  mockGetEntityDefinition
    .mockReset()
    .mockRejectedValue(new Error('No definition'));
  return {
    listEntityWorkflows: jest.fn().mockResolvedValue(listResponse),
    getWorkflowGraph: jest.fn(),
    /** Stands for the definition route; see the jest.mock of ./api. */
    getEntityDefinition: mockGetEntityDefinition,
  };
}
