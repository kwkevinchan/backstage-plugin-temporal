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
 * Resource type of Temporal workflows, for the permissions that do not go
 * through a catalog entity (the Temporal page).
 *
 * @public
 */
export const RESOURCE_TYPE_TEMPORAL_WORKFLOW = 'temporal-workflow';

/**
 * Read the workflows of an entity: the list, the details, the step graph,
 * the event history, the inputs and results, the failure details and the
 * records of model calls.
 *
 * @public
 */
export const temporalWorkflowReadPermission = createPermission({
  name: 'temporal.workflow.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/**
 * List the workflows of a namespace on the Temporal page, and open any of
 * them without an entity, with everything
 * {@link temporalWorkflowReadPermission} shows of an entity's workflows. A
 * resource permission on `temporal-workflow`: a policy can allow it, deny
 * it, or return a conditional decision with the rules of that resource
 * type.
 *
 * @public
 */
export const temporalWorkflowListPermission = createPermission({
  name: 'temporal.workflow.list',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_TEMPORAL_WORKFLOW,
});

/**
 * Run a query chosen by the user on a workflow of an entity (the Query
 * dialog). Queries only read; the backend's own queries (the message definition list)
 * need {@link temporalWorkflowReadPermission} only.
 * Checked on the entity; without an entity, only a policy that allows it
 * for every entity lets it through.
 *
 * @public
 */
export const temporalWorkflowQueryPermission = createPermission({
  name: 'temporal.workflow.query',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
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
 * Start a workflow of an entity, or from the Temporal page. Checked on the
 * entity; from the Temporal page, without an entity, only a policy that
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
  temporalWorkflowListPermission,
  temporalWorkflowQueryPermission,
  ...temporalControlPermissions,
];
