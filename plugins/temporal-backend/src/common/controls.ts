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

import type { JsonObject, JsonValue } from '@backstage/types';
import { buildWorkflowRunPath } from './paths';
import type { WorkflowRunRef } from './types';

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
 * arguments of the message, sent as JSON payloads.
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
 * `{ encoding, size, undecodable: true, metadata? }` instead.
 *
 * @public
 */
export interface WorkflowMessageResponse {
  result?: JsonValue;
}

/**
 * Controls whether a workflow ID of a closed execution may be reused on start.
 * `TERMINATE_IF_RUNNING` is intentionally omitted because start routes only
 * check `temporal.workflow.start`, not `temporal.workflow.terminate`.
 *
 * @public
 */
export type WorkflowIdReusePolicy =
  | 'ALLOW_DUPLICATE'
  | 'ALLOW_DUPLICATE_FAILED_ONLY'
  | 'REJECT_DUPLICATE';

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
  /** Policy for reusing the workflow ID of an earlier closed run. */
  workflowIdReusePolicy?: WorkflowIdReusePolicy;
}

/**
 * Response of start and rerun: the new execution.
 *
 * @public
 */
export type WorkflowStartResponse = WorkflowRunRef;

/**
 * Builds the path of an operation on one run, relative to the backend plugin
 * root, for example `/namespaces/default/workflows/order-1/runs/r1/signal`.
 *
 * @public
 */
export function buildWorkflowOperationPath(
  ref: WorkflowRunRef,
  operation: WorkflowControlOperation,
): string {
  return `${buildWorkflowRunPath(ref)}/${operation}`;
}

/**
 * Builds the path of a custom action on one run:
 * `.../runs/:runId/actions/:actionId`.
 *
 * @public
 */
export function buildWorkflowActionPath(
  ref: WorkflowRunRef,
  actionId: string,
): string {
  return `${buildWorkflowRunPath(ref)}/actions/${encodeURIComponent(actionId)}`;
}

/**
 * Builds the path of the message definitions of one run:
 * `.../runs/:runId/message-definitions`.
 *
 * @public
 */
export function buildWorkflowMessageDefinitionsPath(
  ref: WorkflowRunRef,
): string {
  return `${buildWorkflowRunPath(ref)}/message-definitions`;
}

/**
 * A message definition: a signal, update or query that a workflow defines.
 *
 * @public
 */
export interface WorkflowMessageDefinition {
  name: string;
  description?: string;
  /**
   * JSON Schema of the one argument this message takes, from the
   * `spec.messages` of the workflow's `TemporalWorkflow` entity.
   */
  inputSchema?: JsonObject;
  /** Example arguments: an array of arguments, or the one argument. */
  example?: JsonValue;
  /** A property of the argument filled with the signed-in user's entity reference. */
  userField?: string;
}

/**
 * The message definitions of a workflow (`GET .../message-definitions`): from the metadata query
 * of the Temporal SDKs, with what the workflow's `TemporalWorkflow` entity
 * describes in `spec.messages`. Names starting with `__` (the SDKs' own)
 * are left out.
 *
 * @public
 */
export interface WorkflowMessageDefinitionsResponse {
  signals: WorkflowMessageDefinition[];
  updates: WorkflowMessageDefinition[];
  queries: WorkflowMessageDefinition[];
}
