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
import type { JsonValue } from '@backstage/types';
import type {
  WorkflowDetail,
  WorkflowMessageDefinitionsResponse,
  WorkflowMessageResponse,
  WorkflowGraphResponse,
  WorkflowLlmCallResponse,
  WorkflowHistoryResponse,
  WorkflowProgressResponse,
  WorkflowListResponse,
  TemporalScheduleListResponse,
  WorkflowRef,
  WorkflowRunRef,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowTypeOverviewResponse,
  WorkflowStartRequest,
  WorkflowStartResponse,
  TemporalScheduleNoteRequest,
  TemporalScheduleOperation,
} from '../common';
import type { TemporalWorkflowExtensionsApi } from './extensions';

/**
 * Client of the Temporal backend plugin: the reads and, from `startWorkflow`
 * on, the operations that change workflows (served unless
 * `temporal.control.enabled` is false). `entityRef` is the entity the
 * workflow is shown for; the backend checks the permission on it.
 *
 * @public
 */
export interface TemporalApi {
  /**
   * Lists the workflows of an entity, newest first. Runs that continued as
   * new are left out unless `allRuns` is set or a status is chosen.
   */
  listEntityWorkflows(
    entityRef: string,
    options?: {
      status?: WorkflowStatus;
      allRuns?: boolean;
      /** Only workflows whose Bool search attribute of this name is true. */
      searchAttribute?: string;
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<WorkflowListResponse>;

  /**
   * Lists every workflow of a namespace (default namespace when omitted),
   * newest first. Needs the `temporal.workflow.list` permission.
   * `workflowIdPrefix` matches the start of the workflow ID. Runs that
   * continued as new are left out unless `allRuns` is set or a status is
   * chosen.
   */
  listWorkflows(options?: {
    namespace?: string;
    status?: WorkflowStatus;
    allRuns?: boolean;
    workflowType?: string;
    workflowIdPrefix?: string;
    /** Only workflows whose Bool search attribute of this name is true. */
    searchAttribute?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<WorkflowListResponse>;

  /**
   * Schedules of the default namespace. Needs `temporal.workflow.list`
   * without conditions.
   */
  listSchedules(): Promise<TemporalScheduleListResponse>;

  /** Schedules that start the workflow types of an entity. */
  listEntitySchedules(entityRef: string): Promise<TemporalScheduleListResponse>;

  /**
   * Counts by status and mean duration of the entity's most recent runs
   * (`limit`, default 50, at most 100).
   */
  getEntityWorkflowStats(
    entityRef: string,
    options?: { limit?: number },
  ): Promise<WorkflowStatsResponse>;

  /**
   * The numbers of `TemporalWorkflow` entities for the Workflows tab of the
   * Temporal page: running runs, runs completed and failed in the last 7
   * days, the latest run, the mean duration and the last failure. At most
   * 25 references (`MAX_WORKFLOW_TYPE_OVERVIEW_REFS`); the entities the
   * caller may not read are left out of the response.
   */
  getWorkflowTypeOverview(
    entityRefs: string[],
  ): Promise<WorkflowTypeOverviewResponse>;

  /**
   * The runs of one workflow ID, in the order of Temporal's visibility
   * store (the running run first). With `entityRef`, only the runs that are
   * the entity's workflows; without it, the runs the list permission allows.
   */
  listWorkflowRuns(
    ref: Pick<WorkflowRef, 'namespace' | 'workflowId'>,
    options?: { entityRef?: string; pageSize?: number; pageToken?: string },
  ): Promise<WorkflowListResponse>;

  /**
   * Gets one run. `entityRef` is the entity it is shown for; without it the
   * backend uses the workflow's entity reference search attribute.
   */
  getWorkflow(
    ref: WorkflowRunRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowDetail>;

  /** Gets one page of the event history, oldest first. */
  getWorkflowHistory(
    ref: WorkflowRunRef,
    options?: { entityRef?: string; pageSize?: number; pageToken?: string },
  ): Promise<WorkflowHistoryResponse>;

  /**
   * Gets the steps of a run grouped from its history, with the arrows
   * between them, their inputs and their results.
   */
  getWorkflowGraph(
    ref: WorkflowRunRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowGraphResponse>;

  /**
   * Gets the full record of one model call (a step with `llm`): messages,
   * reasoning, output, tool calls and tokens. `nodeId` is the ID of the
   * step in the graph.
   *
   * Experimental: the shape changes before the first stable release.
   *
   * @alpha
   */
  getLlmCall(
    ref: WorkflowRunRef,
    nodeId: string,
    options?: { entityRef?: string },
  ): Promise<WorkflowLlmCallResponse>;

  /** Gets the completed steps and the current step of a run, for lists. */
  getWorkflowProgress(
    ref: WorkflowRunRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowProgressResponse>;

  /**
   * Runs a query on a workflow and returns its result. Needs
   * `temporal.workflow.query` on the entity, besides the permission to see
   * the workflow.
   */
  queryWorkflow(
    ref: WorkflowRunRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;

  /**
   * Lists the signals, updates and queries a workflow defines, from the
   * metadata query of the Temporal SDKs. Closed runs answer too while a
   * worker of their task queue runs; empty when no worker answers.
   */
  getWorkflowMessageDefinitions(
    ref: WorkflowRunRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageDefinitionsResponse>;

  /**
   * Starts a workflow. With `entityRef`, a workflow of that entity (its
   * workflow type and task queue are the defaults); without it, from the
   * Temporal page (`workflowType` and `taskQueue` are required). Needs
   * `temporal.workflow.start`.
   */
  startWorkflow(
    request: WorkflowStartRequest,
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse>;

  /**
   * Sends a signal to a running workflow. Needs `temporal.workflow.signal`.
   */
  signalWorkflow(
    ref: WorkflowRunRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Sends an update to a running workflow and waits for its result. Needs
   * `temporal.workflow.update`. A rejected update throws with the
   * workflow's message.
   */
  updateWorkflow(
    ref: WorkflowRunRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;

  /** Asks a running workflow to cancel. Needs `temporal.workflow.cancel`. */
  cancelWorkflow(
    ref: WorkflowRunRef,
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Terminates a running workflow at once. Needs
   * `temporal.workflow.terminate`.
   */
  terminateWorkflow(
    ref: WorkflowRunRef,
    request: { reason?: string },
    options?: { entityRef?: string },
  ): Promise<void>;

  /**
   * Starts a run again with the same input under a new workflow ID. Needs
   * `temporal.workflow.rerun`.
   */
  rerunWorkflow(
    ref: WorkflowRunRef,
    request?: { workflowId?: string },
    options?: { entityRef?: string },
  ): Promise<WorkflowStartResponse>;

  /**
   * Runs a custom action that a backend module added with
   * `temporalControlExtensionPoint.addControlAction()`.
   */
  runWorkflowAction(
    ref: WorkflowRunRef,
    actionId: string,
    body?: JsonValue,
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;

  /**
   * Pauses, unpauses or triggers a schedule now. Needs
   * `temporal.workflow.start`, on the entity whose workflows it starts.
   */
  runScheduleOperation(
    ref: { namespace: string; scheduleId: string },
    operation: TemporalScheduleOperation,
    request?: TemporalScheduleNoteRequest,
    options?: { entityRef?: string },
  ): Promise<void>;
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

/**
 * API reference of {@link TemporalWorkflowExtensionsApi}: the shared mount
 * point of workflow actions and sections. The Temporal frontend plugin
 * provides it in the new frontend system and collects the extensions of
 * `TemporalWorkflowActionBlueprint` and `TemporalWorkflowSectionBlueprint`.
 */
export const temporalWorkflowExtensionsApiRef =
  createApiRef<TemporalWorkflowExtensionsApi>({
    id: 'plugin.temporal.workflow-extensions',
  });
