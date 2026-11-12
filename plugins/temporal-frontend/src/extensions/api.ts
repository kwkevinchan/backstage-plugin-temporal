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
  WorkflowHandlersResponse,
  WorkflowMessageResponse,
  WorkflowGraphResponse,
  WorkflowLlmCallResponse,
  WorkflowLoopsResponse,
  WorkflowHistoryResponse,
  WorkflowProgressResponse,
  WorkflowListResponse,
  TemporalScheduleListResponse,
  WorkflowRef,
  WorkflowStatsResponse,
  WorkflowStatus,
  WorkflowStepsResponse,
} from '../common';
import type { TemporalWorkflowExtensionsApi } from './extensions';

/**
 * Client of the Temporal backend plugin.
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
   * Schedules of a namespace (default namespace when omitted). Needs
   * `temporal.workflow.list` without conditions.
   */
  listSchedules(options?: {
    namespace?: string;
  }): Promise<TemporalScheduleListResponse>;

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

  /**
   * Gets the steps of a run grouped from its history, with the arrows
   * between them. Inputs and results are left out when the caller may not
   * read the history (`payloadsHidden`).
   */
  getWorkflowGraph(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowGraphResponse>;

  /**
   * Gets the loops of a workflow (from loop markers) across the runs it
   * continued as new, with each round's steps, decision and score. For a
   * running workflow the state comes from its `__loop_state` query when
   * the worker answers.
   *
   * Experimental (`temporal.experimental.aiWorkflows`; answers 404 when
   * off); moves to a separate package later.
   *
   * @alpha
   */
  getWorkflowLoops(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowLoopsResponse>;

  /**
   * Gets the full record of one model call (a step with `llm`): messages,
   * reasoning, output, tool calls and tokens. `nodeId` is the ID of the
   * step in the graph. Needs the permission to read the history.
   *
   * Experimental (`temporal.experimental.aiWorkflows`; answers 404 when
   * off); moves to a separate package later.
   *
   * @alpha
   */
  getLlmCall(
    ref: WorkflowRef,
    nodeId: string,
    options?: { entityRef?: string },
  ): Promise<WorkflowLlmCallResponse>;

  /** Gets the completed steps and the current step of a run, for lists. */
  getWorkflowProgress(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowProgressResponse>;

  /**
   * Downloads a payload of a run that is stored in S3 (an `ExternalPayload`
   * with `downloadable`), through the backend. Needs the permission to read
   * the history.
   */
  downloadPayload(
    ref: WorkflowRef,
    options: { key: string; entityRef?: string },
  ): Promise<Blob>;

  /**
   * Runs a query on a workflow and returns its result. Needs
   * `temporal.workflow.query` on the entity, besides the permission to see
   * the workflow.
   */
  queryWorkflow(
    ref: WorkflowRef,
    request: { name: string; args?: JsonValue[] },
    options?: { entityRef?: string },
  ): Promise<WorkflowMessageResponse>;

  /**
   * Lists the signals, updates and queries a workflow defines, from the
   * metadata query of the Temporal SDKs. Closed runs answer too while a
   * worker of their task queue runs; empty when no worker answers.
   */
  getWorkflowHandlers(
    ref: WorkflowRef,
    options?: { entityRef?: string },
  ): Promise<WorkflowHandlersResponse>;
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
 *
 * @public
 */
export const temporalWorkflowExtensionsApiRef =
  createApiRef<TemporalWorkflowExtensionsApi>({
    id: 'plugin.temporal.workflow-extensions',
  });
