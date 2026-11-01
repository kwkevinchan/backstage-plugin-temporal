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

import { createApiRef } from '@backstage/core-plugin-api';
import type {
  WorkflowDetail,
  WorkflowHistoryResponse,
  WorkflowListResponse,
  WorkflowRef,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowStepsResponse,
} from '@kwkevinchan/backstage-plugin-temporal-common';

/**
 * Client of the Temporal backend plugin.
 *
 * @public
 */
export interface TemporalApi {
  /** Lists the workflows of an entity, newest first. */
  listEntityWorkflows(
    entityRef: string,
    options?: {
      status?: WorkflowStatus;
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<WorkflowListResponse>;

  /**
   * Lists every workflow of a namespace (default namespace when omitted),
   * newest first. Needs the `temporal.workflow.list` permission.
   * `workflowIdPrefix` matches the start of the workflow ID.
   */
  listWorkflows(options?: {
    namespace?: string;
    status?: WorkflowStatus;
    workflowType?: string;
    workflowIdPrefix?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<WorkflowListResponse>;

  /**
   * Counts by status and mean duration of the entity's most recent runs
   * (`limit`, default 50, at most 100).
   */
  getEntityWorkflowStats(
    entityRef: string,
    options?: { limit?: number },
  ): Promise<WorkflowStatsResponse>;

  /**
   * Gets one workflow execution. `entityRef` is the entity it is shown for;
   * without it the backend uses the workflow's entity reference search
   * attribute.
   */
  getWorkflow(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowDetail>;

  /** Gets one page of the event history, oldest first. */
  getWorkflowHistory(
    ref: WorkflowRef,
    options?: { entityRef?: string; pageSize?: number; pageToken?: string },
  ): Promise<WorkflowHistoryResponse>;

  /**
   * Gets the inputs and outputs of a run: workflow input and result, and
   * each activity with its input, result or failure.
   */
  getWorkflowSteps(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowStepsResponse>;
}

/**
 * API reference of {@link TemporalApi}. The Temporal frontend plugin provides
 * the default implementation.
 *
 * @public
 */
export const temporalApiRef = createApiRef<TemporalApi>({
  id: 'plugin.temporal.api',
});
