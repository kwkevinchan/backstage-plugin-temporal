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

import type { CompoundEntityRef } from '@backstage/catalog-model';
import type { WorkflowRef, WorkflowRunRef } from './types';

/**
 * Builds the path of the run list of one workflow ID, relative to the
 * backend plugin root: `/namespaces/:namespace/workflows/:workflowId`. A
 * `runId` of the reference is ignored. Every segment is URI encoded.
 *
 * @public
 */
export function buildWorkflowPath(
  ref: Pick<WorkflowRef, 'namespace' | 'workflowId'>,
): string {
  return `/namespaces/${encodeURIComponent(
    ref.namespace,
  )}/workflows/${encodeURIComponent(ref.workflowId)}`;
}

/**
 * Builds the path of one run, relative to the backend plugin root:
 * `/namespaces/:namespace/workflows/:workflowId/runs/:runId`. The paths of
 * the run's history, graph, operations and the others are under it. Every
 * segment is URI encoded.
 *
 * @public
 */
export function buildWorkflowRunPath(ref: WorkflowRunRef): string {
  return `${buildWorkflowPath(ref)}/runs/${encodeURIComponent(ref.runId)}`;
}

/**
 * Builds the path of an entity's workflow list, relative to the backend
 * plugin root: `/entities/:kind/:namespace/:name/workflows`.
 *
 * @public
 */
export function buildEntityWorkflowsPath(entity: CompoundEntityRef): string {
  return `/entities/${encodeURIComponent(
    entity.kind.toLocaleLowerCase('en-US'),
  )}/${encodeURIComponent(
    entity.namespace.toLocaleLowerCase('en-US'),
  )}/${encodeURIComponent(entity.name.toLocaleLowerCase('en-US'))}/workflows`;
}

/**
 * Path of the list of every workflow in a namespace, relative to the backend
 * plugin root.
 *
 * @public
 */
export const WORKFLOWS_PATH = '/workflows';

/**
 * Path of the workflow type overview (`POST`), relative to the backend
 * plugin root: the numbers of several `TemporalWorkflow` entities.
 *
 * @public
 */
export const WORKFLOW_TYPE_OVERVIEW_PATH = '/workflow-types/overview';

/**
 * Builds the path of an entity's workflow statistics, relative to the backend
 * plugin root: `/entities/:kind/:namespace/:name/workflow-stats`.
 *
 * @public
 */
export function buildEntityWorkflowStatsPath(
  entity: CompoundEntityRef,
): string {
  return buildEntityWorkflowsPath(entity).replace(
    /\/workflows$/,
    '/workflow-stats',
  );
}
