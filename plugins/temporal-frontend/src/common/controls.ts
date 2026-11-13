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

// Copy of plugins/temporal-backend/src/common/controls.ts, written by scripts/sync-common.mjs.
// Edit the backend file and run `yarn sync:common`.

import type { JsonObject, JsonValue } from '@backstage/types';
import { buildWorkflowPath } from './paths';
import type { WorkflowRef } from './types';

/**
 * The built-in operations on one workflow execution. `query` only reads; the
 * others change the workflow.
 *
 * @public
 */
export type WorkflowControlOperation =
  | 'signal'
  | 'update'
  | 'query'
  | 'cancel'
  | 'terminate'
  | 'rerun';

/**
 * Body of `POST .../signal`, `.../update` and `.../query`. `args` are the
 * handler arguments, sent as JSON payloads.
 *
 * @public
 */
export interface WorkflowMessageRequest {
  name: string;
  args?: JsonValue[];
}

/**
 * Result of an update, a query or a custom action. A result the backend
 * cannot decode (binary, or encrypted by a codec) is described by
 * `{ encoding, size, undecodable: true }` instead.
 *
 * @public
 */
export interface WorkflowMessageResponse {
  result?: JsonValue;
}

/**
 * Body of `POST /entities/:kind/:namespace/:name/workflows` (start a workflow
 * of an entity) and `POST /workflows` (start a workflow from the Workflows
 * page). For an entity, the workflow type and task queue default to the
 * entity's; `namespace` is only read by `POST /workflows`. Without
 * `workflowId`, one is made from the workflow type.
 *
 * @public
 */
export interface WorkflowStartRequest {
  workflowType?: string;
  taskQueue?: string;
  namespace?: string;
  args?: JsonValue[];
  workflowId?: string;
}

/**
 * Response of start and rerun: the new execution.
 *
 * @public
 */
export type WorkflowStartResponse = Required<WorkflowRef>;

/**
 * Builds the path of an operation on one workflow execution, relative to the
 * backend plugin root, for example
 * `/namespaces/default/workflows/order-1/signal`.
 *
 * @public
 */
export function buildWorkflowOperationPath(
  ref: WorkflowRef,
  operation: WorkflowControlOperation,
): string {
  return `${buildWorkflowPath(ref)}/${operation}`;
}

/**
 * Builds the path of a custom action on one workflow execution:
 * `.../actions/:actionId`.
 *
 * @public
 */
export function buildWorkflowActionPath(
  ref: WorkflowRef,
  actionId: string,
): string {
  return `${buildWorkflowPath(ref)}/actions/${encodeURIComponent(actionId)}`;
}

/**
 * Builds the path of the handler list of one workflow execution:
 * `.../handlers`.
 *
 * @public
 */
export function buildWorkflowHandlersPath(ref: WorkflowRef): string {
  return `${buildWorkflowPath(ref)}/handlers`;
}

/**
 * A signal, update or query that a workflow defines.
 *
 * @public
 */
export interface WorkflowHandler {
  name: string;
  description?: string;
  /**
   * JSON Schema of the one argument the handler takes, from the
   * `spec.messages` of the workflow's `TemporalWorkflow` entity.
   */
  inputSchema?: JsonObject;
  /** Example arguments: an array of arguments, or the one argument. */
  example?: JsonValue;
  /** A property of the argument filled with the signed-in user's entity reference. */
  userField?: string;
}

/**
 * The handlers of a workflow (`GET .../handlers`): from the metadata query
 * of the Temporal SDKs, with what the workflow's `TemporalWorkflow` entity
 * describes in `spec.messages`. Names starting with `__` (the SDKs' own)
 * are left out.
 *
 * @public
 */
export interface WorkflowHandlersResponse {
  signals: WorkflowHandler[];
  updates: WorkflowHandler[];
  queries: WorkflowHandler[];
}
