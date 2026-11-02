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

import { createPermission } from '@backstage/plugin-permission-common';

/** Resource type of catalog entities, owned by the catalog plugin. */
const RESOURCE_TYPE_CATALOG_ENTITY = 'catalog-entity';

/**
 * Read the workflow list and workflow details of an entity.
 *
 * @public
 */
export const temporalWorkflowReadPermission = createPermission({
  name: 'temporal.workflow.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/**
 * Read the event history of an entity's workflows. History events contain
 * workflow inputs and results.
 *
 * @public
 */
export const temporalWorkflowHistoryReadPermission = createPermission({
  name: 'temporal.workflow.history.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/**
 * List every workflow of a namespace on the Workflows page, and open the
 * details and the step graph of any of them without an entity. Inputs,
 * results and the event history also need
 * {@link temporalWorkflowHistoryListPermission}. A basic permission: it does
 * not depend on a catalog entity.
 *
 * @public
 */
export const temporalWorkflowListPermission = createPermission({
  name: 'temporal.workflow.list',
  attributes: { action: 'read' },
});

/**
 * Read the event history, inputs and results of any workflow opened without
 * an entity (from the Workflows page). Used together with
 * {@link temporalWorkflowListPermission}. A basic permission.
 *
 * @public
 */
export const temporalWorkflowHistoryListPermission = createPermission({
  name: 'temporal.workflow.history.list',
  attributes: { action: 'read' },
});

function controlPermission(
  name: string,
  action: 'create' | 'update' | 'delete',
) {
  return createPermission({
    name,
    attributes: { action },
    resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
  });
}

/**
 * Start a workflow of an entity, or from the Workflows page. Checked on the
 * entity; from the Workflows page, without an entity, only a policy that
 * allows it for every entity lets it through.
 *
 * @public
 */
export const temporalWorkflowStartPermission = controlPermission(
  'temporal.workflow.start',
  'create',
);

/**
 * Send a signal to a running workflow of an entity.
 *
 * @public
 */
export const temporalWorkflowSignalPermission = controlPermission(
  'temporal.workflow.signal',
  'update',
);

/**
 * Send an update to a running workflow of an entity and read its result.
 * Custom actions of the backend can use it too.
 *
 * @public
 */
export const temporalWorkflowUpdatePermission = controlPermission(
  'temporal.workflow.update',
  'update',
);

/**
 * Ask a running workflow of an entity to cancel. The workflow can clean up
 * before it closes.
 *
 * @public
 */
export const temporalWorkflowCancelPermission = controlPermission(
  'temporal.workflow.cancel',
  'update',
);

/**
 * Terminate a running workflow of an entity at once, with a reason.
 *
 * @public
 */
export const temporalWorkflowTerminatePermission = controlPermission(
  'temporal.workflow.terminate',
  'delete',
);

/**
 * Start a closed workflow of an entity again, with the same input, type,
 * task queue and search attributes, under a new workflow ID.
 *
 * @public
 */
export const temporalWorkflowRerunPermission = controlPermission(
  'temporal.workflow.rerun',
  'create',
);

/**
 * The permissions that change workflows. Without a permission policy every
 * one of them is allowed; a policy can deny them, for example to everyone
 * but the owner of the entity.
 *
 * @public
 */
export const temporalControlPermissions = [
  temporalWorkflowStartPermission,
  temporalWorkflowSignalPermission,
  temporalWorkflowUpdatePermission,
  temporalWorkflowCancelPermission,
  temporalWorkflowTerminatePermission,
  temporalWorkflowRerunPermission,
];

/**
 * Every permission of the Temporal plugin.
 *
 * @public
 */
export const temporalPermissions = [
  temporalWorkflowReadPermission,
  temporalWorkflowHistoryReadPermission,
  temporalWorkflowListPermission,
  temporalWorkflowHistoryListPermission,
  ...temporalControlPermissions,
];
